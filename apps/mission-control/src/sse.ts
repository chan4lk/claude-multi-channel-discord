import { computeFleet, computeStalls } from './fleet-compute'
import { insertAlertEvent, getWebhooks } from './db'
import { maxToolCallId, toolCallsSince } from './fact-index'

// Use globalThis to survive Next.js hot module replacement
const g = globalThis as {
  __mcdClients?: Set<ReadableStreamDefaultController>
  __mcdFleetInterval?: ReturnType<typeof setInterval>
  __mcdBudgetAlertState?: Map<string, string>
  __mcdToolEventWatermark?: number
};
const clients = (g.__mcdClients ??= new Set<ReadableStreamDefaultController>());
// Tracks "slug:threshold:YYYY-MM" → fired. Prevents duplicate alerts per threshold per month.
const budgetAlertState = (g.__mcdBudgetAlertState ??= new Map<string, string>());

export function addClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller);
  startFleetBroadcaster();
}

export function removeClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller);
  if (clients.size === 0) stopFleetBroadcaster();
}

export function broadcast(data: unknown): void {
  const chunk = `data: ${JSON.stringify(data)}\n\n`;
  for (const controller of clients) {
    try {
      controller.enqueue(chunk);
    } catch {
      clients.delete(controller);
    }
  }
}

async function fireWebhooks(eventType: string, slug: string, detail: string): Promise<void> {
  let hooks: ReturnType<typeof getWebhooks>
  try { hooks = getWebhooks() } catch { return }
  const enabled = hooks.filter((h) => h.enabled && (h.event_filter === 'all' || h.event_filter === eventType))
  if (enabled.length === 0) return

  const { insertWebhookDelivery } = await import('./db')
  const ts = new Date().toISOString()

  for (const hook of enabled) {
    let body: string
    if (hook.use_slack_format) {
      const emoji = eventType === 'stall' ? '⏸' : eventType === 'budget' ? '💸' : eventType === 'watchdog' ? '🐕' : '⚡'
      body = JSON.stringify({ text: `${emoji} [${slug}] ${eventType}: ${detail}` })
    } else {
      body = JSON.stringify({ event: eventType, slug, timestamp: ts, detail })
    }
    let status = 'error'
    let responseCode: number | null = null
    let error: string | null = null
    try {
      const res = await Promise.race([
        fetch(hook.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
        new Promise<Response>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5_000)),
      ]) as Response
      responseCode = res.status
      status = res.ok ? 'success' : 'error'
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      status = error === 'timeout' ? 'timeout' : 'error'
    }
    try { insertWebhookDelivery(hook.id, eventType, slug, status, responseCode, error) } catch {}
  }
}

// Emits tool events from mc_tool_call rows past the id watermark — the fact
// index (fed by the incremental ingester) replaces the old full-transcript
// read + per-slug line tracker, so the broadcaster never opens transcript
// files. The ingester already excludes mcp__mcd__* internal tools. On first
// tick the watermark initializes to the current max id (nothing emitted), so
// a fresh process never replays the whole table as live events.
function checkToolEvents(): void {
  if (clients.size === 0) return
  if (g.__mcdToolEventWatermark == null) {
    g.__mcdToolEventWatermark = maxToolCallId()
    return
  }
  for (const row of toolCallsSince({ afterId: g.__mcdToolEventWatermark })) {
    broadcast({ type: 'tool-event', data: { slug: row.slug, toolName: row.tool_name } })
    g.__mcdToolEventWatermark = row.id
  }
}

function broadcastFleetUpdate(): void {
  const mcdDir = process.env.MCD_CHANNELS_DIR;
  if (!mcdDir || clients.size === 0) return;
  try {
    const fleet = computeFleet(mcdDir);
    broadcast({ type: 'fleet-update', data: fleet });
    const { stalls, checkedAt } = computeStalls(mcdDir);
    if (stalls.length > 0) {
      broadcast({ type: 'stall-alert', data: { stalls, checkedAt } });
      for (const s of stalls) {
        try {
          insertAlertEvent(s.slug, 'stall', `Stall detected: ${s.stallReason}`, { stallReason: s.stallReason, stallAgeMins: s.stallAgeMins, checkedAt })
        } catch {}
        fireWebhooks('stall', s.slug, `Stall detected: ${s.stallReason}`).catch(() => {})
      }
    }
    checkBudgetAlerts(fleet.projects);
    try { checkToolEvents() } catch {}
  } catch {
    // Non-fatal: skip this tick
  }
}

function checkBudgetAlerts(projects: ReturnType<typeof computeFleet>['projects']): void {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thresholds: Array<{ key: '50' | '80' | '100'; label: string }> = [
    { key: '50', label: '50%' },
    { key: '80', label: '80%' },
    { key: '100', label: '100% (exhausted)' },
  ];
  for (const project of projects) {
    if (!project.monthlyTokenBudget || !project.monthlyTokensUsed) continue;
    const pct = (project.monthlyTokensUsed / project.monthlyTokenBudget) * 100;
    for (const { key, label } of thresholds) {
      const threshold = Number(key);
      if (pct < threshold) continue;
      const stateKey = `${project.slug}:${key}:${yearMonth}`;
      if (budgetAlertState.has(stateKey)) continue;
      budgetAlertState.set(stateKey, yearMonth);
      const budgetPayload = {
        slug: project.slug,
        threshold: key,
        thresholdLabel: label,
        used: project.monthlyTokensUsed,
        budget: project.monthlyTokenBudget,
        pct: Math.round(pct),
        budgetStatus: project.budgetStatus,
        yearMonth,
      };
      broadcast({ type: 'budget-alert', data: budgetPayload });
      try {
        insertAlertEvent(
          project.slug,
          'budget',
          `Budget threshold hit: ${label} (${Math.round(pct)}% used)`,
          budgetPayload as Record<string, unknown>
        )
      } catch {}
      fireWebhooks('budget', project.slug, `Budget threshold hit: ${label} (${Math.round(pct)}% used)`).catch(() => {})
    }
  }
}

function startFleetBroadcaster(): void {
  if (g.__mcdFleetInterval != null) return;
  // Push initial state immediately, then every 5s
  broadcastFleetUpdate();
  g.__mcdFleetInterval = setInterval(broadcastFleetUpdate, 5_000);
}

function stopFleetBroadcaster(): void {
  if (g.__mcdFleetInterval != null) {
    clearInterval(g.__mcdFleetInterval);
    g.__mcdFleetInterval = undefined;
  }
}

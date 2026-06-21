import { computeFleet, computeStalls } from './fleet-compute'

// Use globalThis to survive Next.js hot module replacement
const g = globalThis as {
  __mcdClients?: Set<ReadableStreamDefaultController>
  __mcdFleetInterval?: ReturnType<typeof setInterval>
  __mcdBudgetAlertState?: Map<string, string>
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

function broadcastFleetUpdate(): void {
  const mcdDir = process.env.MCD_CHANNELS_DIR;
  if (!mcdDir || clients.size === 0) return;
  try {
    const fleet = computeFleet(mcdDir);
    broadcast({ type: 'fleet-update', data: fleet });
    const { stalls, checkedAt } = computeStalls(mcdDir);
    if (stalls.length > 0) {
      broadcast({ type: 'stall-alert', data: { stalls, checkedAt } });
    }
    checkBudgetAlerts(fleet.projects);
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
      broadcast({
        type: 'budget-alert',
        data: {
          slug: project.slug,
          threshold: key,
          thresholdLabel: label,
          used: project.monthlyTokensUsed,
          budget: project.monthlyTokenBudget,
          pct: Math.round(pct),
          budgetStatus: project.budgetStatus,
          yearMonth,
        },
      });
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

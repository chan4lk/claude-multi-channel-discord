import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { computeFleet, computeStalls } from './fleet-compute'

// Use globalThis to survive Next.js hot module replacement
const g = globalThis as {
  __mcdClients?: Set<ReadableStreamDefaultController>
  __mcdFleetInterval?: ReturnType<typeof setInterval>
  __mcdBudgetAlertState?: Map<string, string>
  __mcdToolLineTracker?: Map<string, { file: string; lineCount: number }>
};
const clients = (g.__mcdClients ??= new Set<ReadableStreamDefaultController>());
// Tracks "slug:threshold:YYYY-MM" → fired. Prevents duplicate alerts per threshold per month.
const budgetAlertState = (g.__mcdBudgetAlertState ??= new Map<string, string>());
// Tracks last-seen transcript line count per project for tool-event detection.
const toolLineTracker = (g.__mcdToolLineTracker ??= new Map<string, { file: string; lineCount: number }>());

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

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function getLatestTranscriptFile(slug: string, mcdDir: string): string | null {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return null }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  let files: string[] = []
  try {
    files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
  } catch { return null }
  if (files.length === 0) return null
  let latestFile = ''
  let latestMtime = 0
  for (const f of files) {
    try {
      const m = fs.statSync(path.join(transcriptDir, f)).mtimeMs
      if (m > latestMtime) { latestMtime = m; latestFile = path.join(transcriptDir, f) }
    } catch {}
  }
  return latestFile || null
}

function checkToolEvents(mcdDir: string): void {
  if (clients.size === 0) return
  const channels = JSON.parse(fs.readFileSync(path.join(mcdDir, 'channels.json'), 'utf-8')) as {
    projects?: Record<string, { slug?: string }>
  }
  const slugs = Object.values(channels.projects ?? {}).map((p) => p.slug).filter(Boolean) as string[]

  for (const slug of slugs) {
    const latestFile = getLatestTranscriptFile(slug, mcdDir)
    if (!latestFile) continue

    let raw = ''
    try { raw = fs.readFileSync(latestFile, 'utf-8') } catch { continue }
    const lines = raw.split('\n').filter(Boolean)
    const tracker = toolLineTracker.get(slug)

    // Reset tracker if transcript file changed
    const startLine = (tracker && tracker.file === latestFile) ? tracker.lineCount : lines.length
    toolLineTracker.set(slug, { file: latestFile, lineCount: lines.length })

    if (startLine >= lines.length) continue

    for (let i = startLine; i < lines.length; i++) {
      try {
        const rec = JSON.parse(lines[i]) as {
          type?: string
          message?: { content?: Array<{ type?: string; name?: string }> }
        }
        if (rec.type !== 'assistant') continue
        const content = rec.message?.content ?? []
        for (const block of content) {
          if (block.type === 'tool_use' && block.name && !block.name.startsWith('mcp__mcd__')) {
            broadcast({ type: 'tool-event', data: { slug, toolName: block.name } })
          }
        }
      } catch {}
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
    try { checkToolEvents(mcdDir) } catch {}
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

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

const WEEK_MS = 7 * 86400_000

// Composite momentum weights — burn dominates, proposals next, goal freshness least.
const W_BURN = 0.5
const W_PROPOSALS = 0.3
const W_GOAL = 0.2

export interface MomentumIndexRow {
  slug: string
  score: number          // composite 0–100, fleet-normalized
  burn7d: number         // tokens consumed over the last 7 days
  goalDelta: number      // goal-freshness signal 0–7 (days the GOAL.md was touched within the last week)
  proposalsDone: number  // proposals proposed-and-completed within the last 7 days
}

export interface MomentumIndexResponse {
  rows: MomentumIndexRow[]   // sorted by score desc
  generatedAt: string
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function readFile(filePath: string): string | null {
  try { return fs.readFileSync(filePath, 'utf-8') } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findAllJsonl(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return [] }
}

interface AssistantRecord {
  type: string
  timestamp?: string
  message?: { usage?: { input_tokens?: number; output_tokens?: number } }
}

function burn7d(slug: string, mcdDir: string, now: number): number {
  const cutoff = now - WEEK_MS
  let total = 0
  for (const file of findAllJsonl(slug, mcdDir)) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: AssistantRecord
      try { rec = JSON.parse(line) as AssistantRecord } catch { continue }
      if (rec.type !== 'assistant') continue
      const tsMs = typeof rec.timestamp === 'string' ? new Date(rec.timestamp).getTime() : NaN
      if (isNaN(tsMs) || tsMs < cutoff) continue
      const usage = rec.message?.usage ?? {}
      total += (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
    }
  }
  return total
}

// Freshness proxy for goal advancement: how recently GOAL.md was edited (0 = stale/missing, 7 = touched today).
function goalDelta(slug: string, mcdDir: string, now: number): number {
  const goalPath = path.join(mcdDir, 'projects', slug, 'GOAL.md')
  try {
    const stat = fs.statSync(goalPath)
    const ageDays = (now - stat.mtimeMs) / 86400_000
    return Math.max(0, 7 - ageDays)
  } catch { return 0 }
}

// Proposals proposed-and-completed this week. No completion timestamp exists in BACKLOG.md,
// so we approximate with done items whose **Created** date falls within the last 7 days.
function proposalsDone(slug: string, mcdDir: string, now: number): number {
  const content = readFile(path.join(mcdDir, 'projects', slug, 'BACKLOG.md'))
  if (!content) return 0
  const cutoff = now - WEEK_MS
  let count = 0
  const sections = content.split(/^##\s+/m).slice(1)
  for (const section of sections) {
    const isDone = section.includes('[x] done')
    if (!isDone) continue
    const m = section.match(/\*\*Created:\*\*\s*(\d{4}-\d{2}-\d{2})/)
    if (!m) continue
    const created = new Date(m[1] + 'T00:00:00Z').getTime()
    if (!isNaN(created) && created >= cutoff) count++
  }
  return count
}

export async function GET(): Promise<Response> {
  const now = Date.now()
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ rows: [], generatedAt: new Date().toISOString() } satisfies MomentumIndexResponse)
  }

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  interface Raw { slug: string; burn7d: number; goalDelta: number; proposalsDone: number }
  const raws: Raw[] = []
  for (const proj of Object.values(channels?.projects ?? {})) {
    const slug = proj.slug
    if (!slug) continue
    raws.push({
      slug,
      burn7d: burn7d(slug, mcdDir, now),
      goalDelta: goalDelta(slug, mcdDir, now),
      proposalsDone: proposalsDone(slug, mcdDir, now),
    })
  }

  const maxBurn = Math.max(1, ...raws.map((r) => r.burn7d))
  const maxProp = Math.max(1, ...raws.map((r) => r.proposalsDone))

  const rows: MomentumIndexRow[] = raws.map((r) => {
    const burnNorm = r.burn7d / maxBurn
    const goalNorm = r.goalDelta / 7
    const propNorm = r.proposalsDone / maxProp
    const score = Math.round(100 * (W_BURN * burnNorm + W_PROPOSALS * propNorm + W_GOAL * goalNorm))
    return { slug: r.slug, score, burn7d: r.burn7d, goalDelta: Math.round(r.goalDelta * 10) / 10, proposalsDone: r.proposalsDone }
  })

  rows.sort((a, b) => b.score - a.score)

  return Response.json({ rows, generatedAt: new Date().toISOString() } satisfies MomentumIndexResponse)
}

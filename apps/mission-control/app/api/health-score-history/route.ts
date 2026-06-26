import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface ScoreBreakdown {
  memoryScore: number
  activityScore: number
  recencyScore: number
  stabilityScore: number
  proposalScore: number
}

export interface HealthSnapshot {
  date: string
  score: number
  breakdown: ScoreBreakdown
}

export interface ProjectHistory {
  slug: string
  history: HealthSnapshot[]
  trend: 'improving' | 'declining' | 'flat'
  variance: number
}

export interface HealthScoreHistoryResponse {
  projects: ProjectHistory[]
  generatedAt: string
}

function mcdDir(): string {
  return process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
}

function getProjectSlugs(dir: string): string[] {
  const projectsDir = path.join(dir, 'projects')
  try {
    return fs.readdirSync(projectsDir).filter((s) => {
      if (s.startsWith('.')) return false
      try {
        const stat = fs.statSync(path.join(projectsDir, s))
        return stat.isDirectory() || stat.isSymbolicLink()
      } catch { return false }
    })
  } catch { return [] }
}

function getRealProjectPath(dir: string, slug: string): string | null {
  try { return fs.realpathSync(path.join(dir, 'projects', slug)) } catch { return null }
}

function getTranscriptDir(realPath: string): string {
  const encoded = realPath.replace(/[^a-zA-Z0-9]/g, '-')
  return path.join(os.homedir(), '.claude', 'projects', encoded)
}

function countMemoryFiles(realPath: string): number {
  const memDir = path.join(realPath, 'memory')
  try {
    return fs.readdirSync(memDir).filter((f) => f.endsWith('.md') && !f.startsWith('MEMORY')).length
  } catch { return 0 }
}

function getSessionData(transcriptDir: string): { sessions: number; lastActiveMsAgo: number | null } {
  let sessions = 0
  let lastModifiedMs: number | null = null
  try {
    const files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
    sessions = files.length
    for (const f of files) {
      try {
        const stat = fs.statSync(path.join(transcriptDir, f))
        if (lastModifiedMs === null || stat.mtimeMs > lastModifiedMs) lastModifiedMs = stat.mtimeMs
      } catch { /* skip */ }
    }
  } catch { /* dir missing */ }
  return { sessions, lastActiveMsAgo: lastModifiedMs !== null ? Date.now() - lastModifiedMs : null }
}

function countRecentKills(dir: string, slug: string, windowMs: number): number {
  const logPath = path.join(dir, 'projects', slug, 'watchdog-kills.jsonl')
  let raw = ''
  try { raw = fs.readFileSync(logPath, 'utf-8') } catch { return 0 }
  const cutoff = Date.now() - windowMs
  let count = 0
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line) as { ts?: string }
      if (ev.ts && new Date(ev.ts).getTime() >= cutoff) count++
    } catch { /* skip */ }
  }
  return count
}

function countOpenProposals(realPath: string): number {
  const specclaw = path.join(realPath, '.specclaw', 'changes')
  let open = 0
  try {
    const changes = fs.readdirSync(specclaw)
    for (const ch of changes) {
      const proposalMd = path.join(specclaw, ch, 'proposal.md')
      const verifyReport = path.join(specclaw, ch, 'verify-report.md')
      if (fs.existsSync(proposalMd) && !fs.existsSync(verifyReport)) open++
    }
  } catch { /* no .specclaw */ }
  return open
}

function computeScore(
  memoryFiles: number,
  sessions: number,
  lastActiveDaysAgo: number | null,
  recentKills: number,
  openProposals: number,
): ScoreBreakdown {
  const memoryScore = Math.round(Math.min(memoryFiles / 20, 1) * 25)
  const activityScore = sessions === 0 ? 0 : Math.round(10 + Math.min((sessions - 1) / 49, 1) * 15)
  let recencyScore = 0
  if (lastActiveDaysAgo !== null) {
    if (lastActiveDaysAgo <= 1) recencyScore = 20
    else if (lastActiveDaysAgo <= 7) recencyScore = 15
    else if (lastActiveDaysAgo <= 30) recencyScore = 8
    else if (lastActiveDaysAgo <= 90) recencyScore = 3
  }
  const stabilityScore = Math.max(0, 20 - recentKills * 5)
  const proposalScore = openProposals === 0 ? 5
    : openProposals <= 3 ? 10
    : openProposals <= 6 ? 8
    : 6
  return { memoryScore, activityScore, recencyScore, stabilityScore, proposalScore }
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function readSnapshots(memDir: string): HealthSnapshot[] {
  const p = path.join(memDir, 'health-snapshots.jsonl')
  const out: HealthSnapshot[] = []
  try {
    const raw = fs.readFileSync(p, 'utf-8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try { out.push(JSON.parse(line) as HealthSnapshot) } catch { /* skip */ }
    }
  } catch { /* missing */ }
  return out
}

function appendSnapshot(memDir: string, snap: HealthSnapshot): void {
  const p = path.join(memDir, 'health-snapshots.jsonl')
  try {
    fs.mkdirSync(memDir, { recursive: true })
    fs.appendFileSync(p, JSON.stringify(snap) + '\n', 'utf-8')
  } catch { /* non-fatal */ }
}

function computeTrend(history: HealthSnapshot[]): 'improving' | 'declining' | 'flat' {
  const valid = history.filter((h) => typeof h.score === 'number')
  if (valid.length < 4) return 'flat'
  const half = Math.floor(valid.length / 2)
  const early = valid.slice(0, half).map((h) => h.score)
  const late = valid.slice(valid.length - half).map((h) => h.score)
  const avgEarly = early.reduce((a, b) => a + b, 0) / early.length
  const avgLate = late.reduce((a, b) => a + b, 0) / late.length
  const delta = avgLate - avgEarly
  if (delta > 3) return 'improving'
  if (delta < -3) return 'declining'
  return 'flat'
}

function computeVariance(history: HealthSnapshot[]): number {
  const scores = history.map((h) => h.score)
  if (scores.length < 2) return 0
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  return scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scores.length
}

function last30Days(): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
}

export async function GET(): Promise<Response> {
  const dir = mcdDir()
  const slugs = getProjectSlugs(dir)
  const today = todayStr()
  const dates = last30Days()
  const killWindow = 7 * 24 * 3_600_000
  const projects: ProjectHistory[] = []

  for (const slug of slugs) {
    const realPath = getRealProjectPath(dir, slug)
    if (!realPath) continue

    const memDir = path.join(realPath, 'memory')
    const transcriptDir = getTranscriptDir(realPath)
    const snapshots = readSnapshots(memDir)

    // Capture today's snapshot if not yet recorded
    const hasTodaySnap = snapshots.some((s) => s.date === today)
    if (!hasTodaySnap) {
      const memoryFiles = countMemoryFiles(realPath)
      const { sessions, lastActiveMsAgo } = getSessionData(transcriptDir)
      const recentKills = countRecentKills(dir, slug, killWindow)
      const openProposals = countOpenProposals(realPath)
      const lastActiveDaysAgo = lastActiveMsAgo !== null ? lastActiveMsAgo / (24 * 3_600_000) : null
      const breakdown = computeScore(memoryFiles, sessions, lastActiveDaysAgo, recentKills, openProposals)
      const score = breakdown.memoryScore + breakdown.activityScore + breakdown.recencyScore +
        breakdown.stabilityScore + breakdown.proposalScore
      const snap: HealthSnapshot = { date: today, score, breakdown }
      snapshots.push(snap)
      appendSnapshot(memDir, snap)
    }

    // Build 30-day window (gaps = carry forward or null)
    const snapByDate = new Map(snapshots.map((s) => [s.date, s]))
    const history: HealthSnapshot[] = dates.map((d) => {
      const s = snapByDate.get(d)
      if (s) return s
      // Carry-forward last known value to fill gaps
      const prior = snapshots.filter((x) => x.date <= d).sort((a, b) => a.date < b.date ? 1 : -1)[0]
      if (prior) return { date: d, score: prior.score, breakdown: prior.breakdown }
      return { date: d, score: 0, breakdown: { memoryScore: 0, activityScore: 0, recencyScore: 0, stabilityScore: 0, proposalScore: 0 } }
    })

    const trend = computeTrend(history)
    const variance = computeVariance(history)
    projects.push({ slug, history, trend, variance })
  }

  // Sort by variance desc (most interesting first) as default
  projects.sort((a, b) => b.variance - a.variance)

  return Response.json({ projects, generatedAt: new Date().toISOString() } satisfies HealthScoreHistoryResponse)
}

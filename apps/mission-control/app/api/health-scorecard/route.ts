import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface ScoreBreakdown {
  memoryScore: number    // 0-25
  activityScore: number  // 0-25
  recencyScore: number   // 0-20
  stabilityScore: number // 0-20
  proposalScore: number  // 0-10
}

export interface ProjectHealth {
  slug: string
  score: number
  breakdown: ScoreBreakdown
  memoryFiles: number
  sessions: number
  lastActiveDaysAgo: number | null
  openProposals: number
  recentKills: number
}

export interface HealthScorecardResponse {
  projects: ProjectHealth[]
  generatedAt: string
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function getProjectSlugs(mcdDir: string): string[] {
  const projectsDir = path.join(mcdDir, 'projects')
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

function getRealProjectPath(mcdDir: string, slug: string): string | null {
  try { return fs.realpathSync(path.join(mcdDir, 'projects', slug)) } catch { return null }
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
        if (lastModifiedMs === null || stat.mtimeMs > lastModifiedMs) {
          lastModifiedMs = stat.mtimeMs
        }
      } catch { /* skip */ }
    }
  } catch { /* dir missing */ }
  return {
    sessions,
    lastActiveMsAgo: lastModifiedMs !== null ? Date.now() - lastModifiedMs : null,
  }
}

function countRecentKills(mcdDir: string, slug: string, windowMs: number): number {
  const logPath = path.join(mcdDir, 'projects', slug, 'watchdog-kills.jsonl')
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
      const verifyReport = path.join(specclaw, ch, 'verify-report.md')
      const proposalMd = path.join(specclaw, ch, 'proposal.md')
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
  // Memory: 0-25 (linear up to 20 files = full score)
  const memoryScore = Math.round(Math.min(memoryFiles / 20, 1) * 25)

  // Activity: 0-25 (any sessions = baseline 10; scales up to 50 sessions)
  const activityScore = sessions === 0 ? 0 : Math.round(10 + Math.min((sessions - 1) / 49, 1) * 15)

  // Recency: 0-20 (last 1d=20, 7d=15, 30d=8, 90d=3, older=0)
  let recencyScore = 0
  if (lastActiveDaysAgo !== null) {
    if (lastActiveDaysAgo <= 1) recencyScore = 20
    else if (lastActiveDaysAgo <= 7) recencyScore = 15
    else if (lastActiveDaysAgo <= 30) recencyScore = 8
    else if (lastActiveDaysAgo <= 90) recencyScore = 3
  }

  // Stability: 0-20 (0 kills=20, 1=15, 2=10, 3=5, 4+=0)
  const stabilityScore = Math.max(0, 20 - recentKills * 5)

  // Proposals: 0-10 (having open proposals shows active work; 1-3 = sweet spot)
  const proposalScore = openProposals === 0 ? 5
    : openProposals <= 3 ? 10
    : openProposals <= 6 ? 8
    : 6

  return { memoryScore, activityScore, recencyScore, stabilityScore, proposalScore }
}

export async function GET(): Promise<Response> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const slugs = getProjectSlugs(mcdDir)
  const killWindow = 7 * 24 * 3_600_000
  const projects: ProjectHealth[] = []

  for (const slug of slugs) {
    const realPath = getRealProjectPath(mcdDir, slug)
    if (!realPath) continue

    const transcriptDir = getTranscriptDir(realPath)
    const memoryFiles = countMemoryFiles(realPath)
    const { sessions, lastActiveMsAgo } = getSessionData(transcriptDir)
    const recentKills = countRecentKills(mcdDir, slug, killWindow)
    const openProposals = countOpenProposals(realPath)
    const lastActiveDaysAgo = lastActiveMsAgo !== null ? lastActiveMsAgo / (24 * 3_600_000) : null

    const breakdown = computeScore(memoryFiles, sessions, lastActiveDaysAgo, recentKills, openProposals)
    const score = breakdown.memoryScore + breakdown.activityScore + breakdown.recencyScore +
      breakdown.stabilityScore + breakdown.proposalScore

    projects.push({
      slug,
      score,
      breakdown,
      memoryFiles,
      sessions,
      lastActiveDaysAgo,
      openProposals,
      recentKills,
    })
  }

  projects.sort((a, b) => b.score - a.score)

  return Response.json({ projects, generatedAt: new Date().toISOString() } satisfies HealthScorecardResponse)
}

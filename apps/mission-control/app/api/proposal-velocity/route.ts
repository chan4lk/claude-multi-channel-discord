import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

export const dynamic = 'force-dynamic'

export interface DayBucket {
  date: string // YYYY-MM-DD
  opened: number
  closed: number
}

export interface ProjectVelocity {
  slug: string
  pending: number
  inProgress: number
  done: number
  completions7d: number
  sparkline: number[] // daily completions last 7 days (index 0 = oldest)
  trend: 'up' | 'down' | 'flat'
}

export interface ProposalVelocityResponse {
  dailyBuckets: DayBucket[] // last 30 days
  projects: ProjectVelocity[]
  leaderboard: Array<{ slug: string; completions7d: number; sparkline: number[]; trend: 'up' | 'down' | 'flat' }>
  generatedAt: string
}

let cache: { data: ProposalVelocityResponse; ts: number } | null = null
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

interface ParsedProposal {
  number: number
  title: string
  status: 'done' | 'pending'
}

function parseBacklog(content: string): ParsedProposal[] {
  const proposals: ParsedProposal[] = []
  const headers = [...content.matchAll(/^## (P(\d+))\s+[—–-]\s+(.+)$/gm)]
  const statusRe = /\*\*Status:\*\*\s+`\[([x ])\] (done|pending|in-progress)`/

  for (const match of headers) {
    const num = parseInt(match[2], 10)
    const title = match[3].trim()
    const idx = match.index!
    const nextIdx = content.indexOf('\n## P', idx + 1)
    const chunk = nextIdx > -1 ? content.slice(idx, nextIdx) : content.slice(idx)
    const statusMatch = statusRe.exec(chunk)
    const status: 'done' | 'pending' = statusMatch?.[1] === 'x' ? 'done' : 'pending'
    proposals.push({ number: num, title, status })
  }

  return proposals
}

interface GitLogEntry {
  sha: string
  date: string // ISO date string
  message: string
  diff: string
}

function getBacklogGitLog(repoRoot: string): GitLogEntry[] {
  try {
    // Get commits that touched BACKLOG.md
    const out = execSync(
      'git log --format="%H\t%ai\t%s" -- BACKLOG.md',
      { cwd: repoRoot, encoding: 'utf-8', timeout: 15_000 }
    )
    return out.trim().split('\n').filter(Boolean).map((line) => {
      const parts = line.split('\t')
      return {
        sha: parts[0]?.trim() ?? '',
        date: parts[1]?.trim() ?? '',
        message: parts[2]?.trim() ?? '',
        diff: '',
      }
    })
  } catch {
    return []
  }
}

function getDiffForCommit(sha: string, repoRoot: string): string {
  try {
    return execSync(`git show ${sha} -- BACKLOG.md`, {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 10_000,
      maxBuffer: 5 * 1024 * 1024,
    })
  } catch {
    return ''
  }
}

function dateStr(isoDate: string): string {
  return isoDate.slice(0, 10)
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function GET(): Promise<Response> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return Response.json(cache.data)
  }

  const repoRoot = process.cwd()
  const backlogPath = path.join(repoRoot, 'BACKLOG.md')

  let backlogContent = ''
  try {
    backlogContent = fs.readFileSync(backlogPath, 'utf-8')
  } catch {
    const empty: ProposalVelocityResponse = {
      dailyBuckets: [],
      projects: [],
      leaderboard: [],
      generatedAt: new Date().toISOString(),
    }
    return Response.json(empty)
  }

  const proposals = parseBacklog(backlogContent)

  // Build date range: last 30 days
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dates: string[] = []
  for (let i = 29; i >= 0; i--) {
    dates.push(formatDate(addDays(today, -i)))
  }

  // Count opened per day from proposal creation (using Created: field)
  const openedByDay = new Map<string, number>()
  for (const p of proposals) {
    // Proposals are "opened" at creation — parse Created: from backlog
  }

  // Parse Created dates from backlog sections
  const createdByProposal = new Map<number, string>()
  const createdRe = /^## P(\d+)[\s\S]*?\*\*Created:\*\*\s*(\d{4}-\d{2}-\d{2})/gm
  for (const m of backlogContent.matchAll(createdRe)) {
    createdByProposal.set(parseInt(m[1], 10), m[2])
  }

  for (const p of proposals) {
    const created = createdByProposal.get(p.number)
    if (created && dates.includes(created)) {
      openedByDay.set(created, (openedByDay.get(created) ?? 0) + 1)
    }
  }

  // Get closed dates from git log diffs
  const closedByDay = new Map<string, number>()
  const gitLog = getBacklogGitLog(repoRoot)

  for (const entry of gitLog) {
    const d = dateStr(entry.date)
    if (!dates.includes(d)) continue
    // Check diff for lines like `[x] done` being added
    const diff = getDiffForCommit(entry.sha, repoRoot)
    const addedDoneLines = [...diff.matchAll(/^\+.*\[x\] done/gm)]
    if (addedDoneLines.length > 0) {
      closedByDay.set(d, (closedByDay.get(d) ?? 0) + addedDoneLines.length)
    }
  }

  const dailyBuckets: DayBucket[] = dates.map((date) => ({
    date,
    opened: openedByDay.get(date) ?? 0,
    closed: closedByDay.get(date) ?? 0,
  }))

  // Per-project breakdown — using "project" in proposal title or a single mega-backlog
  // Since this is a mono-backlog, we treat all proposals as one "fleet" project
  // and produce a single entry. Projects = number groups by 10s (rough version)
  const pending = proposals.filter((p) => p.status === 'pending').length
  const done = proposals.filter((p) => p.status === 'done').length

  // Sparkline: last 7 days of closures
  const last7 = dates.slice(-7)
  const sparkline = last7.map((d) => closedByDay.get(d) ?? 0)
  const completions7d = sparkline.reduce((a, b) => a + b, 0)

  // Compare to prior 7 days for trend
  const prior7 = dates.slice(-14, -7)
  const prior7count = prior7.reduce((sum, d) => sum + (closedByDay.get(d) ?? 0), 0)
  const trend: 'up' | 'down' | 'flat' =
    completions7d > prior7count ? 'up' : completions7d < prior7count ? 'down' : 'flat'

  const fleetProject: ProjectVelocity = {
    slug: 'fleet',
    pending,
    inProgress: 0,
    done,
    completions7d,
    sparkline,
    trend,
  }

  const result: ProposalVelocityResponse = {
    dailyBuckets,
    projects: [fleetProject],
    leaderboard: [{ slug: 'fleet', completions7d, sparkline, trend }],
    generatedAt: new Date().toISOString(),
  }

  cache = { data: result, ts: Date.now() }
  return Response.json(result)
}

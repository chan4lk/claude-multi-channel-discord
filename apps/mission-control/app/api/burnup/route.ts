import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

export const dynamic = 'force-dynamic'

export interface BurnupPoint {
  date: string
  created: number
  completed: number
  open: number
}

export interface BurnupResponse {
  series: BurnupPoint[]
  totals: { scope: number; shipped: number; open: number }
  /** Counts over the trailing 14 days. */
  rate14d: { created: number; shipped: number }
  generatedAt: string
}

interface ParsedProposal {
  number: number
  status: 'done' | 'pending'
  createdAt: string | null
}

function parseBacklog(content: string): ParsedProposal[] {
  const proposals: ParsedProposal[] = []
  const headers = [...content.matchAll(/^## P(\d+)\s+—\s+.+$/gm)]
  const statusRe = /\*\*Status:\*\*\s+`\[([x ])\]\s+(done|pending)`/
  const createdRe = /\*\*Created:\*\*\s*(\d{4}-\d{2}-\d{2})/

  for (const match of headers) {
    const num = parseInt(match[1], 10)
    const idx = match.index!
    const nextIdx = content.indexOf('\n## P', idx + 1)
    const chunk = nextIdx > -1 ? content.slice(idx, nextIdx) : content.slice(idx)
    const statusMatch = statusRe.exec(chunk)
    const status: 'done' | 'pending' = statusMatch?.[1] === 'x' ? 'done' : 'pending'
    const createdMatch = createdRe.exec(chunk)
    proposals.push({ number: num, status, createdAt: createdMatch?.[1] ?? null })
  }
  return proposals
}

function getGitLog(repoRoot: string): Array<{ message: string; date: string }> {
  try {
    const out = execSync('git log --format="%s\t%ai" --max-count=2000', {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 10_000,
    })
    return out.trim().split('\n').filter(Boolean).map((line) => {
      const [message, date] = line.split('\t')
      return { message: message?.trim() ?? '', date: (date ?? '').slice(0, 10) }
    })
  } catch {
    return []
  }
}

function dayString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function* eachDay(start: string, end: string): Generator<string> {
  const cur = new Date(start + 'T00:00:00Z')
  const last = new Date(end + 'T00:00:00Z')
  while (cur <= last) {
    yield dayString(cur)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
}

function daysAgo(today: string, n: number): string {
  const d = new Date(today + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - n)
  return dayString(d)
}

export async function GET(): Promise<Response> {
  const repoRoot = path.join(process.cwd(), '..', '..')
  const backlogPath = path.join(repoRoot, 'BACKLOG.md')

  let content = ''
  try { content = fs.readFileSync(backlogPath, 'utf-8') } catch {
    return Response.json({ error: 'BACKLOG.md not found' }, { status: 404 })
  }

  const proposals = parseBacklog(content)
  const commits = getGitLog(repoRoot)
  const today = dayString(new Date())

  // For each proposal: when it entered scope (created) and, if done, when it shipped.
  const added: string[] = []
  const completed: string[] = []

  for (const p of proposals) {
    const tag = new RegExp(`\\bP${p.number}\\b`)
    const linkedDates = commits.filter((c) => tag.test(c.message) && c.date).map((c) => c.date).sort()
    const earliestCommit = linkedDates[0] ?? null

    added.push(p.createdAt ?? earliestCommit ?? today)
    if (p.status === 'done') {
      // Shipped date = earliest linked commit, falling back to created date.
      completed.push(earliestCommit ?? p.createdAt ?? today)
    }
  }

  if (added.length === 0) {
    return Response.json({
      series: [],
      totals: { scope: 0, shipped: 0, open: 0 },
      rate14d: { created: 0, shipped: 0 },
      generatedAt: new Date().toISOString(),
    } satisfies BurnupResponse)
  }

  const start = added.slice().sort()[0]
  const series: BurnupPoint[] = []
  for (const day of eachDay(start, today)) {
    const created = added.filter((d) => d <= day).length
    const done = completed.filter((d) => d <= day).length
    series.push({ date: day, created, completed: done, open: created - done })
  }

  const last = series[series.length - 1]
  const totals = { scope: last.created, shipped: last.completed, open: last.open }

  // Trailing 14-day rates: how much scope was added vs shipped in that window.
  const cutoff = daysAgo(today, 14)
  const rate14d = {
    created: added.filter((d) => d > cutoff).length,
    shipped: completed.filter((d) => d > cutoff).length,
  }

  return Response.json({
    series, totals, rate14d, generatedAt: new Date().toISOString(),
  } satisfies BurnupResponse)
}

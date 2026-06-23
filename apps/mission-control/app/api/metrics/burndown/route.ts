import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

export const dynamic = 'force-dynamic'

export interface BurndownPoint {
  date: string
  total: number
  done: number
  remaining: number
}

export interface BurndownResponse {
  series: BurndownPoint[]
  projectedDone: string | null
  totals: { total: number; done: number; remaining: number }
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

  // For each proposal: when it entered scope (added) and, if done, when it completed.
  const added: string[] = []
  const completed: string[] = []

  for (const p of proposals) {
    // Earliest linked commit (P-number reference in commit subject).
    const tag = new RegExp(`\\bP${p.number}\\b`)
    const linkedDates = commits.filter((c) => tag.test(c.message) && c.date).map((c) => c.date).sort()
    const earliestCommit = linkedDates[0] ?? null

    const addedAt = p.createdAt ?? earliestCommit ?? today
    added.push(addedAt)

    if (p.status === 'done') {
      // Completion = earliest linked commit, fall back to created date.
      completed.push(earliestCommit ?? p.createdAt ?? today)
    }
  }

  if (added.length === 0) {
    return Response.json({
      series: [], projectedDone: null,
      totals: { total: 0, done: 0, remaining: 0 },
      generatedAt: new Date().toISOString(),
    } satisfies BurndownResponse)
  }

  const start = added.slice().sort()[0]
  const series: BurndownPoint[] = []
  for (const day of eachDay(start, today)) {
    const total = added.filter((d) => d <= day).length
    const done = completed.filter((d) => d <= day).length
    series.push({ date: day, total, done, remaining: total - done })
  }

  const last = series[series.length - 1]
  const totals = { total: last.total, done: last.done, remaining: last.remaining }

  // Projected completion: linear extrapolation from completions over the last 7 days.
  let projectedDone: string | null = null
  if (totals.remaining > 0 && series.length >= 2) {
    const window = series.slice(-8) // 7-day delta
    const doneDelta = window[window.length - 1].done - window[0].done
    const ratePerDay = doneDelta / Math.max(1, window.length - 1)
    if (ratePerDay > 0) {
      const daysLeft = Math.ceil(totals.remaining / ratePerDay)
      const proj = new Date(today + 'T00:00:00Z')
      proj.setUTCDate(proj.getUTCDate() + daysLeft)
      projectedDone = dayString(proj)
    }
  }

  return Response.json({
    series, projectedDone, totals, generatedAt: new Date().toISOString(),
  } satisfies BurndownResponse)
}

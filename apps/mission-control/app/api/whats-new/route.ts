import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import { findRouteForTitle } from '../../../components/nav-groups'

export const dynamic = 'force-dynamic'

export interface ShippedItem {
  number: number
  title: string
  href: string
  shippedAt: string
}

export interface WhatsNewResponse {
  items: ShippedItem[]
  generatedAt: string
}

interface ParsedProposal {
  number: number
  title: string
  status: 'done' | 'pending'
  createdAt: string | null
}

function parseBacklog(content: string): ParsedProposal[] {
  const proposals: ParsedProposal[] = []
  const headers = [...content.matchAll(/^## P(\d+)\s+—\s+(.+)$/gm)]
  const statusRe = /\*\*Status:\*\*\s+`\[([x ])\]\s+(done|pending)`/
  const createdRe = /\*\*Created:\*\*\s*(\d{4}-\d{2}-\d{2})/

  for (const match of headers) {
    const num = parseInt(match[1], 10)
    const title = match[2].trim()
    const idx = match.index!
    const nextIdx = content.indexOf('\n## P', idx + 1)
    const chunk = nextIdx > -1 ? content.slice(idx, nextIdx) : content.slice(idx)
    const statusMatch = statusRe.exec(chunk)
    const status: 'done' | 'pending' = statusMatch?.[1] === 'x' ? 'done' : 'pending'
    const createdMatch = createdRe.exec(chunk)
    proposals.push({ number: num, title, status, createdAt: createdMatch?.[1] ?? null })
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

const LIMIT = 6

export async function GET(): Promise<Response> {
  const repoRoot = path.join(process.cwd(), '..', '..')
  const backlogPath = path.join(repoRoot, 'BACKLOG.md')

  let content = ''
  try { content = fs.readFileSync(backlogPath, 'utf-8') } catch {
    return Response.json({ error: 'BACKLOG.md not found' }, { status: 404 })
  }

  const proposals = parseBacklog(content)
  const commits = getGitLog(repoRoot)

  const items: ShippedItem[] = []
  for (const p of proposals) {
    if (p.status !== 'done') continue
    const route = findRouteForTitle(p.title)
    if (!route) continue // AC3: omit proposals without a known route — no dead links

    // AC5: ship date = earliest linked commit date, falling back to Created date.
    const tag = new RegExp(`\\bP${p.number}\\b`)
    const linkedDates = commits.filter((c) => tag.test(c.message) && c.date).map((c) => c.date).sort()
    const shippedAt = linkedDates[0] ?? p.createdAt ?? ''

    items.push({ number: p.number, title: p.title, href: route.href, shippedAt })
  }

  // Order by ship date desc (then proposal number desc as a tiebreak), keep the last N.
  items.sort((a, b) => (b.shippedAt.localeCompare(a.shippedAt)) || (b.number - a.number))
  const recent = items.slice(0, LIMIT)

  return Response.json({
    items: recent,
    generatedAt: new Date().toISOString(),
  } satisfies WhatsNewResponse)
}

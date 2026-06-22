import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export type EffortSize = 'S' | 'M' | 'L'

export interface SequenceProposal {
  id: string
  number: number
  title: string
  status: 'done' | 'pending'
  category: string
  dependsOn: number[]
}

export interface SequenceResponse {
  proposals: SequenceProposal[]
  categories: string[]
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  graph:       ['graph', '3d', 'galaxy', 'constellation', 'treemap', 'force-graph'],
  memory:      ['memory', 'knowledge', 'audit trail'],
  alerts:      ['alert', 'stall', 'watchdog', 'push notif'],
  scheduler:   ['schedule', 'scheduler', 'calendar', 'cron'],
  metrics:     ['metric', 'score', 'budget', 'token', 'volume', 'gauge', 'sparkline', 'benchmark', 'convergence'],
  timeline:    ['timeline', 'gantt', 'snapshot', 'replay', 'heatmap', 'history'],
  pipeline:    ['pipeline', 'specclaw', 'traceability', 'proposal', 'backlog', 'kanban', 'sequence'],
  fleet:       ['fleet', 'health bar', 'broadcast', 'whatsapp'],
  operations:  ['inject', 'terminal', 'command', 'template'],
  live:        ['live', 'activity feed', 'ticker', 'stream', 'ambient', 'thought'],
  project:     ['project graph', 'spotlight', 'compare', 'detail page', 'lifecycle', 'project feed', 'deep dive'],
  search:      ['search', 'semantic', 'advisor', 'intelligence'],
  reports:     ['report', 'weekly', 'export', 'csv'],
  diff:        ['diff viewer', 'diff'],
  navigation:  ['navigation', 'palette', 'preset', 'section visibility', 'dashboard mode'],
}

const CATEGORY_ORDER = Object.keys(CATEGORY_KEYWORDS)

function classifyCategory(title: string): string {
  const lower = title.toLowerCase()
  for (const cat of CATEGORY_ORDER) {
    for (const kw of CATEGORY_KEYWORDS[cat]) {
      if (lower.includes(kw)) return cat
    }
  }
  return 'other'
}

function extractDependencies(body: string): number[] {
  const deps = new Set<number>()
  const re = /\bP(\d+)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    deps.add(parseInt(m[1], 10))
  }
  return [...deps]
}

function parseBacklog(content: string): SequenceProposal[] {
  const results: SequenceProposal[] = []
  const headerRe = /^## (P(\d+))\s+[—–-]\s+(.+)$/gm
  const statusRe = /\*\*Status:\*\*\s+`\[([ x])\].*?`/

  const headers = [...content.matchAll(headerRe)]
  for (let i = 0; i < headers.length; i++) {
    const match = headers[i]
    const num = parseInt(match[2], 10)
    const title = match[3].trim()
    const start = match.index!
    const end = i + 1 < headers.length ? headers[i + 1].index! : content.length
    const chunk = content.slice(start, end)
    const statusMatch = statusRe.exec(chunk)
    const status: 'done' | 'pending' = statusMatch?.[1] === 'x' ? 'done' : 'pending'
    const category = classifyCategory(title)
    const allRefs = extractDependencies(chunk)
    const dependsOn = allRefs.filter((n) => n !== num)

    results.push({
      id: `P${num}`,
      number: num,
      title,
      status,
      category,
      dependsOn,
    })
  }
  return results
}

export async function GET(): Promise<Response> {
  const backlogPath = path.join(process.cwd(), '..', '..', 'BACKLOG.md')
  let content = ''
  try { content = fs.readFileSync(backlogPath, 'utf-8') } catch {
    try { content = fs.readFileSync(path.join(process.cwd(), 'BACKLOG.md'), 'utf-8') } catch {}
  }

  const proposals = parseBacklog(content)
  const categorySet = new Set<string>()
  for (const p of proposals) categorySet.add(p.category)
  const categories = CATEGORY_ORDER.filter((c) => categorySet.has(c))
  if (categorySet.has('other')) categories.push('other')

  return Response.json({ proposals, categories } satisfies SequenceResponse)
}

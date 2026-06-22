import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

export const dynamic = 'force-dynamic'

export interface ProposalGraphNode {
  id: string
  number: number
  title: string
  status: 'done' | 'pending'
  commitCount: number
  category: string
  body: string
}

export interface ProposalGraphEdge {
  source: string
  target: string
}

export interface ProposalGraphResponse {
  nodes: ProposalGraphNode[]
  edges: ProposalGraphEdge[]
  categories: string[]
  generatedAt: string
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  graph: ['graph', '3d', 'galaxy', 'constellation', 'treemap', 'force-graph'],
  memory: ['memory', 'knowledge', 'audit trail'],
  alerts: ['alert', 'stall', 'watchdog', 'push notif'],
  scheduler: ['schedule', 'scheduler', 'calendar', 'cron'],
  metrics: ['metric', 'score', 'budget', 'token', 'volume', 'gauge', 'sparkline', 'benchmark'],
  timeline: ['timeline', 'gantt', 'snapshot', 'replay', 'heatmap', 'history'],
  pipeline: ['pipeline', 'specclaw', 'traceability', 'proposal', 'backlog', 'kanban'],
  fleet: ['fleet', 'health bar', 'broadcast', 'whatsapp'],
  operations: ['inject', 'terminal', 'command', 'template'],
  live: ['live', 'activity feed', 'ticker', 'stream', 'ambient', 'thought'],
  project: ['project graph', 'spotlight', 'compare', 'detail page', 'lifecycle', 'project feed'],
  search: ['search', 'semantic', 'advisor', 'intelligence'],
  reports: ['report', 'weekly', 'export', 'csv'],
  diff: ['diff viewer', 'diff'],
  navigation: ['navigation', 'palette', 'preset', 'section visibility', 'dashboard mode'],
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

function parseBacklogFull(content: string): Array<{
  number: number
  title: string
  status: 'done' | 'pending'
  body: string
}> {
  const results: Array<{ number: number; title: string; status: 'done' | 'pending'; body: string }> = []
  const headerRe = /^## (P(\d+))\s+—\s+(.+)$/gm
  const statusRe = /\*\*Status:\*\*\s+`\[([x ])\].*?`/

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
    results.push({ number: num, title, status, body: chunk })
  }
  return results
}

function extractCrossRefs(body: string, selfNum: number, knownNums: Set<number>): number[] {
  const refs = new Set<number>()
  const re = /\bP(\d+)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const n = parseInt(m[1], 10)
    if (n !== selfNum && knownNums.has(n)) refs.add(n)
  }
  return [...refs]
}

function getGitLog(repoRoot: string): Array<{ sha: string; message: string }> {
  try {
    const out = execSync('git log --oneline --format="%H\t%s" --max-count=2000', {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 10_000,
    })
    return out.trim().split('\n').filter(Boolean).map((line) => {
      const [sha, ...rest] = line.split('\t')
      return { sha: sha.trim(), message: rest.join('\t').trim() }
    })
  } catch {
    return []
  }
}

export async function GET(): Promise<Response> {
  const repoRoot = path.join(process.cwd(), '..', '..')
  const backlogPath = path.join(repoRoot, 'BACKLOG.md')

  let content = ''
  try {
    content = fs.readFileSync(backlogPath, 'utf-8')
  } catch {
    return Response.json({ error: 'BACKLOG.md not found' }, { status: 404 })
  }

  const raw = parseBacklogFull(content)
  const knownNums = new Set(raw.map((p) => p.number))
  const commits = getGitLog(repoRoot)

  const nodes: ProposalGraphNode[] = raw.map((p) => {
    const pTag = new RegExp(`\\bP${p.number}\\b`)
    const commitCount = commits.filter((c) => pTag.test(c.message)).length
    return {
      id: `P${p.number}`,
      number: p.number,
      title: p.title,
      status: p.status,
      commitCount,
      category: classifyCategory(p.title),
      body: p.body,
    }
  })

  const edges: ProposalGraphEdge[] = []
  for (const p of raw) {
    const refs = extractCrossRefs(p.body, p.number, knownNums)
    for (const ref of refs) {
      edges.push({ source: `P${p.number}`, target: `P${ref}` })
    }
  }

  const categories = [...new Set(nodes.map((n) => n.category))].sort()

  return Response.json({
    nodes,
    edges,
    categories,
    generatedAt: new Date().toISOString(),
  } satisfies ProposalGraphResponse)
}

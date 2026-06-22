import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

export const dynamic = 'force-dynamic'

export interface ProposalImpact {
  riskScore: number       // 0-100
  complexityScore: number // 0-100
  surfaceScore: number    // 0-100
  depsScore: number       // 0-100
  acCount: number
  estimatedMinutes: number
  fileTypes: string[]
  linkedProposals: string[]
}

export interface ProposalGraphNode {
  id: string
  number: number
  title: string
  status: 'done' | 'pending'
  commitCount: number
  category: string
  body: string
  impact?: ProposalImpact
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

const FILE_TYPE_RE = /\.(tsx?|json|md|sh|sql|css|ya?ml|toml)\b/gi

function computeImpact(body: string, selfNum: number, knownNums: Set<number>, allNodes: Array<{ number: number }>): ProposalImpact {
  // Count ACs
  const acMatches = [...body.matchAll(/^- AC\d+:/gm)]
  const acCount = acMatches.length

  // Word count of AC section only
  const acSection = acMatches.map((m) => {
    const idx = body.indexOf(m[0])
    return body.slice(idx, idx + 300)
  }).join(' ')
  const acWordCount = acSection.split(/\s+/).filter(Boolean).length
  const estimatedMinutes = Math.round(acWordCount * 0.5)

  // File types mentioned in solution text
  const fileTypes = [...new Set([...body.matchAll(FILE_TYPE_RE)].map((m) => m[1].toLowerCase()))]

  // Referenced proposal IDs
  const linkedProposals: string[] = []
  const refRe = /\bP(\d+)\b/g
  let m: RegExpExecArray | null
  while ((m = refRe.exec(body)) !== null) {
    const n = parseInt(m[1], 10)
    if (n !== selfNum && knownNums.has(n)) linkedProposals.push(`P${n}`)
  }
  const uniqueLinked = [...new Set(linkedProposals)]

  // Scores normalised 0-100
  // Complexity: saturates at 500 AC-words (~250 min)
  const complexityScore = Math.min(100, Math.round((estimatedMinutes / 250) * 100))
  // Surface: saturates at 6 distinct file types
  const surfaceScore = Math.min(100, Math.round((fileTypes.length / 6) * 100))
  // Deps: saturates at 10 cross-refs
  const depsScore = Math.min(100, Math.round((uniqueLinked.length / 10) * 100))
  // Risk
  const riskScore = Math.round(complexityScore * 0.4 + surfaceScore * 0.4 + depsScore * 0.2)

  void allNodes
  return { riskScore, complexityScore, surfaceScore, depsScore, acCount, estimatedMinutes, fileTypes, linkedProposals: uniqueLinked }
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
    const impact = p.status === 'pending' ? computeImpact(p.body, p.number, knownNums, raw) : undefined
    return {
      id: `P${p.number}`,
      number: p.number,
      title: p.title,
      status: p.status,
      commitCount,
      category: classifyCategory(p.title),
      body: p.body,
      impact,
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

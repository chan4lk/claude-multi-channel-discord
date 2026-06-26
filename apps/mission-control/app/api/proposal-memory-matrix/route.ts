import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface ProposalInfo {
  title: string
  keywords: string[]
  projectSlug: string
}

export interface ProposalMemoryMatrixResponse {
  proposals: ProposalInfo[]
  projects: string[]
  matrix: number[][]          // [proposalIdx][projectIdx] = overlap score 0–1
  matchedKeywords: string[][][] // [proposalIdx][projectIdx] = matched keyword list
  generatedAt: string
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

function getProjectDir(mcdDir: string, slug: string): string | null {
  const p = path.join(mcdDir, 'projects', slug)
  try { return fs.realpathSync(p) } catch { return null }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .filter((t) => !STOPWORDS.has(t))
}

const STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'will', 'been', 'they',
  'their', 'each', 'when', 'what', 'which', 'there', 'where', 'some',
  'also', 'into', 'only', 'more', 'most', 'such', 'than', 'then',
  'show', 'page', 'data', 'view', 'list', 'adds', 'added', 'returns',
])

function extractProposals(projectDir: string, slug: string): ProposalInfo[] {
  const specclaw = path.join(projectDir, '.specclaw', 'changes')
  const proposals: ProposalInfo[] = []
  try {
    if (!fs.existsSync(specclaw)) return []
    for (const change of fs.readdirSync(specclaw)) {
      const proposalFile = path.join(specclaw, change, 'proposal.md')
      try {
        const content = fs.readFileSync(proposalFile, 'utf-8')
        const titleMatch = content.match(/^#\s+(.+)$/m)
        const title = titleMatch ? titleMatch[1]!.trim() : change
        const keywords = [...new Set(tokenize(content))]
        proposals.push({ title, keywords, projectSlug: slug })
      } catch { /* skip */ }
    }
  } catch { /* no .specclaw */ }
  return proposals
}

function getMemoryKeywords(projectDir: string): Set<string> {
  const memDir = path.join(projectDir, 'memory')
  const keywords = new Set<string>()
  try {
    if (!fs.existsSync(memDir)) return keywords
    for (const f of fs.readdirSync(memDir).filter((f) => f.endsWith('.md'))) {
      try {
        const content = fs.readFileSync(path.join(memDir, f), 'utf-8')
        // Extract description from frontmatter + body keywords
        const descMatch = content.match(/^description:\s*(.+)$/m)
        if (descMatch) tokenize(descMatch[1]!).forEach((t) => keywords.add(t))
        // Also tokenize full content for broader coverage
        tokenize(content.slice(0, 2000)).forEach((t) => keywords.add(t))
      } catch { /* skip */ }
    }
  } catch { /* no memory dir */ }
  return keywords
}

function overlap(proposalKeywords: string[], memoryKeywords: Set<string>): { score: number; matched: string[] } {
  if (proposalKeywords.length === 0) return { score: 0, matched: [] }
  const matched = proposalKeywords.filter((k) => memoryKeywords.has(k))
  const score = matched.length / Math.sqrt(proposalKeywords.length)
  return { score: Math.min(1, score), matched }
}

export async function GET(): Promise<Response> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const slugs = getProjectSlugs(mcdDir)

  // Gather all proposals across all projects
  const allProposals: ProposalInfo[] = []
  const memoryKeywordsBySlug = new Map<string, Set<string>>()

  for (const slug of slugs) {
    const dir = getProjectDir(mcdDir, slug)
    if (!dir) continue
    allProposals.push(...extractProposals(dir, slug))
    memoryKeywordsBySlug.set(slug, getMemoryKeywords(dir))
  }

  if (allProposals.length === 0) {
    return Response.json({
      proposals: [],
      projects: [],
      matrix: [],
      matchedKeywords: [],
      generatedAt: new Date().toISOString(),
    } satisfies ProposalMemoryMatrixResponse)
  }

  // Deduplicate proposals by title, keep max 20
  const seen = new Set<string>()
  const dedupedProposals = allProposals.filter((p) => {
    if (seen.has(p.title)) return false
    seen.add(p.title)
    return true
  }).slice(0, 20)

  const projects = slugs.filter((s) => (memoryKeywordsBySlug.get(s)?.size ?? 0) > 0).slice(0, 20)

  // Build matrix
  const matrix: number[][] = []
  const matchedKeywords: string[][][] = []

  for (const proposal of dedupedProposals) {
    const row: number[] = []
    const matchRow: string[][] = []
    for (const slug of projects) {
      const memKw = memoryKeywordsBySlug.get(slug) ?? new Set()
      const { score, matched } = overlap(proposal.keywords, memKw)
      row.push(Math.round(score * 100) / 100)
      matchRow.push(matched.slice(0, 8))
    }
    matrix.push(row)
    matchedKeywords.push(matchRow)
  }

  // Sort proposals by max column score desc
  const indices = dedupedProposals.map((_, i) => i)
  indices.sort((a, b) => Math.max(...(matrix[b] ?? [0])) - Math.max(...(matrix[a] ?? [0])))

  return Response.json({
    proposals: indices.map((i) => dedupedProposals[i]!),
    projects,
    matrix: indices.map((i) => matrix[i]!),
    matchedKeywords: indices.map((i) => matchedKeywords[i]!),
    generatedAt: new Date().toISOString(),
  } satisfies ProposalMemoryMatrixResponse)
}

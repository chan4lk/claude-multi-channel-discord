import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface MemoryCorrelationResponse {
  projects: string[]           // ordered list of slugs
  matrix: number[][]           // NxN, values 0–1
  topConcepts: { concept: string; count: number; projects: string[] }[]
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

/** Read all memory/*.md files and extract [[link]] references */
function extractConcepts(realPath: string): { conceptSet: Set<string>; conceptCounts: Map<string, number> } {
  const memDir = path.join(realPath, 'memory')
  const conceptSet = new Set<string>()
  const conceptCounts = new Map<string, number>()

  let files: string[]
  try {
    files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md'))
  } catch { return { conceptSet, conceptCounts } }

  const linkRe = /\[\[([^\]]+)\]\]/g

  for (const file of files) {
    let content = ''
    try { content = fs.readFileSync(path.join(memDir, file), 'utf-8') } catch { continue }

    let m: RegExpExecArray | null
    linkRe.lastIndex = 0
    while ((m = linkRe.exec(content)) !== null) {
      const concept = m[1]!.trim().toLowerCase()
      if (!concept) continue
      conceptSet.add(concept)
      conceptCounts.set(concept, (conceptCounts.get(concept) ?? 0) + 1)
    }
  }

  return { conceptSet, conceptCounts }
}

/** Jaccard similarity between two sets */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

export async function GET(): Promise<Response> {
  const dir = mcdDir()
  const slugs = getProjectSlugs(dir)

  // Build per-project concept data
  const projectData: { slug: string; conceptSet: Set<string>; conceptCounts: Map<string, number> }[] = []

  for (const slug of slugs) {
    const realPath = getRealProjectPath(dir, slug)
    if (!realPath) continue
    const { conceptSet, conceptCounts } = extractConcepts(realPath)
    projectData.push({ slug, conceptSet, conceptCounts })
  }

  // Filter out projects with 0 concepts
  const withConcepts = projectData.filter((p) => p.conceptSet.size > 0)

  if (withConcepts.length < 2) {
    return Response.json({
      projects: [],
      matrix: [],
      topConcepts: [],
      generatedAt: new Date().toISOString(),
    } satisfies MemoryCorrelationResponse)
  }

  const projects = withConcepts.map((p) => p.slug)
  const n = projects.length

  // Build NxN correlation matrix
  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    matrix[i]![i] = 1.0
    for (let j = i + 1; j < n; j++) {
      const sim = jaccard(withConcepts[i]!.conceptSet, withConcepts[j]!.conceptSet)
      matrix[i]![j] = sim
      matrix[j]![i] = sim
    }
  }

  // Aggregate concept counts across all projects + track which projects reference each concept
  const globalConcepts = new Map<string, { count: number; projects: Set<string> }>()
  for (const { slug, conceptCounts } of withConcepts) {
    for (const [concept, count] of conceptCounts) {
      const existing = globalConcepts.get(concept)
      if (existing) {
        existing.count += count
        existing.projects.add(slug)
      } else {
        globalConcepts.set(concept, { count, projects: new Set([slug]) })
      }
    }
  }

  // Top 10 concepts by total mention count
  const topConcepts = Array.from(globalConcepts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([concept, { count, projects: projSet }]) => ({
      concept,
      count,
      projects: Array.from(projSet).sort(),
    }))

  return Response.json({
    projects,
    matrix,
    topConcepts,
    generatedAt: new Date().toISOString(),
  } satisfies MemoryCorrelationResponse)
}

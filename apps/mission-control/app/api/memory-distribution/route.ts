import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference' | 'other'
export const MEMORY_TYPES: MemoryType[] = ['user', 'feedback', 'project', 'reference', 'other']

export interface ProjectMemoryDistribution {
  slug: string
  total: number
  counts: Record<MemoryType, number>
  dominant: MemoryType | null
}

export interface MemoryDistributionResponse {
  projects: ProjectMemoryDistribution[]
  fleetCounts: Record<MemoryType, number>
  fleetTotal: number
}

function parseMemoryType(content: string): MemoryType {
  const m = content.match(/^---[\s\S]*?^metadata:\s*\n([\s\S]*?)^---/m)
  if (m) {
    const metaBlock = m[1] ?? ''
    const typeMatch = metaBlock.match(/^\s*type:\s*(\w+)/m)
    if (typeMatch) {
      const t = typeMatch[1]?.toLowerCase() ?? ''
      if (t === 'user' || t === 'feedback' || t === 'project' || t === 'reference') return t
    }
  }
  // Also try top-level type: in frontmatter
  const topMatch = content.match(/^---[\s\S]*?type:\s*(\w+)[\s\S]*?^---/m)
  if (topMatch) {
    const t = topMatch[1]?.toLowerCase() ?? ''
    if (t === 'user' || t === 'feedback' || t === 'project' || t === 'reference') return t
  }
  return 'other'
}

function emptyDist(): Record<MemoryType, number> {
  return { user: 0, feedback: 0, project: 0, reference: 0, other: 0 }
}

function analyzeProject(projectDir: string, slug: string): ProjectMemoryDistribution | null {
  const memDir = path.join(projectDir, 'memory')
  let files: string[]
  try {
    files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')
  } catch { return null }

  if (files.length === 0) return null

  const counts = emptyDist()
  for (const filename of files) {
    const fp = path.join(memDir, filename)
    let content = ''
    try { content = fs.readFileSync(fp, 'utf-8') } catch { continue }
    const t = parseMemoryType(content)
    counts[t]++
  }

  const total = files.length
  let dominant: MemoryType | null = null
  let maxCount = 0
  for (const t of MEMORY_TYPES) {
    if (counts[t] > maxCount) { maxCount = counts[t]; dominant = t }
  }

  return { slug, total, counts, dominant }
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ projects: [], fleetCounts: emptyDist(), fleetTotal: 0 })
  }

  const projectsDir = path.join(mcdDir, 'projects')
  let slugs: string[] = []
  try {
    slugs = fs.readdirSync(projectsDir).filter((s) => {
      if (s.startsWith('.')) return false
      try {
        const st = fs.statSync(path.join(projectsDir, s))
        return st.isDirectory() || st.isSymbolicLink()
      } catch { return false }
    })
  } catch { /* ok */ }

  const projects: ProjectMemoryDistribution[] = []
  for (const slug of slugs) {
    const p = analyzeProject(path.join(projectsDir, slug), slug)
    if (p) projects.push(p)
  }

  projects.sort((a, b) => b.total - a.total)

  const fleetCounts = emptyDist()
  for (const p of projects) {
    for (const t of MEMORY_TYPES) fleetCounts[t] += p.counts[t]
  }
  const fleetTotal = MEMORY_TYPES.reduce((s, t) => s + fleetCounts[t], 0)

  return Response.json({ projects, fleetCounts, fleetTotal } satisfies MemoryDistributionResponse)
}

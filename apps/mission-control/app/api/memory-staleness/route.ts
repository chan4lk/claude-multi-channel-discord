import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export interface StalenessAxes {
  freshness: number   // 0-100: newest memory age; 0d=100, 30d+=0
  density: number     // 0-100: memories added per week vs project age; ≥1/week=100
  diversity: number   // 0-100: distinct frontmatter types present; 4=100, 3=75, 2=50, 1=25
  depth: number       // 0-100: avg body word count per memory; ≥200=100 linear
  coverage: number    // 0-100: memory files vs estimated transcript turns; ≥1 mem/10 turns=100
}

export interface ProjectStaleness {
  slug: string
  axes: StalenessAxes
  stalenessScore: number  // 0-100 composite (higher = less stale)
  memoryFileCount: number
  oldestMemAgeDays: number
  newestMemAgeDays: number
  projectAgeDays: number
}

export interface MemoryStalenessResponse {
  projects: ProjectStaleness[]
  generatedAt: string
}

let cache: { data: MemoryStalenessResponse; ts: number } | null = null
const CACHE_TTL_MS = 60 * 60 * 1000

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function scoreFreshness(newestAgeMs: number): number {
  const days = newestAgeMs / (24 * 60 * 60 * 1000)
  if (days <= 0) return 100
  if (days >= 30) return 0
  return Math.round(clamp((1 - days / 30) * 100, 0, 100))
}

function scoreDensity(fileCount: number, projectAgeDays: number): number {
  if (projectAgeDays <= 0) return fileCount > 0 ? 100 : 0
  const weeksAge = projectAgeDays / 7
  const memsPerWeek = fileCount / weeksAge
  return Math.round(clamp(memsPerWeek * 100, 0, 100))
}

function scoreDiversity(types: Set<string>): number {
  const count = types.size
  return Math.round(clamp((count / 4) * 100, 0, 100))
}

function scoreDepth(avgWords: number): number {
  return Math.round(clamp((avgWords / 200) * 100, 0, 100))
}

function scoreCoverage(fileCount: number, turns: number): number {
  if (turns === 0) return fileCount > 0 ? 100 : 0
  const ratio = fileCount / turns
  return Math.round(clamp(ratio * 1000, 0, 100))
}

const FRONTMATTER_TYPE_RE = /^type:\s*(\w+)/m

function extractType(content: string): string {
  const m = content.match(FRONTMATTER_TYPE_RE)
  return m ? m[1] : 'unknown'
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function estimateTurns(projectDir: string): number {
  // Count turn entries in any transcript JSONL files under the project's session
  try {
    const sessionIdFile = path.join(projectDir, '.session-id')
    if (!fs.existsSync(sessionIdFile)) return 0
    const sessionId = fs.readFileSync(sessionIdFile, 'utf-8').trim()
    if (!sessionId) return 0

    const homeDir = process.env.HOME || '/root'
    const claudeProjectsDir = path.join(homeDir, '.claude', 'projects')
    let turnCount = 0

    try {
      const dirs = fs.readdirSync(claudeProjectsDir)
      for (const dir of dirs) {
        const jsonlPath = path.join(claudeProjectsDir, dir, `${sessionId}.jsonl`)
        try {
          const content = fs.readFileSync(jsonlPath, 'utf-8')
          // Each line is a JSON record; count "human" role lines as turns
          turnCount += content.split('\n').filter((l) => {
            try { return JSON.parse(l)?.role === 'human' } catch { return false }
          }).length
          break
        } catch { /* not found */ }
      }
    } catch { /* ignore */ }

    return turnCount
  } catch {
    return 0
  }
}

function analyzeProject(projectDir: string, slug: string): ProjectStaleness | null {
  const memDir = path.join(projectDir, 'memory')
  let files: string[] = []
  try {
    files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')
  } catch {
    return null
  }

  if (files.length === 0) return null

  const now = Date.now()
  let newestMs = 0
  let oldestMs = Infinity
  let projectCreatedMs = now
  const types = new Set<string>()
  let totalBodyWords = 0

  for (const filename of files) {
    const fp = path.join(memDir, filename)
    try {
      const stat = fs.statSync(fp)
      if (stat.mtimeMs > newestMs) newestMs = stat.mtimeMs
      if (stat.mtimeMs < oldestMs) oldestMs = stat.mtimeMs
      if (stat.birthtimeMs < projectCreatedMs) projectCreatedMs = stat.birthtimeMs
      const content = fs.readFileSync(fp, 'utf-8')
      types.add(extractType(content))
      // Body = everything after second ---
      const bodyStart = content.indexOf('---', content.indexOf('---') + 3)
      const body = bodyStart >= 0 ? content.slice(bodyStart + 3) : content
      totalBodyWords += countWords(body)
    } catch { /* skip */ }
  }

  if (!isFinite(oldestMs)) oldestMs = newestMs

  // Estimate project age from oldest memory file
  const projectAgeDays = (now - oldestMs) / (24 * 60 * 60 * 1000)
  const newestMemAgeDays = (now - newestMs) / (24 * 60 * 60 * 1000)
  const oldestMemAgeDays = (now - oldestMs) / (24 * 60 * 60 * 1000)
  const avgWords = files.length > 0 ? totalBodyWords / files.length : 0
  const turns = estimateTurns(projectDir)

  const axes: StalenessAxes = {
    freshness: scoreFreshness(now - newestMs),
    density: scoreDensity(files.length, projectAgeDays),
    diversity: scoreDiversity(types),
    depth: scoreDepth(avgWords),
    coverage: scoreCoverage(files.length, turns),
  }

  const stalenessScore = Math.round(
    (axes.freshness + axes.density + axes.diversity + axes.depth + axes.coverage) / 5
  )

  return {
    slug,
    axes,
    stalenessScore,
    memoryFileCount: files.length,
    oldestMemAgeDays: Math.round(oldestMemAgeDays * 10) / 10,
    newestMemAgeDays: Math.round(newestMemAgeDays * 10) / 10,
    projectAgeDays: Math.round(projectAgeDays * 10) / 10,
  }
}

export async function GET(): Promise<Response> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return Response.json(cache.data)
  }

  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ projects: [], generatedAt: new Date().toISOString() })
  }

  const projectsDir = path.join(mcdDir, 'projects')
  let slugs: string[] = []
  try {
    slugs = fs.readdirSync(projectsDir).filter((s) => {
      if (s.startsWith('.')) return false
      try {
        const stat = fs.statSync(path.join(projectsDir, s))
        return stat.isDirectory() || stat.isSymbolicLink()
      } catch { return false }
    })
  } catch { slugs = [] }

  const projects: ProjectStaleness[] = []
  for (const slug of slugs) {
    const result = analyzeProject(path.join(projectsDir, slug), slug)
    if (result) projects.push(result)
  }

  // Sort by staleness score desc (least stale first)
  projects.sort((a, b) => b.stalenessScore - a.stalenessScore)

  const result: MemoryStalenessResponse = {
    projects,
    generatedAt: new Date().toISOString(),
  }

  cache = { data: result, ts: Date.now() }
  return Response.json(result)
}

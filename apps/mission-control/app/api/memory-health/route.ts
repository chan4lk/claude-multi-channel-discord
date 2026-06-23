import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export interface MemoryHealthDimensions {
  recency: number    // 0-100: last modified < 7 days = 100, linear decay to 0 at 30d+
  coverage: number   // 0-100: file count >= 3 = 100, 2 = 67, 1 = 33, 0 = 0
  density: number    // 0-100: word count >= 500 = 100, linear
  stability: number  // 0-100: inverse drift (low stale fraction = high score)
  freshness: number  // 0 or 100: memory modified after last transcript write
}

export interface ProjectMemoryHealth {
  slug: string
  dimensions: MemoryHealthDimensions
  composite: number // average of 5 dims
  memoryFileCount: number
  totalWords: number
  lastModifiedDaysAgo: number
  color: 'green' | 'amber' | 'red'
}

export interface MemoryHealthResponse {
  projects: ProjectMemoryHealth[]
  fleetAvg: MemoryHealthDimensions
  generatedAt: string
}

let cache: { data: MemoryHealthResponse; ts: number } | null = null
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function scoreRecency(lastModifiedMs: number): number {
  const ageDays = (Date.now() - lastModifiedMs) / (24 * 60 * 60 * 1000)
  if (ageDays < 7) return 100
  if (ageDays >= 30) return 0
  return Math.round(clamp((30 - ageDays) / 23 * 100, 0, 100))
}

function scoreCoverage(fileCount: number): number {
  if (fileCount >= 3) return 100
  if (fileCount === 2) return 67
  if (fileCount === 1) return 33
  return 0
}

function scoreDensity(wordCount: number): number {
  if (wordCount >= 500) return 100
  return Math.round(clamp((wordCount / 500) * 100, 0, 100))
}

function scoreStability(staleCount: number, totalCount: number): number {
  if (totalCount === 0) return 50
  const staleFraction = staleCount / totalCount
  return Math.round(clamp((1 - staleFraction) * 100, 0, 100))
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function getLatestTranscriptMs(projectDir: string): number | null {
  // Claude transcripts are in ~/.claude/projects/<encoded-path>/
  // We look for .jsonl files in the project's .session-id sibling dir
  // Simpler: check for any .jsonl in the claude projects transcript dir
  try {
    const sessionIdFile = path.join(projectDir, '.session-id')
    if (!fs.existsSync(sessionIdFile)) return null
    const sessionId = fs.readFileSync(sessionIdFile, 'utf-8').trim()
    if (!sessionId) return null

    // Claude transcripts: ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
    const homeDir = process.env.HOME || '/root'
    const claudeProjectsDir = path.join(homeDir, '.claude', 'projects')

    // Find matching jsonl
    let latest = 0
    try {
      const encodedDirs = fs.readdirSync(claudeProjectsDir)
      for (const dir of encodedDirs) {
        const jsonlPath = path.join(claudeProjectsDir, dir, `${sessionId}.jsonl`)
        try {
          const stat = fs.statSync(jsonlPath)
          if (stat.mtimeMs > latest) latest = stat.mtimeMs
        } catch { /* not found */ }
      }
    } catch { /* ignore */ }

    return latest > 0 ? latest : null
  } catch {
    return null
  }
}

function analyzeProject(projectDir: string, slug: string): ProjectMemoryHealth | null {
  const memDir = path.join(projectDir, 'memory')
  let files: string[] = []
  try {
    files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')
  } catch {
    return null
  }

  if (files.length === 0) return null

  const STALE_MS = 30 * 24 * 60 * 60 * 1000
  let latestMemModMs = 0
  let staleCount = 0
  let totalWords = 0

  for (const filename of files) {
    const fp = path.join(memDir, filename)
    try {
      const stat = fs.statSync(fp)
      if (stat.mtimeMs > latestMemModMs) latestMemModMs = stat.mtimeMs
      if (Date.now() - stat.mtimeMs > STALE_MS) staleCount++
      const content = fs.readFileSync(fp, 'utf-8')
      totalWords += countWords(content)
    } catch { /* skip */ }
  }

  const lastModifiedDaysAgo = (Date.now() - latestMemModMs) / (24 * 60 * 60 * 1000)

  // Freshness: memory modified after last transcript write?
  const transcriptMs = getLatestTranscriptMs(projectDir)
  const fresh = transcriptMs !== null && latestMemModMs >= transcriptMs

  const dimensions: MemoryHealthDimensions = {
    recency: scoreRecency(latestMemModMs),
    coverage: scoreCoverage(files.length),
    density: scoreDensity(totalWords),
    stability: scoreStability(staleCount, files.length),
    freshness: fresh ? 100 : 0,
  }

  const composite = Math.round(
    (dimensions.recency + dimensions.coverage + dimensions.density + dimensions.stability + dimensions.freshness) / 5
  )

  const color: 'green' | 'amber' | 'red' =
    composite >= 70 ? 'green' : composite >= 40 ? 'amber' : 'red'

  return {
    slug,
    dimensions,
    composite,
    memoryFileCount: files.length,
    totalWords,
    lastModifiedDaysAgo: Math.round(lastModifiedDaysAgo * 10) / 10,
    color,
  }
}

export async function GET(): Promise<Response> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return Response.json(cache.data)
  }

  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    const empty: MemoryHealthResponse = {
      projects: [],
      fleetAvg: { recency: 0, coverage: 0, density: 0, stability: 0, freshness: 0 },
      generatedAt: new Date().toISOString(),
    }
    return Response.json(empty)
  }

  const projectsDir = path.join(mcdDir, 'projects')
  let slugs: string[] = []
  try {
    slugs = fs.readdirSync(projectsDir).filter((s) => {
      if (s.startsWith('.')) return false
      const stat = fs.statSync(path.join(projectsDir, s))
      return stat.isDirectory() || stat.isSymbolicLink()
    })
  } catch {
    slugs = []
  }

  const projects: ProjectMemoryHealth[] = []
  for (const slug of slugs) {
    const projectDir = path.join(projectsDir, slug)
    const health = analyzeProject(projectDir, slug)
    if (health) projects.push(health)
  }

  // Fleet average
  const fleetAvg: MemoryHealthDimensions = {
    recency: 0,
    coverage: 0,
    density: 0,
    stability: 0,
    freshness: 0,
  }
  if (projects.length > 0) {
    for (const p of projects) {
      fleetAvg.recency += p.dimensions.recency
      fleetAvg.coverage += p.dimensions.coverage
      fleetAvg.density += p.dimensions.density
      fleetAvg.stability += p.dimensions.stability
      fleetAvg.freshness += p.dimensions.freshness
    }
    const n = projects.length
    fleetAvg.recency = Math.round(fleetAvg.recency / n)
    fleetAvg.coverage = Math.round(fleetAvg.coverage / n)
    fleetAvg.density = Math.round(fleetAvg.density / n)
    fleetAvg.stability = Math.round(fleetAvg.stability / n)
    fleetAvg.freshness = Math.round(fleetAvg.freshness / n)
  }

  const result: MemoryHealthResponse = {
    projects,
    fleetAvg,
    generatedAt: new Date().toISOString(),
  }

  cache = { data: result, ts: Date.now() }
  return Response.json(result)
}

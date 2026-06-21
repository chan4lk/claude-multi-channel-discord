import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface SimilarityPair {
  a: string
  b: string
  score: number
  sharedKeywords: string[]
}

export interface SimilarityResponse {
  projects: string[]
  scores: Record<string, Record<string, number>>
  sharedKeywords: Record<string, Record<string, string[]>>
  computedAt: string
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'not', 'no', 'nor',
  'so', 'yet', 'both', 'either', 'neither', 'as', 'if', 'than', 'then',
  'that', 'this', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
  'we', 'our', 'you', 'your', 'he', 'she', 'him', 'her', 'his', 'my', 'me',
  'i', 'up', 'out', 'about', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'between', 'each', 'more', 'most', 'other', 'some',
  'such', 'only', 'own', 'same', 'also', 'all', 'any', 'new', 'use', 'used',
  'when', 'which', 'who', 'how', 'what', 'where', 'why', 'there', 'here',
  'now', 'just', 'very', 'well', 'also', 'back', 'just', 'because', 'come',
  'could', 'people', 'into', 'first', 'time', 'way', 'day', 'man', 'year',
])

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function readMemoryFiles(slug: string, mcdDir: string): string {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { /* no symlink */ }
  const encoded = encodeProjectCwd(realPath)
  const memoryDir = path.join(os.homedir(), '.claude', 'projects', encoded, 'memory')

  let combined = ''
  try {
    const files = fs.readdirSync(memoryDir).filter((f) => f.endsWith('.md'))
    for (const file of files) {
      try {
        combined += ' ' + fs.readFileSync(path.join(memoryDir, file), 'utf-8')
      } catch { /* skip */ }
    }
  } catch { /* no memory dir */ }

  // Also read project MEMORY.md if present
  try {
    combined += ' ' + fs.readFileSync(path.join(mcdDir, 'projects', slug, 'MEMORY.md'), 'utf-8')
  } catch { /* skip */ }

  return combined
}

function extractKeywords(text: string): Map<string, number> {
  const freq = new Map<string, number>()
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))

  for (const word of words) {
    freq.set(word, (freq.get(word) ?? 0) + 1)
  }
  return freq
}

function jaccardSimilarity(
  a: Map<string, number>,
  b: Map<string, number>
): { score: number; shared: string[] } {
  if (a.size === 0 || b.size === 0) return { score: 0, shared: [] }

  const aSet = new Set(a.keys())
  const bSet = new Set(b.keys())

  const intersection: string[] = []
  for (const word of aSet) {
    if (bSet.has(word)) intersection.push(word)
  }

  const unionSize = aSet.size + bSet.size - intersection.length
  if (unionSize === 0) return { score: 0, shared: [] }

  const score = intersection.length / unionSize

  // Sort shared keywords by combined frequency (most prominent first)
  const topShared = intersection
    .sort((x, y) => (b.get(y)! + a.get(y)!) - (b.get(x)! + a.get(x)!))
    .slice(0, 5)

  return { score: Math.round(score * 1000) / 1000, shared: topShared }
}

// Simple in-process cache (5 min TTL)
let cache: { result: SimilarityResponse; ts: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

export async function GET(): Promise<Response> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return Response.json(cache.result)
  }

  const mcdDir = process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const slugs = Object.values(channels?.projects ?? {})
    .map((p) => p.slug)
    .filter((s): s is string => !!s)

  // Extract keywords per project
  const keywordMaps = new Map<string, Map<string, number>>()
  for (const slug of slugs) {
    const text = readMemoryFiles(slug, mcdDir)
    const kwMap = extractKeywords(text)
    if (kwMap.size > 0) keywordMaps.set(slug, kwMap)
  }

  const projectsWithMemory = Array.from(keywordMaps.keys())

  const scores: Record<string, Record<string, number>> = {}
  const sharedKeywords: Record<string, Record<string, string[]>> = {}

  for (const a of projectsWithMemory) {
    scores[a] = {}
    sharedKeywords[a] = {}
    for (const b of projectsWithMemory) {
      if (a === b) {
        scores[a][b] = 1
        sharedKeywords[a][b] = []
      } else {
        const { score, shared } = jaccardSimilarity(keywordMaps.get(a)!, keywordMaps.get(b)!)
        scores[a][b] = score
        sharedKeywords[a][b] = shared
      }
    }
  }

  // Sort projects by greedy cluster (highest average similarity first)
  const avgSim = (slug: string): number => {
    const row = scores[slug] ?? {}
    const others = Object.entries(row).filter(([k]) => k !== slug)
    if (others.length === 0) return 0
    return others.reduce((s, [, v]) => s + v, 0) / others.length
  }

  const sorted = [...projectsWithMemory].sort((a, b) => avgSim(b) - avgSim(a))

  const result: SimilarityResponse = {
    projects: sorted,
    scores,
    sharedKeywords,
    computedAt: new Date().toISOString(),
  }

  cache = { result, ts: Date.now() }
  return Response.json(result)
}

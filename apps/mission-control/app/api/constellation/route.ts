import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { upsertConstellationCoord, getConvergenceScore } from '../../../src/db'

export const dynamic = 'force-dynamic'

export interface ConstellationNode {
  slug: string
  x: number
  y: number
  z: number
  convergenceScore: number | null
  contextPct: number
  turnsPerHour: number
  state: string
}

export interface ConstellationEdge {
  source: string
  target: string
  score: number
}

export interface ConstellationResponse {
  nodes: ConstellationNode[]
  edges: ConstellationEdge[]
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
  'could', 'people', 'first', 'time', 'way', 'day', 'year',
])

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function readMemoryText(slug: string, mcdDir: string): string {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { /* no symlink */ }
  const encoded = encodeProjectCwd(realPath)
  const memoryDir = path.join(os.homedir(), '.claude', 'projects', encoded, 'memory')

  let combined = ''
  try {
    const files = fs.readdirSync(memoryDir).filter((f) => f.endsWith('.md'))
    for (const file of files) {
      try { combined += ' ' + fs.readFileSync(path.join(memoryDir, file), 'utf-8') } catch { /* skip */ }
    }
  } catch { /* no memory dir */ }
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

function jaccardSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0
  const aSet = new Set(a.keys())
  const bSet = new Set(b.keys())
  let intersection = 0
  for (const word of aSet) { if (bSet.has(word)) intersection++ }
  const unionSize = aSet.size + bSet.size - intersection
  return unionSize === 0 ? 0 : intersection / unionSize
}

// Deterministic 2-pass PCA-like 3D projection.
// Pass 1: collect top-30 highest-variance keywords.
// Pass 2: project each slug onto 3 groups of 10 keywords each.
function computeCoords(
  slugs: string[],
  keywordMaps: Map<string, Map<string, number>>
): Map<string, { x: number; y: number; z: number }> {
  // Collect all keywords with per-project frequency
  const allKwFreqs = new Map<string, number[]>()
  for (const slug of slugs) {
    const kmap = keywordMaps.get(slug)
    if (!kmap) continue
    for (const [kw, freq] of kmap) {
      if (!allKwFreqs.has(kw)) allKwFreqs.set(kw, Array(slugs.length).fill(0))
      allKwFreqs.get(kw)![slugs.indexOf(slug)] = freq
    }
  }

  // Compute variance per keyword
  const variances: { kw: string; variance: number }[] = []
  for (const [kw, vals] of allKwFreqs) {
    const n = vals.length
    if (n === 0) continue
    const mean = vals.reduce((a, b) => a + b, 0) / n
    const variance = vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n
    variances.push({ kw, variance })
  }
  variances.sort((a, b) => b.variance - a.variance)
  const top30 = variances.slice(0, 30).map((v) => v.kw)

  // Split into 3 axis groups
  const xKws = top30.slice(0, 10)
  const yKws = top30.slice(10, 20)
  const zKws = top30.slice(20, 30)

  // Score each slug on each axis
  const raw = new Map<string, { x: number; y: number; z: number }>()
  let maxX = 0, maxY = 0, maxZ = 0
  for (const slug of slugs) {
    const kmap = keywordMaps.get(slug)
    if (!kmap) { raw.set(slug, { x: 0, y: 0, z: 0 }); continue }
    const x = xKws.reduce((sum, kw) => sum + (kmap.get(kw) ?? 0), 0)
    const y = yKws.reduce((sum, kw) => sum + (kmap.get(kw) ?? 0), 0)
    const z = zKws.reduce((sum, kw) => sum + (kmap.get(kw) ?? 0), 0)
    raw.set(slug, { x, y, z })
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }

  // Normalize to [-120, 120] sphere
  const result = new Map<string, { x: number; y: number; z: number }>()
  for (const [slug, { x, y, z }] of raw) {
    result.set(slug, {
      x: maxX > 0 ? ((x / maxX) * 2 - 1) * 120 : 0,
      y: maxY > 0 ? ((y / maxY) * 2 - 1) * 120 : 0,
      z: maxZ > 0 ? ((z / maxZ) * 2 - 1) * 120 : 0,
    })
  }
  return result
}

function getProjectState(slug: string, mcdDir: string): string {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { /* no symlink */ }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)

  let latestMtime = 0
  try {
    const files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
    for (const file of files) {
      try {
        const st = fs.statSync(path.join(transcriptDir, file))
        if (st.mtimeMs > latestMtime) latestMtime = st.mtimeMs
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  const ageMins = latestMtime > 0 ? (Date.now() - latestMtime) / 60000 : Infinity
  if (ageMins < 2) return 'active'
  if (ageMins < 30) return 'idle'
  return 'idle'
}

function getContextPct(slug: string, mcdDir: string): number {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { /* no symlink */ }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)

  let latestFile = ''
  let latestMtime = 0
  try {
    const files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
    for (const file of files) {
      try {
        const st = fs.statSync(path.join(transcriptDir, file))
        if (st.mtimeMs > latestMtime) { latestMtime = st.mtimeMs; latestFile = path.join(transcriptDir, file) }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  if (!latestFile) return 0
  try {
    const lines = fs.readFileSync(latestFile, 'utf-8').trim().split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]) as { message?: { usage?: { cache_read_input_tokens?: number; input_tokens?: number } } }
        const usage = obj?.message?.usage
        if (usage) {
          const total = (usage.cache_read_input_tokens ?? 0) + (usage.input_tokens ?? 0)
          return Math.min(100, Math.round((total / 200000) * 100))
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return 0
}

function getTurnsPerHour(slug: string, mcdDir: string): number {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { /* no symlink */ }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)

  const hourAgo = Date.now() - 3600000
  let turnCount = 0
  try {
    const files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
    for (const file of files) {
      try {
        const lines = fs.readFileSync(path.join(transcriptDir, file), 'utf-8').trim().split('\n')
        for (const line of lines) {
          try {
            const obj = JSON.parse(line) as { type?: string; timestamp?: string }
            if (obj.type === 'assistant' && obj.timestamp) {
              if (new Date(obj.timestamp).getTime() >= hourAgo) turnCount++
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return turnCount
}

// 5-min cache
let cache: { result: ConstellationResponse; ts: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

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

  // Build keyword maps
  const keywordMaps = new Map<string, Map<string, number>>()
  for (const slug of slugs) {
    const text = readMemoryText(slug, mcdDir)
    const kwMap = extractKeywords(text)
    if (kwMap.size > 0) keywordMaps.set(slug, kwMap)
  }

  // Compute 3D coordinates
  const coords = computeCoords(slugs, keywordMaps)

  // Store coords in DB
  for (const [slug, { x, y, z }] of coords) {
    try { upsertConstellationCoord(slug, x, y, z) } catch { /* skip */ }
  }

  // Build nodes
  const nodes: ConstellationNode[] = slugs.map((slug) => {
    const { x, y, z } = coords.get(slug) ?? { x: 0, y: 0, z: 0 }
    return {
      slug,
      x,
      y,
      z,
      convergenceScore: getConvergenceScore(slug),
      contextPct: getContextPct(slug, mcdDir),
      turnsPerHour: getTurnsPerHour(slug, mcdDir),
      state: getProjectState(slug, mcdDir),
    }
  })

  // Build edges (Jaccard >= 0.1)
  const edges: ConstellationEdge[] = []
  const slugList = [...keywordMaps.keys()]
  for (let i = 0; i < slugList.length; i++) {
    for (let j = i + 1; j < slugList.length; j++) {
      const score = jaccardSimilarity(keywordMaps.get(slugList[i])!, keywordMaps.get(slugList[j])!)
      if (score >= 0.1) {
        edges.push({ source: slugList[i], target: slugList[j], score: Math.round(score * 1000) / 1000 })
      }
    }
  }

  const result: ConstellationResponse = { nodes, edges, computedAt: new Date().toISOString() }
  cache = { result, ts: Date.now() }
  return Response.json(result)
}

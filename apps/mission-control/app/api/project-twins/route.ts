import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export type FeatureName = 'turns_per_day' | 'tool_call_rate' | 'memory_file_count' | 'context_pressure_pct' | 'avg_tokens_per_turn'

const FEATURE_NAMES: FeatureName[] = [
  'turns_per_day',
  'tool_call_rate',
  'memory_file_count',
  'context_pressure_pct',
  'avg_tokens_per_turn',
]

export interface ProjectFeatures {
  slug: string
  raw: Record<FeatureName, number>
  normalized: Record<FeatureName, number>
}

export interface TwinPair {
  slug_a: string
  slug_b: string
  similarity: number
  sharedFeatures: FeatureName[]
}

export interface ProjectTwinsResponse {
  projects: ProjectFeatures[]
  pairs: TwinPair[]
  generatedAt: string
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function findJsonlFiles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = realPath.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(transcriptDir, f))
  } catch { return [] }
}

interface ParsedStats {
  userMessages: number
  toolCalls: number
  totalTokens: number
  assistantTurns: number
  latestContextTokens: number
}

const WINDOW_MS = 7 * 24 * 3_600_000
const MODEL_CONTEXT = 200_000

function parseStats(slug: string, mcdDir: string): ParsedStats {
  const cutoffMs = Date.now() - WINDOW_MS
  const files = findJsonlFiles(slug, mcdDir)
  let userMessages = 0, toolCalls = 0, totalTokens = 0, assistantTurns = 0
  let latestFileTokens = 0
  let latestMtime = 0

  for (const file of files) {
    let lines: string[]
    try { lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean) } catch { continue }
    const mtime = (() => { try { return fs.statSync(file).mtimeMs } catch { return 0 } })()
    let fileTokens = 0

    for (const raw of lines) {
      let rec: {
        type?: string; timestamp?: string
        message?: { role?: string; content?: Array<{ type?: string }>; usage?: { input_tokens?: number; output_tokens?: number } }
      }
      try { rec = JSON.parse(raw) } catch { continue }

      const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN
      const role = rec.message?.role
      const content = rec.message?.content ?? []

      // Count tokens from all time for latest session estimate
      if (role === 'assistant') {
        const u = rec.message?.usage
        const t = (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0)
        fileTokens += t
      }

      // Count activity in window
      if (isNaN(ts) || ts < cutoffMs) continue

      if (role === 'user' && content.length > 0 && content[0]?.type !== 'tool_result') {
        userMessages++
      }
      if (role === 'assistant') {
        if (content.some(c => c.type === 'tool_use')) toolCalls++
        const u = rec.message?.usage
        const t = (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0)
        totalTokens += t
        assistantTurns++
      }
    }

    if (mtime > latestMtime) {
      latestMtime = mtime
      latestFileTokens = fileTokens
    }
  }

  return {
    userMessages,
    toolCalls,
    totalTokens,
    assistantTurns,
    latestContextTokens: latestFileTokens,
  }
}

function memoryFileCount(slug: string, mcdDir: string): number {
  const memDir = path.join(mcdDir, 'projects', slug, 'memory')
  try { return fs.readdirSync(memDir).filter(f => f.endsWith('.md')).length } catch { return 0 }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    magA += a[i]! * a[i]!
    magB += b[i]! * b[i]!
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

function normalize(values: number[]): number[] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === min) return values.map(() => 0)
  return values.map(v => (v - min) / (max - min))
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const slugs: string[] = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug) slugs.push(proj.slug)
    }
  }

  if (slugs.length < 2) {
    return Response.json({ projects: [], pairs: [], generatedAt: new Date().toISOString() } satisfies ProjectTwinsResponse)
  }

  // Compute raw features per project
  const rawFeatures: Array<{ slug: string; raw: Record<FeatureName, number> }> = []
  for (const slug of slugs) {
    const stats = parseStats(slug, mcdDir)
    const memCount = memoryFileCount(slug, mcdDir)
    const windowDays = WINDOW_MS / 86_400_000
    rawFeatures.push({
      slug,
      raw: {
        turns_per_day: stats.userMessages / windowDays,
        tool_call_rate: stats.userMessages > 0 ? stats.toolCalls / stats.userMessages : 0,
        memory_file_count: memCount,
        context_pressure_pct: Math.min(100, (stats.latestContextTokens / MODEL_CONTEXT) * 100),
        avg_tokens_per_turn: stats.assistantTurns > 0 ? stats.totalTokens / stats.assistantTurns : 0,
      },
    })
  }

  // Normalize each feature across all projects
  const normalized: number[][] = FEATURE_NAMES.map(feat => {
    const vals = rawFeatures.map(p => p.raw[feat])
    return normalize(vals)
  })

  const projects: ProjectFeatures[] = rawFeatures.map((p, i) => {
    const normRecord = {} as Record<FeatureName, number>
    for (let f = 0; f < FEATURE_NAMES.length; f++) {
      normRecord[FEATURE_NAMES[f]!] = Math.round((normalized[f]![i]!) * 100) / 100
    }
    return { slug: p.slug, raw: p.raw, normalized: normRecord }
  })

  // Pairwise cosine similarity
  const pairs: TwinPair[] = []
  for (let i = 0; i < projects.length; i++) {
    for (let j = i + 1; j < projects.length; j++) {
      const vecA = FEATURE_NAMES.map(f => projects[i]!.normalized[f])
      const vecB = FEATURE_NAMES.map(f => projects[j]!.normalized[f])
      const sim = cosine(vecA, vecB)
      if (sim < 0.8) continue

      const sharedFeatures: FeatureName[] = FEATURE_NAMES.filter(f => {
        const diff = Math.abs(projects[i]!.normalized[f] - projects[j]!.normalized[f])
        return diff <= 0.2
      })

      pairs.push({
        slug_a: projects[i]!.slug,
        slug_b: projects[j]!.slug,
        similarity: Math.round(sim * 1000) / 1000,
        sharedFeatures,
      })
    }
  }

  pairs.sort((a, b) => b.similarity - a.similarity)

  return Response.json({
    projects,
    pairs,
    generatedAt: new Date().toISOString(),
  } satisfies ProjectTwinsResponse)
}

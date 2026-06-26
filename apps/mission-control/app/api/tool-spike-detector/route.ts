import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export type SpikeSeverity = 'low' | 'medium' | 'high'

export interface Spike {
  tool: string
  affectedSlugs: string[]
  errorCount: number
  windowStart: number  // unix ms
  severity: SpikeSeverity
}

export interface SpikeHistoryEntry {
  ts: number           // unix ms (window start)
  tool: string
  severity: SpikeSeverity
  affectedCount: number
}

export interface ToolErrorBucket {
  tool: string
  bucketTs: number     // 5-min bucket unix ms
  slugs: string[]
  errorCount: number
}

export interface ToolSpikeResponse {
  currentSpikes: Spike[]
  history: SpikeHistoryEntry[]
  heatmapBuckets: ToolErrorBucket[]
  scannedAt: string
}

const BUCKET_MS = 5 * 60 * 1000
const SPIKE_MIN_PROJECTS = 3
const SEVERITY_MEDIUM = 5
const SEVERITY_HIGH = 8

function severity(affected: number): SpikeSeverity {
  if (affected >= SEVERITY_HIGH) return 'high'
  if (affected >= SEVERITY_MEDIUM) return 'medium'
  return 'low'
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function getTranscriptFiles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encodeProjectCwd(realPath))
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return [] }
}

// Scan a single transcript file for tool_result error events in the last 24h
function scanTranscriptErrors(
  filePath: string,
  cutoffMs: number
): { tool: string; tsMs: number }[] {
  const errors: { tool: string; tsMs: number }[] = []
  let lines: string[] = []
  try {
    lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean)
  } catch { return [] }

  // Build a map: toolUseId → toolName from tool_use blocks in assistant messages
  const toolNames = new Map<string, string>()

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as {
        type?: string
        timestamp?: string
        tool_use_id?: string
        is_error?: boolean
        message?: { content?: unknown }
      }
      if (!obj) continue

      if (obj.type === 'assistant' && obj.message?.content) {
        const content = obj.message.content
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as { type?: string; id?: string; name?: string }
            if (b.type === 'tool_use' && b.id && b.name) {
              toolNames.set(b.id, b.name)
            }
          }
        }
      }

      if (obj.type === 'tool_result' && obj.is_error && obj.tool_use_id && obj.timestamp) {
        const tsMs = new Date(obj.timestamp).getTime()
        if (tsMs >= cutoffMs) {
          const toolName = toolNames.get(obj.tool_use_id) ?? 'unknown'
          errors.push({ tool: toolName, tsMs })
        }
      }
    } catch { /* skip */ }
  }
  return errors
}

// 2-min cache
let cache: { data: ToolSpikeResponse; ts: number } | null = null
const CACHE_TTL_MS = 2 * 60 * 1000

export async function GET(): Promise<Response> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return Response.json(cache.data)
  }

  const mcdDir = process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )
  const slugs = Object.values(channels?.projects ?? {})
    .map((p) => p.slug)
    .filter((s): s is string => !!s)

  const now = Date.now()
  const cutoff24h = now - 24 * 60 * 60 * 1000

  // bucket key: `${tool}::${bucketStart}`
  // value: Set of slugs with errors in that bucket
  const bucketMap = new Map<string, { slugs: Set<string>; count: number }>()

  for (const slug of slugs) {
    const files = getTranscriptFiles(slug, mcdDir)
    for (const file of files) {
      // Skip files not modified in last 24h (perf optimization)
      try {
        const st = fs.statSync(file)
        if (st.mtimeMs < cutoff24h) continue
      } catch { continue }

      const errors = scanTranscriptErrors(file, cutoff24h)
      for (const { tool, tsMs } of errors) {
        const bucketStart = Math.floor(tsMs / BUCKET_MS) * BUCKET_MS
        const key = `${tool}::${bucketStart}`
        if (!bucketMap.has(key)) bucketMap.set(key, { slugs: new Set(), count: 0 })
        const entry = bucketMap.get(key)!
        entry.slugs.add(slug)
        entry.count++
      }
    }
  }

  // Find spikes: buckets where ≥3 projects have errors
  const currentBucketStart = Math.floor(now / BUCKET_MS) * BUCKET_MS
  const prevBucketStart = currentBucketStart - BUCKET_MS

  const allSpikes: (Spike & { windowStart: number })[] = []
  const history: SpikeHistoryEntry[] = []

  for (const [key, { slugs: affectedSlugs, count }] of bucketMap) {
    if (affectedSlugs.size < SPIKE_MIN_PROJECTS) continue
    const [tool, bucketTsStr] = key.split('::')
    const bucketTs = parseInt(bucketTsStr, 10)
    const affected = [...affectedSlugs]
    const sev = severity(affected.length)
    allSpikes.push({ tool, affectedSlugs: affected, errorCount: count, windowStart: bucketTs, severity: sev })
    history.push({ ts: bucketTs, tool, severity: sev, affectedCount: affected.length })
  }

  // Current spikes: most recent 2 buckets
  const currentSpikes = allSpikes
    .filter((s) => s.windowStart >= prevBucketStart)
    .sort((a, b) => b.errorCount - a.errorCount)

  history.sort((a, b) => b.ts - a.ts)

  // Heatmap: all tool×bucket combinations (not just spikes)
  const heatmapBuckets: ToolErrorBucket[] = []
  for (const [key, { slugs: affectedSlugs, count }] of bucketMap) {
    const [tool, bucketTsStr] = key.split('::')
    heatmapBuckets.push({
      tool,
      bucketTs: parseInt(bucketTsStr, 10),
      slugs: [...affectedSlugs],
      errorCount: count,
    })
  }
  heatmapBuckets.sort((a, b) => b.bucketTs - a.bucketTs || b.errorCount - a.errorCount)

  const result: ToolSpikeResponse = {
    currentSpikes,
    history: history.slice(0, 200),
    heatmapBuckets: heatmapBuckets.slice(0, 500),
    scannedAt: new Date().toISOString(),
  }
  cache = { data: result, ts: now }
  return Response.json(result)
}

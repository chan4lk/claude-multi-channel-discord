import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as readline from 'node:readline'

export interface PatternResult {
  avgTurnsPerDay: number
  peakHour: number              // 0-23 UTC hour with most operator turns
  tokenBurnPerHour: number      // average output tokens per hour of activity
  recommendedIntervalMinutes: number  // conservative schedule interval
}

const SAFE_DEFAULTS: PatternResult = {
  avgTurnsPerDay: 1,
  peakHour: 10,
  tokenBurnPerHour: 0,
  recommendedIntervalMinutes: 480,
}

function encodeProjectCwd(cwd: string): string {
  let real = cwd
  try { real = fs.realpathSync(cwd) } catch { /* best-effort */ }
  return real.replace(/[^a-zA-Z0-9]/g, '-')
}

function cutoffTs(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000
}

function isOperatorTurn(parsed: Record<string, unknown>): boolean {
  const msg = parsed['message'] as { role?: string; content?: unknown[] } | undefined
  if (!msg || msg.role !== 'user') return false
  const content = msg.content
  if (!Array.isArray(content) || content.length === 0) return false
  const first = content[0] as { type?: string } | undefined
  return first?.type !== 'tool_result'
}

function getOutputTokens(parsed: Record<string, unknown>): number {
  const msg = parsed['message'] as { role?: string; usage?: { output_tokens?: number } } | undefined
  if (!msg || msg.role !== 'assistant') return 0
  return msg.usage?.output_tokens ?? 0
}

function getTimestamp(parsed: Record<string, unknown>): number | null {
  const ts = parsed['timestamp']
  if (typeof ts === 'string') {
    const n = Date.parse(ts)
    return isNaN(n) ? null : n
  }
  if (typeof ts === 'number') return ts
  return null
}

async function streamJsonl(
  filePath: string,
  cutoff: number,
  onLine: (parsed: Record<string, unknown>, ts: number) => void,
): Promise<void> {
  return new Promise((resolve) => {
    let stream: fs.ReadStream
    try {
      stream = fs.createReadStream(filePath, { encoding: 'utf8' })
    } catch {
      resolve()
      return
    }
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        const ts = getTimestamp(parsed)
        if (ts !== null && ts >= cutoff) onLine(parsed, ts)
      } catch { /* malformed line */ }
    })
    rl.on('close', resolve)
    rl.on('error', () => resolve())
    stream.on('error', () => resolve())
  })
}

export async function minePatterns(
  slug: string,
  mcdDir: string,
  days = 30,
): Promise<PatternResult> {
  try {
    const projectPath = path.join(mcdDir, 'projects', slug)
    const encoded = encodeProjectCwd(projectPath)
    const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)

    if (!fs.existsSync(transcriptDir)) return SAFE_DEFAULTS

    let files: string[]
    try {
      files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      return SAFE_DEFAULTS
    }
    if (files.length === 0) return SAFE_DEFAULTS

    // Sort newest first by mtime so we can stop early if needed
    const withMtime = files.map((f) => {
      const fp = path.join(transcriptDir, f)
      try { return { f, mt: fs.statSync(fp).mtimeMs } } catch { return { f, mt: 0 } }
    }).sort((a, b) => b.mt - a.mt)

    const cutoff = cutoffTs(days)
    const hourBuckets = new Array<number>(24).fill(0)
    const dayTurns = new Map<string, number>()  // "YYYY-MM-DD" → count
    let totalOutputTokens = 0
    let activeHours = new Set<number>()         // unique hours with any activity
    let turnCount = 0

    for (const { f } of withMtime) {
      const fp = path.join(transcriptDir, f)
      await streamJsonl(fp, cutoff, (parsed, ts) => {
        const d = new Date(ts)
        const hour = d.getUTCHours()
        const dayKey = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`

        if (isOperatorTurn(parsed)) {
          hourBuckets[hour]++
          dayTurns.set(dayKey, (dayTurns.get(dayKey) ?? 0) + 1)
          turnCount++
        }
        totalOutputTokens += getOutputTokens(parsed)
        activeHours.add(hour)
      })
    }

    if (turnCount === 0) return SAFE_DEFAULTS

    const avgTurnsPerDay = turnCount / Math.max(1, dayTurns.size)
    const peakHour = hourBuckets.indexOf(Math.max(...hourBuckets))
    const tokenBurnPerHour = activeHours.size > 0
      ? Math.round(totalOutputTokens / activeHours.size)
      : 0

    // Conservative interval: spread turns across the day, min 60 min
    const recommendedIntervalMinutes = Math.min(
      480,
      Math.max(60, Math.round(1440 / Math.max(1, avgTurnsPerDay)))
    )

    return { avgTurnsPerDay, peakHour, tokenBurnPerHour, recommendedIntervalMinutes }
  } catch {
    return SAFE_DEFAULTS
  }
}

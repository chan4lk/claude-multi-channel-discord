import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export interface CommandLogEntry {
  ts: string
  userId: string
  verb: string
  args: string[]
  outcomeSnippet: string
  error: string | null
}

export interface VerbFreq {
  verb: string
  count: number
  errorCount: number
}

export interface CommandLogResponse {
  entries: CommandLogEntry[]
  total: number
  verbFrequency: VerbFreq[]
  errorRate: number
  calendarDays: string[]
  dailyCounts: Record<string, { ok: number; error: number }>
}

function readJsonl<T>(filePath: string): T[] {
  try {
    return fs.readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as T)
  } catch { return [] }
}

export async function GET(req: Request): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ entries: [], total: 0, verbFrequency: [], errorRate: 0, calendarDays: [], dailyCounts: {} })
  }

  const url = new URL(req.url)
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 365)
  const verbFilter = url.searchParams.get('verb') ?? ''
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()

  const all = readJsonl<CommandLogEntry>(path.join(mcdDir, 'command-log.jsonl'))
  let filtered = all.filter((e) => e.ts >= cutoff)
  if (verbFilter) filtered = filtered.filter((e) => e.verb === verbFilter)

  const sorted = [...filtered].sort((a, b) => b.ts.localeCompare(a.ts))

  // Verb frequency map
  const verbMap = new Map<string, { count: number; errorCount: number }>()
  for (const e of filtered) {
    if (!verbMap.has(e.verb)) verbMap.set(e.verb, { count: 0, errorCount: 0 })
    const v = verbMap.get(e.verb)!
    v.count++
    if (e.error) v.errorCount++
  }
  const verbFrequency: VerbFreq[] = [...verbMap.entries()]
    .map(([verb, s]) => ({ verb, ...s }))
    .sort((a, b) => b.count - a.count)

  const errorCount = filtered.filter((e) => e.error).length
  const errorRate = filtered.length > 0 ? errorCount / filtered.length : 0

  // Calendar
  const calendarDays: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    calendarDays.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10))
  }
  const dailyCounts: Record<string, { ok: number; error: number }> = {}
  for (const e of filtered) {
    const day = e.ts.slice(0, 10)
    if (!dailyCounts[day]) dailyCounts[day] = { ok: 0, error: 0 }
    if (e.error) dailyCounts[day].error++
    else dailyCounts[day].ok++
  }

  return Response.json({
    entries: sorted.slice(0, 500),
    total: filtered.length,
    verbFrequency,
    errorRate,
    calendarDays,
    dailyCounts,
  } satisfies CommandLogResponse)
}

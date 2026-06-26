import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface SessionRecord {
  slug: string
  sessionId: string
  turns: number
  durationMinutes: number
  date: string  // ISO date of first turn
}

export interface SessionLengthResponse {
  sessions: SessionRecord[]
  medianTurns: number
  medianDurationMinutes: number
  longestSession: SessionRecord | null
  generatedAt: string
}

interface JsonlLine {
  message?: { role?: string }
  timestamp?: string
}

function getProjectSlugs(mcdDir: string): string[] {
  const projectsDir = path.join(mcdDir, 'projects')
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

function findJsonlFiles(slug: string, mcdDir: string): { sessionId: string; filePath: string }[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = realPath.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ sessionId: f.replace(/\.jsonl$/, ''), filePath: path.join(transcriptDir, f) }))
  } catch { return [] }
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = arr.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const windowDays = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') ?? '30', 10)))
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const cutoffMs = Date.now() - windowDays * 24 * 3_600_000
  const slugs = getProjectSlugs(mcdDir)
  const sessions: SessionRecord[] = []

  for (const slug of slugs) {
    for (const { sessionId, filePath } of findJsonlFiles(slug, mcdDir)) {
      let lines: string[]
      try { lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean) } catch { continue }

      let turns = 0
      let firstTs: number | null = null
      let lastTs: number | null = null

      for (const raw of lines) {
        let line: JsonlLine
        try { line = JSON.parse(raw) } catch { continue }
        if (line.message?.role !== 'assistant') continue
        if (!line.timestamp) continue
        const tsMs = Date.parse(line.timestamp)
        if (isNaN(tsMs)) continue
        if (tsMs < cutoffMs) continue
        turns++
        if (firstTs === null || tsMs < firstTs) firstTs = tsMs
        if (lastTs === null || tsMs > lastTs) lastTs = tsMs
      }

      if (turns === 0 || firstTs === null || lastTs === null) continue

      const durationMinutes = Math.round((lastTs - firstTs) / 60_000)
      sessions.push({
        slug,
        sessionId: sessionId.slice(0, 8),
        turns,
        durationMinutes,
        date: new Date(firstTs).toISOString().slice(0, 10),
      })
    }
  }

  const medianTurns = median(sessions.map((s) => s.turns))
  const medianDurationMinutes = median(sessions.map((s) => s.durationMinutes))
  const longestSession = sessions.length > 0
    ? sessions.reduce((best, s) => s.turns > best.turns ? s : best)
    : null

  return Response.json({
    sessions,
    medianTurns,
    medianDurationMinutes,
    longestSession,
    generatedAt: new Date().toISOString(),
  } satisfies SessionLengthResponse)
}

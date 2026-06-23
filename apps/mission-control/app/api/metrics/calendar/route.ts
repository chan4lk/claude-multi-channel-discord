import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface CalendarDay {
  day: string  // YYYY-MM-DD
  totalTurns: number
  perProject: { slug: string; turns: number }[]
}

export interface CalendarResponse {
  days: CalendarDay[]
  generatedAt: string
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findAllJsonl(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return [] }
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })

  let channels: { projects?: Record<string, { slug?: string }> } | null = null
  try { channels = JSON.parse(fs.readFileSync(path.join(mcdDir, 'channels.json'), 'utf-8')) } catch {}

  const slugs = Object.values(channels?.projects ?? {})
    .filter((p): p is { slug: string } => !!p.slug)
    .map((p) => p.slug)

  const cutoff = Date.now() - 364 * 24 * 60 * 60 * 1000
  // day -> slug -> count
  const daySlugMap = new Map<string, Map<string, number>>()

  for (const slug of slugs) {
    const files = findAllJsonl(slug, mcdDir)
    for (const file of files) {
      let raw = ''
      try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
      for (const line of raw.trim().split('\n').filter(Boolean)) {
        let rec: Record<string, unknown>
        try { rec = JSON.parse(line) } catch { continue }
        if (rec.type !== 'assistant') continue
        const ts = typeof rec.timestamp === 'string' ? new Date(rec.timestamp).getTime() : null
        if (!ts || ts < cutoff) continue
        const day = new Date(ts).toISOString().slice(0, 10)
        if (!daySlugMap.has(day)) daySlugMap.set(day, new Map())
        const slugMap = daySlugMap.get(day)!
        slugMap.set(slug, (slugMap.get(slug) ?? 0) + 1)
      }
    }
  }

  const days: CalendarDay[] = []
  for (const [day, slugMap] of daySlugMap) {
    const perProject = [...slugMap.entries()]
      .map(([s, turns]) => ({ slug: s, turns }))
      .sort((a, b) => b.turns - a.turns)
    days.push({ day, totalTurns: perProject.reduce((s, p) => s + p.turns, 0), perProject })
  }
  days.sort((a, b) => a.day.localeCompare(b.day))

  return Response.json({ days, generatedAt: new Date().toISOString() } satisfies CalendarResponse)
}

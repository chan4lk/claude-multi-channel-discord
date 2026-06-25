import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface Gap {
  start: string
  end: string
  durationHours: number
  severity: 'yellow' | 'red'
}

export interface ProjectGapInfo {
  slug: string
  gaps: Gap[]
  longestGapHours: number
  currentGapHours: number
  lastMessageTs: string | null
  messageCount: number
}

export interface SessionGapsResponse {
  projects: ProjectGapInfo[]
  windowDays: number
  generatedAt: string
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function getProjectJsonlFiles(projectPath: string): string[] {
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(transcriptDir, f))
  } catch { return [] }
}

function getGenuineUserMessageTimestamps(files: string[], cutoff: string): string[] {
  const timestamps: string[] = []
  for (const filePath of files) {
    let raw = ''
    try { raw = fs.readFileSync(filePath, 'utf-8') } catch { continue }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line) as {
          type?: string
          timestamp?: string
          message?: { role?: string; content?: unknown }
        }
        if (e.type !== 'user') continue
        const ts = e.timestamp
        if (!ts || ts < cutoff) continue
        const content = e.message?.content
        // Skip tool_result messages (not genuine user input)
        if (Array.isArray(content) && content.length > 0) {
          const first = content[0] as Record<string, unknown>
          if (first.type === 'tool_result') continue
        }
        // Skip meta/system messages
        if (typeof content === 'string' && content.startsWith('<system-reminder')) continue
        timestamps.push(ts)
      } catch { continue }
    }
  }
  return timestamps.sort()
}

function computeGaps(sortedTs: string[], nowMs: number, cutoffMs: number): Gap[] {
  const gaps: Gap[] = []
  const GAP_YELLOW_MS = 24 * 3600_000
  const GAP_RED_MS = 72 * 3600_000

  // Include synthetic gap from last message to now
  const points = [...sortedTs.map(t => Date.parse(t)), nowMs]
  const starts = [cutoffMs, ...sortedTs.map(t => Date.parse(t))]

  for (let i = 0; i < starts.length; i++) {
    const gapMs = points[i] - starts[i]
    if (gapMs >= GAP_YELLOW_MS) {
      const dh = gapMs / 3600_000
      gaps.push({
        start: new Date(starts[i]).toISOString(),
        end: new Date(points[i]).toISOString(),
        durationHours: Math.round(dh * 10) / 10,
        severity: gapMs >= GAP_RED_MS ? 'red' : 'yellow',
      })
    }
  }
  return gaps
}

function getSlugs(mcdDir: string): string[] {
  try {
    const channels = JSON.parse(fs.readFileSync(path.join(mcdDir, 'channels.json'), 'utf-8')) as {
      projects?: Record<string, { slug?: string }>
    }
    return Object.values(channels.projects ?? {}).map(p => p.slug).filter(Boolean) as string[]
  } catch { return [] }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 90)
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const nowMs = Date.now()
  const cutoffMs = nowMs - days * 86_400_000
  const cutoff = new Date(cutoffMs).toISOString()
  const generatedAt = new Date(nowMs).toISOString()

  const slugs = getSlugs(mcdDir)
  const projects: ProjectGapInfo[] = []

  for (const slug of slugs) {
    const projectPath = path.join(mcdDir, 'projects', slug)
    const files = getProjectJsonlFiles(projectPath)
    const timestamps = getGenuineUserMessageTimestamps(files, cutoff)
    const gaps = computeGaps(timestamps, nowMs, cutoffMs)
    const lastMessageTs = timestamps.length > 0 ? timestamps[timestamps.length - 1] : null
    const currentGapMs = lastMessageTs ? nowMs - Date.parse(lastMessageTs) : nowMs - cutoffMs
    const longestGap = gaps.reduce((m, g) => Math.max(m, g.durationHours), 0)

    projects.push({
      slug,
      gaps,
      longestGapHours: longestGap,
      currentGapHours: Math.round(currentGapMs / 3600_000 * 10) / 10,
      lastMessageTs,
      messageCount: timestamps.length,
    })
  }

  // Sort by current gap descending (most idle first)
  projects.sort((a, b) => b.currentGapHours - a.currentGapHours)

  return Response.json({ projects, windowDays: days, generatedAt } satisfies SessionGapsResponse)
}

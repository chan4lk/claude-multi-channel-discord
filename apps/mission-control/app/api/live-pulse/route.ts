import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface PulseProject {
  slug: string
  active: boolean
  lastTranscriptMtimeMs: number | null
  avgTurnsPerDay: number
  sessionCount: number
}

export interface LivePulseResponse {
  projects: PulseProject[]
  activeCount: number
  computedAt: string
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
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

interface JsonlLine {
  message?: { role?: string; content?: unknown[] }
  timestamp?: string
}

function computeProjectPulse(slug: string, mcdDir: string): PulseProject {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch {
    return { slug, active: false, lastTranscriptMtimeMs: null, avgTurnsPerDay: 0, sessionCount: 0 }
  }

  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)

  let jsonlFiles: string[] = []
  try {
    jsonlFiles = fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch {
    return { slug, active: false, lastTranscriptMtimeMs: null, avgTurnsPerDay: 0, sessionCount: 0 }
  }

  const sessionCount = jsonlFiles.length

  // Find most-recently-modified transcript
  let latestMtimeMs = 0
  let latestFile = ''
  for (const f of jsonlFiles) {
    try {
      const m = fs.statSync(f).mtimeMs
      if (m > latestMtimeMs) { latestMtimeMs = m; latestFile = f }
    } catch {}
  }

  const active = latestMtimeMs > 0 && (Date.now() - latestMtimeMs) < 10_000

  // Compute avg turns/day over last 7 days from all jsonl files
  const cutoffMs = Date.now() - 7 * 86_400_000
  let turnCount = 0
  for (const f of jsonlFiles) {
    let raw = ''
    try { raw = fs.readFileSync(f, 'utf-8') } catch { continue }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let rec: JsonlLine
      try { rec = JSON.parse(line) } catch { continue }
      if (rec.message?.role !== 'user' || !rec.timestamp) continue
      const content = rec.message.content
      if (!Array.isArray(content) || content.length === 0) continue
      const first = content[0] as { type?: string }
      if (first?.type === 'tool_result') continue
      const ts = Date.parse(rec.timestamp)
      if (!isNaN(ts) && ts > cutoffMs) turnCount++
    }
  }
  const avgTurnsPerDay = turnCount / 7

  return {
    slug,
    active,
    lastTranscriptMtimeMs: latestMtimeMs > 0 ? latestMtimeMs : null,
    avgTurnsPerDay: Math.round(avgTurnsPerDay * 10) / 10,
    sessionCount,
  }
}

export async function GET(): Promise<Response> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const slugs = getProjectSlugs(mcdDir)
  const projects = slugs.map((slug) => computeProjectPulse(slug, mcdDir))
  const activeCount = projects.filter((p) => p.active).length

  return Response.json({
    projects,
    activeCount,
    computedAt: new Date().toISOString(),
  } satisfies LivePulseResponse)
}

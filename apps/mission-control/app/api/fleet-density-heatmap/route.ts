import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export interface ProjectDensity {
  slug: string
  hourly: number[]  // [24] — turn count per hour (0-23) over last 7 days
  total: number
}

export interface FleetDensityHeatmapResponse {
  projects: ProjectDensity[]
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

function buildDensity(slug: string, mcdDir: string): ProjectDensity {
  const files = findAllJsonl(slug, mcdDir)
  const hourly = new Array(24).fill(0)
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: Record<string, unknown>
      try { rec = JSON.parse(line) } catch { continue }
      if (rec.type !== 'assistant') continue
      const ts = typeof rec.timestamp === 'string' ? new Date(rec.timestamp).getTime() : null
      if (!ts || ts < cutoff) continue
      hourly[new Date(ts).getHours()]++
    }
  }

  return { slug, hourly, total: hourly.reduce((a, b) => a + b, 0) }
}

export async function GET(_req: NextRequest): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })

  let channels: { projects?: Record<string, { slug?: string }> } | null = null
  try { channels = JSON.parse(fs.readFileSync(path.join(mcdDir, 'channels.json'), 'utf-8')) } catch {}

  const slugs = Object.values(channels?.projects ?? {})
    .filter((p): p is { slug: string } => !!p.slug)
    .map((p) => p.slug)

  const projects = slugs.map((slug) => buildDensity(slug, mcdDir))

  return Response.json({ projects, generatedAt: new Date().toISOString() } satisfies FleetDensityHeatmapResponse)
}

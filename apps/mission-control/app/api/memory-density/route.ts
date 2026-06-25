import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'

export const dynamic = 'force-dynamic'

export interface MemoryDensityProject {
  slug: string
  hourCounts: number[] // length 24
  total: number
}

export interface MemoryDensityResponse {
  projects: MemoryDensityProject[]
  generatedAt: string
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

function getProjectDir(mcdDir: string, slug: string): string | null {
  const p = path.join(mcdDir, 'projects', slug)
  try { return fs.realpathSync(p) } catch { return null }
}

function hourCounts(projectDir: string): number[] {
  const counts = new Array<number>(24).fill(0)
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  try {
    const out = execSync(
      `git -C "${projectDir}" log --format="%aI" --since="${since}" -- memory/`,
      { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim()
    if (!out) return counts
    for (const line of out.split('\n')) {
      const ts = line.trim()
      if (!ts) continue
      // ISO 8601: 2026-06-25T14:32:11+00:00 — hour is chars 11-12
      const h = parseInt(ts.slice(11, 13), 10)
      if (h >= 0 && h < 24) counts[h]++
    }
  } catch { /* no git history or no memory dir */ }
  return counts
}

export async function GET(): Promise<Response> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const slugs = getProjectSlugs(mcdDir)

  const projects: MemoryDensityProject[] = []
  for (const slug of slugs) {
    const dir = getProjectDir(mcdDir, slug)
    if (!dir) continue
    const hc = hourCounts(dir)
    const total = hc.reduce((s, v) => s + v, 0)
    projects.push({ slug, hourCounts: hc, total })
  }

  // Sort by total desc, max 30
  projects.sort((a, b) => b.total - a.total)
  const trimmed = projects.slice(0, 30)

  return Response.json({
    projects: trimmed,
    generatedAt: new Date().toISOString(),
  } satisfies MemoryDensityResponse)
}

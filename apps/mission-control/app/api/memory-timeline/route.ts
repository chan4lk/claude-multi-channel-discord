import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawnSync } from 'child_process'
import { isSafeSlug } from '../../../src/security'

export const dynamic = 'force-dynamic'

export interface MemoryCommit {
  sha: string
  ts: string
  message: string
}

export interface MemoryFileSeries {
  file: string         // basename
  type: string         // user | feedback | project | reference | unknown
  commits: MemoryCommit[]
}

export interface MemoryTimelineResponse {
  slug: string
  series: MemoryFileSeries[]
  windowDays: number
  generatedAt: string
}

function inferType(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.startsWith('user')) return 'user'
  if (lower.startsWith('feedback')) return 'feedback'
  if (lower.startsWith('project')) return 'project'
  if (lower.startsWith('reference')) return 'reference'
  if (lower === 'memory.md') return 'index'
  return 'unknown'
}

function getProjectDir(mcdDir: string, slug: string): string | null {
  const p = path.join(mcdDir, 'projects', slug)
  try { return fs.realpathSync(p) } catch { return null }
}

function getMemoryFiles(projectDir: string): string[] {
  const memDir = path.join(projectDir, 'memory')
  try {
    return fs.readdirSync(memDir)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(memDir, f))
  } catch { return [] }
}

function gitLogForFile(projectDir: string, filePath: string, windowDays: number): MemoryCommit[] {
  const rel = path.relative(projectDir, filePath)
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10)
  try {
    const res = spawnSync(
      'git',
      ['-C', projectDir, 'log', '--follow', '--format=%H %aI %s', `--since=${since}`, '--', rel],
      { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    if (res.status !== 0) return []
    const out = res.stdout.trim()
    if (!out) return []
    return out.split('\n').map(line => {
      const spaceIdx = line.indexOf(' ')
      const sha = line.slice(0, spaceIdx)
      const rest = line.slice(spaceIdx + 1)
      const spaceIdx2 = rest.indexOf(' ')
      const ts = rest.slice(0, spaceIdx2)
      const message = rest.slice(spaceIdx2 + 1).trim().slice(0, 80)
      return { sha: sha.slice(0, 7), ts, message }
    }).filter(c => c.sha && c.ts)
  } catch { return [] }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const slug = url.searchParams.get('slug') ?? ''
  const windowDays = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') ?? '30', 10)))
  const typeFilter = url.searchParams.get('type') ?? null

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const generatedAt = new Date().toISOString()

  if (!slug) {
    return Response.json({ slug: '', series: [], windowDays, generatedAt } satisfies MemoryTimelineResponse)
  }
  if (!isSafeSlug(slug)) {
    return Response.json({ error: 'Invalid slug' }, { status: 400 })
  }

  const projectDir = getProjectDir(mcdDir, slug)
  if (!projectDir) {
    return Response.json({ slug, series: [], windowDays, generatedAt } satisfies MemoryTimelineResponse)
  }

  const files = getMemoryFiles(projectDir)
  const series: MemoryFileSeries[] = []

  for (const filePath of files) {
    const base = path.basename(filePath)
    const type = inferType(base)
    if (typeFilter && type !== typeFilter) continue
    const commits = gitLogForFile(projectDir, filePath, windowDays)
    series.push({ file: base, type, commits })
  }

  // Sort by most recent commit first
  series.sort((a, b) => {
    const aLast = a.commits[0]?.ts ?? ''
    const bLast = b.commits[0]?.ts ?? ''
    return bLast.localeCompare(aLast)
  })

  return Response.json({ slug, series, windowDays, generatedAt } satisfies MemoryTimelineResponse)
}

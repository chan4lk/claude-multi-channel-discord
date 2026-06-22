import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import { NextRequest } from 'next/server'
import { upsertMemoryDiff, getMemoryDiffs, getMemoryDiffCacheAge } from '../../../src/db'

export const dynamic = 'force-dynamic'

const CACHE_TTL_S = 3600 // 1 hour

export interface MemoryDiffEntry {
  ts: string
  sha: string
  added: number
  removed: number
  diff: string
}

export interface ProjectMemoryDiff {
  slug: string
  driftScore: number
  entries: MemoryDiffEntry[]
}

export interface MemoryDiffResponse {
  projects: ProjectMemoryDiff[]
  generatedAt: string
}

function slugOk(slug: string): boolean {
  return /^[a-z0-9_-]+$/i.test(slug) && slug.length <= 64
}

function parseGitLogP(output: string): Array<{ sha: string; ts: number; added: number; removed: number; diff: string }> {
  const entries: Array<{ sha: string; ts: number; added: number; removed: number; diff: string }> = []
  // Split on commit boundaries: "commit <sha>"
  const commits = output.split(/^commit /m).filter((c) => c.trim())
  for (const block of commits) {
    const lines = block.split('\n')
    const sha = lines[0]?.trim().slice(0, 40)
    if (!sha || sha.length < 7) continue
    const dateLine = lines.find((l) => l.startsWith('Date:'))
    if (!dateLine) continue
    const dateStr = dateLine.replace(/^Date:\s*/, '').trim()
    const ts = Math.floor(new Date(dateStr).getTime() / 1000)
    if (isNaN(ts)) continue
    // Collect the diff portion (after the blank line after headers)
    const diffStart = lines.findIndex((l) => l.startsWith('diff '))
    const diffLines = diffStart >= 0 ? lines.slice(diffStart) : []
    const diff = diffLines.join('\n')
    const added = diffLines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length
    const removed = diffLines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length
    entries.push({ sha, ts, added, removed, diff })
  }
  return entries
}

function refreshProjectDiffs(slug: string, projectDir: string): void {
  const memPath = path.join(projectDir, 'MEMORY.md')
  if (!fs.existsSync(memPath)) return
  const gitDir = path.join(projectDir, '.git')
  if (!fs.existsSync(gitDir)) return

  let output: string
  try {
    output = execSync(
      'git log --follow -p -- MEMORY.md',
      { cwd: projectDir, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024, timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }
    )
  } catch {
    return
  }

  const entries = parseGitLogP(output)
  for (const e of entries) {
    upsertMemoryDiff(slug, e.ts, e.sha, e.added, e.removed, e.diff.slice(0, 32_000))
  }
}

function computeDriftScore(entries: MemoryDiffEntry[], totalLines: number): number {
  if (totalLines <= 0) return 0
  const changed = entries.reduce((sum, e) => sum + e.added + e.removed, 0)
  return Math.min(100, Math.round((changed / totalLines) * 100))
}

function countLines(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return content.split('\n').length
  } catch {
    return 0
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })

  const url = new URL(req.url)
  const slugParam = url.searchParams.get('slug')
  const sinceParam = url.searchParams.get('since')
  const since = sinceParam ? Math.floor(new Date(sinceParam).getTime() / 1000) : undefined

  const projectsDir = path.join(mcdDir, 'projects')
  let slugs: string[]
  if (slugParam) {
    if (!slugOk(slugParam)) return Response.json({ error: 'invalid slug' }, { status: 400 })
    slugs = [slugParam]
  } else {
    try {
      slugs = fs.readdirSync(projectsDir).filter((d) => {
        if (d.startsWith('.')) return false
        const full = fs.realpathSync(path.join(projectsDir, d))
        return fs.statSync(full).isDirectory()
      })
    } catch {
      slugs = []
    }
  }

  // Refresh stale caches
  for (const slug of slugs) {
    const cacheAge = getMemoryDiffCacheAge(slug)
    const now = Math.floor(Date.now() / 1000)
    if (cacheAge === null || now - cacheAge > CACHE_TTL_S) {
      const dir = path.join(projectsDir, slug)
      const resolved = fs.existsSync(dir) ? fs.realpathSync(dir) : dir
      refreshProjectDiffs(slug, resolved)
    }
  }

  const projects: ProjectMemoryDiff[] = []
  for (const slug of slugs) {
    const rows = getMemoryDiffs(slug, since)
    if (rows.length === 0) continue
    const entries: MemoryDiffEntry[] = rows.map((r) => ({
      ts: new Date(r.ts * 1000).toISOString(),
      sha: r.sha,
      added: r.added,
      removed: r.removed,
      diff: r.diff_text,
    }))
    const memPath = path.join(projectsDir, slug, 'MEMORY.md')
    const totalLines = countLines(memPath)
    const driftScore = computeDriftScore(entries, totalLines)
    projects.push({ slug, driftScore, entries })
  }

  projects.sort((a, b) => b.driftScore - a.driftScore)

  const resp: MemoryDiffResponse = { projects, generatedAt: new Date().toISOString() }
  return Response.json(resp)
}

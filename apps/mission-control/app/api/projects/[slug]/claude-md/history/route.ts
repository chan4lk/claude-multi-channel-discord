import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function resolveProjectDir(slug: string, mcdDir: string): string | null {
  const p = path.join(mcdDir, 'projects', slug)
  if (!fs.existsSync(p)) return null
  try { return fs.realpathSync(p) } catch { return p }
}

export interface CommitEntry {
  sha: string
  shortSha: string
  author: string
  date: string
  message: string
  diff: string // unified diff hunks for CLAUDE.md
}

export interface HistoryResponse {
  slug: string
  current: string | null
  commits: CommitEntry[]
  hasGit: boolean
  checkedAt: string
}

function runGit(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch { return '' }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )
  const known = Object.values(channels?.projects ?? {}).map((p) => p.slug).filter(Boolean)
  if (!known.includes(slug)) {
    return Response.json({ error: 'Unknown slug' }, { status: 404 })
  }

  const projectDir = resolveProjectDir(slug, mcdDir)
  if (!projectDir) {
    return Response.json({ slug, current: null, commits: [], hasGit: false, checkedAt: new Date().toISOString() } satisfies HistoryResponse)
  }

  // Read current CLAUDE.md
  let current: string | null = null
  try { current = fs.readFileSync(path.join(projectDir, 'CLAUDE.md'), 'utf-8') } catch {}

  // Check git exists
  const gitDir = path.join(projectDir, '.git')
  if (!fs.existsSync(gitDir)) {
    return Response.json({ slug, current, commits: [], hasGit: false, checkedAt: new Date().toISOString() } satisfies HistoryResponse)
  }

  // Get commit log with diffs for CLAUDE.md
  const logRaw = runGit(
    'git log --follow --format="COMMIT:%H|%h|%an|%aI|%s" -p --unified=3 -- CLAUDE.md',
    projectDir
  )

  const commits: CommitEntry[] = []

  if (logRaw.trim()) {
    // Split by COMMIT: markers
    const blocks = logRaw.split(/^COMMIT:/m).filter(Boolean)
    for (const block of blocks) {
      const firstLine = block.split('\n')[0]
      const rest = block.slice(firstLine.length + 1)
      const parts = firstLine.split('|')
      if (parts.length < 5) continue
      const [sha, shortSha, author, date, ...msgParts] = parts
      const message = msgParts.join('|').trim()

      // Extract diff hunks (lines starting with diff, @@, +, -)
      const diffLines = rest.split('\n').filter((l) =>
        l.startsWith('diff ') || l.startsWith('@@') || l.startsWith('+') || l.startsWith('-') || l.startsWith(' ')
      )
      const diff = diffLines.join('\n').trim()

      commits.push({ sha: sha.trim(), shortSha: shortSha.trim(), author: author.trim(), date: date.trim(), message: message.trim(), diff })
    }
  }

  return Response.json({ slug, current, commits, hasGit: true, checkedAt: new Date().toISOString() } satisfies HistoryResponse)
}

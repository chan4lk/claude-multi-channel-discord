import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const MAX_DIFF_LINES = 500

interface CommitEntry {
  sha: string
  shortSha: string
  message: string
  author: string
  date: string
  dateTs: number
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function resolveProjectDir(slug: string, mcdDir: string): string | null {
  const p = path.join(mcdDir, 'projects', slug)
  if (!fs.existsSync(p)) return null
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

function runGit(cwd: string, args: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      timeout: 8000,
      maxBuffer: 1024 * 512,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf-8').trim()
  } catch {
    return ''
  }
}

function parseLog(raw: string): CommitEntry[] {
  if (!raw) return []
  return raw.split('\n').map((line) => {
    const parts = line.split('\x1f')
    const dateStr = parts[3] ?? ''
    return {
      sha: parts[0] ?? '',
      shortSha: (parts[0] ?? '').slice(0, 8),
      message: parts[1] ?? '',
      author: parts[2] ?? '',
      date: dateStr,
      dateTs: dateStr ? new Date(dateStr).getTime() : 0,
    }
  }).filter((c) => c.sha)
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })
  }

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )
  const slugs = Object.values(channels?.projects ?? {}).map((p) => p.slug).filter(Boolean)
  if (!slugs.includes(slug)) {
    return Response.json({ error: 'Unknown slug' }, { status: 404 })
  }

  const projectDir = resolveProjectDir(slug, mcdDir)
  if (!projectDir || !fs.existsSync(path.join(projectDir, '.git'))) {
    return Response.json({ commits: [], patch: '', error: 'Not a git repository' })
  }

  const commit = req.nextUrl.searchParams.get('commit')

  if (commit) {
    // Return diff for specific commit
    if (!/^[0-9a-f]{4,64}$/i.test(commit)) {
      return Response.json({ error: 'Invalid commit SHA' }, { status: 400 })
    }
    const rawPatch = runGit(projectDir, `diff ${commit}^..${commit}`)
    const lines = rawPatch.split('\n')
    const truncated = lines.length > MAX_DIFF_LINES
    const patch = truncated
      ? lines.slice(0, MAX_DIFF_LINES).join('\n') + `\n\n... (${lines.length - MAX_DIFF_LINES} lines omitted)`
      : rawPatch
    return Response.json({ patch, truncated })
  }

  // Return commit list (last 20)
  const logRaw = runGit(
    projectDir,
    `log --format="%H\x1f%s\x1f%an\x1f%aI" -20`
  )
  const commits = parseLog(logRaw)
  return Response.json({ commits })
}

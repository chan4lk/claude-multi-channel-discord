import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const MAX_DIFF_LINES = 500

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
      maxBuffer: 1024 * 256,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf-8').trim()
  } catch {
    return ''
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ slug, log: '', diff: '', error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })
  }

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )
  const slugs = Object.values(channels?.projects ?? {}).map((p) => p.slug).filter(Boolean)
  if (!slugs.includes(slug)) {
    return Response.json({ slug, log: '', diff: '', error: 'Unknown slug' }, { status: 404 })
  }

  const projectDir = resolveProjectDir(slug, mcdDir)
  if (!projectDir) {
    return Response.json({ slug, log: '', diff: '' })
  }

  // Check if it's a git repo
  const isGit = fs.existsSync(path.join(projectDir, '.git'))
  if (!isGit) {
    return Response.json({ slug, log: '', diff: '', error: 'Not a git repository' })
  }

  const log = runGit(projectDir, 'log --oneline -10')

  // Diff against up to 5 commits back, falling back gracefully
  let diff = runGit(projectDir, 'diff HEAD~5..HEAD 2>/dev/null')
  if (!diff) diff = runGit(projectDir, 'diff HEAD~1..HEAD')
  if (!diff) diff = runGit(projectDir, 'diff')

  // Truncate
  const diffLines = diff.split('\n')
  const truncated = diffLines.length > MAX_DIFF_LINES
  const displayDiff = truncated
    ? diffLines.slice(0, MAX_DIFF_LINES).join('\n') + `\n\n... (${diffLines.length - MAX_DIFF_LINES} lines omitted)`
    : diff

  return Response.json({ slug, log, diff: displayDiff })
}

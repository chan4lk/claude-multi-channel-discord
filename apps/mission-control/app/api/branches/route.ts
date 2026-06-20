import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export interface BranchInfo {
  slug: string
  hasGit: boolean
  currentBranch: string | null
  aheadCount: number
  behindCount: number
  uncommittedCount: number
  lastCommitSha: string | null
  lastCommitMessage: string | null
  lastCommitAuthor: string | null
  lastCommitDate: string | null
  diverged: boolean
}

export interface BranchesResponse {
  branches: BranchInfo[]
  checkedAt: string
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, timeout: 5000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function gitBranchInfo(slug: string, mcdDir: string): BranchInfo {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { /* use as-is */ }

  const gitDir = path.join(realPath, '.git')
  if (!fs.existsSync(gitDir)) {
    return {
      slug, hasGit: false, currentBranch: null,
      aheadCount: 0, behindCount: 0, uncommittedCount: 0,
      lastCommitSha: null, lastCommitMessage: null,
      lastCommitAuthor: null, lastCommitDate: null,
      diverged: false,
    }
  }

  const currentBranch = run('git rev-parse --abbrev-ref HEAD', realPath) || null

  // Detect default remote branch (main or master)
  let remoteBranch = 'origin/main'
  const remoteRefs = run('git branch -r', realPath)
  if (!remoteRefs.includes('origin/main') && remoteRefs.includes('origin/master')) {
    remoteBranch = 'origin/master'
  }

  // Fetch quietly to get accurate ahead/behind (best effort)
  run('git fetch --quiet origin 2>/dev/null || true', realPath)

  const aheadRaw = run(`git rev-list --count ${remoteBranch}..HEAD`, realPath)
  const behindRaw = run(`git rev-list --count HEAD..${remoteBranch}`, realPath)

  const aheadCount = parseInt(aheadRaw, 10) || 0
  const behindCount = parseInt(behindRaw, 10) || 0

  const statusRaw = run('git status --porcelain', realPath)
  const uncommittedCount = statusRaw ? statusRaw.split('\n').filter(Boolean).length : 0

  const lastLogRaw = run('git log -1 --pretty=format:%H%n%s%n%an%n%ai', realPath)
  const logLines = lastLogRaw.split('\n')
  const lastCommitSha = logLines[0]?.slice(0, 8) || null
  const lastCommitMessage = logLines[1] || null
  const lastCommitAuthor = logLines[2] || null
  const lastCommitDate = logLines[3] || null

  return {
    slug,
    hasGit: true,
    currentBranch,
    aheadCount,
    behindCount,
    uncommittedCount,
    lastCommitSha,
    lastCommitMessage,
    lastCommitAuthor,
    lastCommitDate,
    diverged: aheadCount > 0 && behindCount > 0,
  }
}

export async function GET() {
  const mcdDir = process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const channels = readJson<{
    projects?: Record<string, { slug: string }>
  }>(path.join(mcdDir, 'channels.json'))

  const projects = channels?.projects ?? {}
  const slugs = Object.values(projects).map((p) => p.slug).filter(Boolean)

  const branches: BranchInfo[] = slugs.map((slug) => gitBranchInfo(slug, mcdDir))

  return NextResponse.json({
    branches,
    checkedAt: new Date().toISOString(),
  } satisfies BranchesResponse)
}

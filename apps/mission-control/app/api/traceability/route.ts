import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export interface ProposalEntry {
  number: number
  title: string
  status: 'done' | 'pending'
  commits: CommitEntry[]
}

export interface CommitEntry {
  sha: string
  message: string
  date: string
}

export interface TraceabilityResponse {
  proposals: ProposalEntry[]
  repoUrl: string | null
  generatedAt: string
}

function parseBacklog(content: string): Array<{ number: number; title: string; status: 'done' | 'pending' }> {
  const proposals: Array<{ number: number; title: string; status: 'done' | 'pending' }> = []
  const headerRe = /^## (P(\d+))\s+—\s+(.+)$/m
  const statusRe = /\*\*Status:\*\*\s+`\[([x ])\] (done|pending)`/

  const chunks = content.split(/^## P\d+/m)
  const headers = [...content.matchAll(/^## (P(\d+))\s+—\s+(.+)$/gm)]

  for (const match of headers) {
    const num = parseInt(match[2], 10)
    const title = match[3].trim()
    const idx = match.index!
    const nextIdx = content.indexOf('\n## P', idx + 1)
    const chunk = nextIdx > -1 ? content.slice(idx, nextIdx) : content.slice(idx)
    const statusMatch = statusRe.exec(chunk)
    const status: 'done' | 'pending' = statusMatch?.[1] === 'x' ? 'done' : 'pending'
    proposals.push({ number: num, title, status })
  }

  return proposals
}

function getGitLog(repoRoot: string): Array<{ sha: string; message: string; date: string }> {
  try {
    const out = execSync('git log --oneline --format="%H\t%s\t%ai" --max-count=2000', {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 10_000,
    })
    return out.trim().split('\n').filter(Boolean).map((line) => {
      const [sha, message, date] = line.split('\t')
      return { sha: sha.trim(), message: message?.trim() ?? '', date: date?.trim() ?? '' }
    })
  } catch {
    return []
  }
}

function getRepoUrl(repoRoot: string): string | null {
  try {
    const remote = execSync('git remote get-url origin', { cwd: repoRoot, encoding: 'utf-8', timeout: 5_000 }).trim()
    if (remote.startsWith('git@github.com:')) {
      const repo = remote.replace('git@github.com:', '').replace(/\.git$/, '')
      return `https://github.com/${repo}`
    }
    if (remote.startsWith('https://github.com/')) {
      return remote.replace(/\.git$/, '')
    }
    return null
  } catch {
    return null
  }
}

export async function GET(_req: NextRequest): Promise<Response> {
  const repoRoot = path.join(process.cwd(), '..', '..')
  const backlogPath = path.join(repoRoot, 'BACKLOG.md')

  let content = ''
  try { content = fs.readFileSync(backlogPath, 'utf-8') } catch {
    return Response.json({ error: 'BACKLOG.md not found' }, { status: 404 })
  }

  const proposals = parseBacklog(content)
  const commits = getGitLog(repoRoot)
  const repoUrl = getRepoUrl(repoRoot)

  const traced: ProposalEntry[] = proposals.map((p) => {
    const pTag = new RegExp(`\\bP${p.number}\\b`)
    const linked = commits.filter((c) => pTag.test(c.message))
    return { ...p, commits: linked }
  })

  return Response.json({ proposals: traced, repoUrl, generatedAt: new Date().toISOString() } satisfies TraceabilityResponse)
}

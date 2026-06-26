import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

export const dynamic = 'force-dynamic'

export type LagStatus = 'done' | 'implementing' | 'not-started'

export interface ProposalLag {
  changeSlug: string
  title: string
  status: LagStatus
  approvedAt: string | null
  firstCommitAt: string | null
  lagDays: number | null
  taskCount: number
}

export interface ProposalImplLagResponse {
  proposals: ProposalLag[]
  p50: number | null
  p90: number | null
  stallCount: number   // proposals not-started > 14 days
  generatedAt: string
}

function readText(p: string): string | null {
  try { return fs.readFileSync(p, 'utf-8') } catch { return null }
}

function parseCreatedDate(content: string): string | null {
  const m = content.match(/\*\*Created:\*\*\s*(\d{4}-\d{2}-\d{2})/i)
  return m ? m[1] : null
}

function parseStatus(content: string): 'draft' | 'approved' | 'done' | 'unknown' {
  const m = content.match(/\*\*Status:\*\*[^\n]*/i)
  if (!m) return 'unknown'
  const raw = m[0].toLowerCase()
  if (raw.includes('done') || raw.includes('✅') || raw.includes('[x]')) return 'done'
  if (raw.includes('approved') || raw.includes('🟢')) return 'approved'
  return 'draft'
}

function parseTitle(content: string): string {
  const m = content.match(/^#\s+(?:Proposal:\s*)?(.+)/m)
  return m ? m[1].trim() : ''
}

function parseTaskCount(content: string): number {
  const m = content.match(/\*\*Total Tasks:\*\*\s*(\d+)/i)
  return m ? parseInt(m[1], 10) : 0
}

function firstCommitAfter(repoRoot: string, changeSlug: string, afterIso: string): string | null {
  try {
    const afterUnix = Math.floor(new Date(afterIso).getTime() / 1000)
    const out = execSync(
      `git -C "${repoRoot}" log --all --oneline --format="%H %aI %s" --after="${afterIso}" -- . 2>/dev/null | grep -i "${changeSlug}" | tail -1`,
      { encoding: 'utf-8', timeout: 8000 }
    ).trim()
    if (!out) return null
    const parts = out.split(' ')
    return parts[1] ?? null
  } catch { return null }
}

function firstCommitBySlugFallback(repoRoot: string, changeSlug: string, afterIso: string): string | null {
  // Fallback: look for commits mentioning the slug in message after date
  try {
    const out = execSync(
      `git -C "${repoRoot}" log --all --format="%aI %s" --after="${afterIso}" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim()
    if (!out) return null
    const slugLower = changeSlug.toLowerCase()
    for (const line of out.split('\n')) {
      if (line.toLowerCase().includes(slugLower)) {
        const ts = line.split(' ')[0]
        if (ts) return ts
      }
    }
    return null
  } catch { return null }
}

let cache: { data: ProposalImplLagResponse; ts: number } | null = null
const CACHE_TTL_MS = 10 * 60 * 1000

export async function GET(): Promise<Response> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return Response.json(cache.data)
  }

  // Find repo root (walk up from cwd looking for .git)
  let repoRoot = process.cwd()
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(repoRoot, '.git'))) break
    const parent = path.dirname(repoRoot)
    if (parent === repoRoot) break
    repoRoot = parent
  }

  const specclaw = path.join(repoRoot, '.specclaw', 'changes')
  let changeDirs: string[] = []
  try {
    changeDirs = fs.readdirSync(specclaw).filter((d) => {
      try { return fs.statSync(path.join(specclaw, d)).isDirectory() } catch { return false }
    })
  } catch {
    return Response.json({
      proposals: [],
      p50: null,
      p90: null,
      stallCount: 0,
      generatedAt: new Date().toISOString(),
    } satisfies ProposalImplLagResponse)
  }

  const proposals: ProposalLag[] = []

  for (const dir of changeDirs) {
    const proposalPath = path.join(specclaw, dir, 'proposal.md')
    const tasksPath = path.join(specclaw, dir, 'tasks.md')
    const proposalText = readText(proposalPath)
    if (!proposalText) continue

    const proposalStatus = parseStatus(proposalText)
    const createdAt = parseCreatedDate(proposalText)
    const title = parseTitle(proposalText)
    const taskCount = parseTaskCount(readText(tasksPath) ?? '')

    // Determine lag status
    let lagStatus: LagStatus = 'not-started'
    if (proposalStatus === 'done') {
      lagStatus = 'done'
    } else if (proposalStatus === 'approved') {
      lagStatus = 'not-started'
    } else {
      lagStatus = 'implementing'
    }

    // Find first commit
    let firstCommitAt: string | null = null
    if (createdAt) {
      firstCommitAt = firstCommitAfter(repoRoot, dir, createdAt + 'T00:00:00Z')
        ?? firstCommitBySlugFallback(repoRoot, dir, createdAt + 'T00:00:00Z')
      if (firstCommitAt && lagStatus === 'not-started') lagStatus = 'implementing'
      if (proposalStatus === 'done') lagStatus = 'done'
    }

    let lagDays: number | null = null
    if (createdAt) {
      const approvedMs = new Date(createdAt).getTime()
      const endMs = firstCommitAt ? new Date(firstCommitAt).getTime() : Date.now()
      lagDays = Math.round((endMs - approvedMs) / 86_400_000)
    }

    proposals.push({
      changeSlug: dir,
      title,
      status: lagStatus,
      approvedAt: createdAt,
      firstCommitAt,
      lagDays,
      taskCount,
    })
  }

  // Sort by lagDays desc (stalest first)
  proposals.sort((a, b) => (b.lagDays ?? 0) - (a.lagDays ?? 0))

  // Compute P50/P90 on done+implementing proposals that have firstCommit
  const doneLags = proposals
    .filter((p) => p.firstCommitAt && p.lagDays !== null)
    .map((p) => p.lagDays!)
    .sort((a, b) => a - b)

  const p50 = doneLags.length > 0 ? doneLags[Math.floor(doneLags.length * 0.5)] ?? null : null
  const p90 = doneLags.length > 0 ? doneLags[Math.floor(doneLags.length * 0.9)] ?? null : null

  const stallCount = proposals.filter(
    (p) => p.status === 'not-started' && p.lagDays !== null && p.lagDays > 14
  ).length

  const result: ProposalImplLagResponse = {
    proposals,
    p50,
    p90,
    stallCount,
    generatedAt: new Date().toISOString(),
  }
  cache = { data: result, ts: Date.now() }
  return Response.json(result)
}

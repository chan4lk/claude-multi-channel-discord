import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export interface DeepDiveTurn {
  role: 'human' | 'assistant'
  text: string
  timestamp: string | null
}

export interface DeepDiveMemoryEntry {
  title: string
  firstLine: string
  file: string
}

export interface DeepDiveProposal {
  name: string
  status: string
  title: string
}

export interface GoalStatus {
  text: string
  status: 'active' | 'paused' | 'completed'
}

export interface DeepDiveResponse {
  slug: string
  goal: GoalStatus | null
  turns: DeepDiveTurn[]
  memories: DeepDiveMemoryEntry[]
  proposals: DeepDiveProposal[]
  checkedAt: string
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function readGoal(projectPath: string): GoalStatus | null {
  try {
    const raw = fs.readFileSync(path.join(projectPath, 'GOAL.md'), 'utf-8').trim()
    if (!raw) return null
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
    if (match) {
      const frontmatter = match[1]
      const body = match[2].trim()
      const statusMatch = frontmatter.match(/^status:\s*(\w+)$/m)
      const rawStatus = statusMatch?.[1]
      const status: 'active' | 'paused' | 'completed' =
        rawStatus === 'paused' || rawStatus === 'completed' ? rawStatus : 'active'
      return { text: (body || raw).slice(0, 300), status }
    }
    return { text: raw.slice(0, 300), status: 'active' }
  } catch { return null }
}

function readMemoryEntries(slug: string, mcdDir: string): DeepDiveMemoryEntry[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { /* ok */ }
  const encoded = encodeProjectCwd(realPath)
  const memoryDir = path.join(os.homedir(), '.claude', 'projects', encoded, 'memory')
  const entries: DeepDiveMemoryEntry[] = []
  try {
    const files = fs.readdirSync(memoryDir)
      .filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')
      .slice(0, 5)
    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(memoryDir, f), 'utf-8')
        const nameMatch = content.match(/^name:\s*(.+)$/m)
        const title = nameMatch ? nameMatch[1].trim() : f.replace('.md', '')
        const bodyLines = content
          .replace(/^---[\s\S]*?---\n?/, '')
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
        const firstLine = bodyLines[0]?.slice(0, 120) ?? ''
        entries.push({ title, firstLine, file: f })
      } catch { /* skip */ }
    }
  } catch { /* no memory dir */ }
  return entries
}

function readProposals(slug: string, mcdDir: string): DeepDiveProposal[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { /* ok */ }
  const specclaw = path.join(realPath, '.specclaw', 'changes')
  const proposals: DeepDiveProposal[] = []
  try {
    const dirs = fs.readdirSync(specclaw)
    for (const dir of dirs.slice(0, 5)) {
      try {
        const proposalPath = path.join(specclaw, dir, 'proposal.md')
        const content = fs.readFileSync(proposalPath, 'utf-8')
        const titleMatch = content.match(/^#\s+(.+)$/m)
        const statusMatch = content.match(/^status:\s*(.+)$/m)
        proposals.push({
          name: dir,
          status: statusMatch?.[1]?.trim() ?? 'pending',
          title: titleMatch?.[1]?.trim() ?? dir,
        })
      } catch { /* skip */ }
    }
  } catch { /* no specclaw */ }
  return proposals
}

interface RawLine {
  type: string
  timestamp?: string
  message?: {
    role?: string
    content?: Array<{ type: string; text?: string }>
  }
}

function readLastTurns(slug: string, mcdDir: string, limit = 5): DeepDiveTurn[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)

  let files: string[] = []
  try {
    files = fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
      .sort()
  } catch { return [] }

  const turns: DeepDiveTurn[] = []

  for (let fi = files.length - 1; fi >= 0 && turns.length < limit * 3; fi--) {
    let raw = ''
    try { raw = fs.readFileSync(files[fi], 'utf-8') } catch { continue }
    const lines = raw.trim().split('\n').filter(Boolean).reverse()
    for (const line of lines) {
      let rec: RawLine
      try { rec = JSON.parse(line) } catch { continue }
      if (rec.type !== 'message') continue
      const role = rec.message?.role
      if (role !== 'human' && role !== 'assistant') continue
      const content = rec.message?.content ?? []
      const text = content
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join(' ')
        .slice(0, 120)
      if (!text.trim()) continue
      turns.push({ role: role as 'human' | 'assistant', text, timestamp: rec.timestamp ?? null })
      if (turns.length >= limit) break
    }
    if (turns.length >= limit) break
  }

  return turns.reverse()
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const mcdDir = process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const projectPath = path.join(mcdDir, 'projects', slug)

  const goal = readGoal(projectPath)
  const turns = readLastTurns(slug, mcdDir)
  const memories = readMemoryEntries(slug, mcdDir)
  const proposals = readProposals(slug, mcdDir)

  return Response.json({
    slug,
    goal,
    turns,
    memories,
    proposals,
    checkedAt: new Date().toISOString(),
  } satisfies DeepDiveResponse)
}

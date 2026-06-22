import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findAllJsonl(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
      .sort()
  } catch { return [] }
}

export type NodeType = 'memory' | 'schedule' | 'inject' | 'branch' | 'proposal'

export interface MapNode {
  id: string
  type: NodeType
  label: string
  detail: string
  size: number // 1–5, relative weight/recency
  ts?: string // ISO timestamp if available
}

export interface MapData {
  slug: string
  state: string
  nodes: MapNode[]
  checkedAt: string
}

function getMemoryNodes(slug: string): MapNode[] {
  const memDir = path.join(os.homedir(), '.claude', 'channels', 'discord-multi', 'memory')
  const nodes: MapNode[] = []
  try {
    const files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')
    for (const f of files.slice(0, 8)) {
      let content = ''
      try { content = fs.readFileSync(path.join(memDir, f), 'utf-8') } catch { continue }
      const nameMatch = content.match(/^name:\s*(.+)$/m)
      const descMatch = content.match(/^description:\s*(.+)$/m)
      const name = nameMatch?.[1]?.trim() ?? f.replace('.md', '')
      const desc = descMatch?.[1]?.trim() ?? ''
      nodes.push({ id: `mem-${f}`, type: 'memory', label: name, detail: desc || content.slice(0, 200), size: 2 })
    }
  } catch { /* no memory dir */ }
  return nodes
}

function getScheduleNodes(slug: string, mcdDir: string): MapNode[] {
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(path.join(mcdDir, 'channels.json'))
  const chatId = Object.entries(channels?.projects ?? {}).find(([, p]) => p.slug === slug)?.[0]
  if (!chatId) return []

  const schedules = readJson<{ schedules?: Array<{ id: string; chatId: string; at?: string; prompt?: string; enabled?: boolean; interval?: string }> }>(
    path.join(mcdDir, 'schedules.json')
  )
  return (schedules?.schedules ?? [])
    .filter((s) => s.chatId === chatId)
    .slice(0, 5)
    .map((s) => ({
      id: `sched-${s.id}`,
      type: 'schedule' as NodeType,
      label: s.at ?? s.interval ?? 'scheduled',
      detail: (s.prompt ?? '').slice(0, 200),
      size: s.enabled ? 3 : 1,
    }))
}

function getInjectNodes(slug: string, mcdDir: string): MapNode[] {
  const files = findAllJsonl(slug, mcdDir)
  const injects: Array<{ ts: string; text: string }> = []

  for (const file of files.slice(-3)) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: { type: string; timestamp?: string; message?: { content?: Array<{ type: string; text?: string }> } }
      try { rec = JSON.parse(line) } catch { continue }
      if (rec.type !== 'human') continue
      const ts = rec.timestamp ?? ''
      const text = (rec.message?.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join(' ')
        .trim()
      if (text.length > 5) injects.push({ ts, text })
    }
  }

  return injects
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 5)
    .map((inj, i) => ({
      id: `inject-${i}`,
      type: 'inject' as NodeType,
      label: inj.text.slice(0, 40),
      detail: inj.text.slice(0, 300),
      size: i === 0 ? 4 : 2,
      ts: inj.ts,
    }))
}

function getBranchNodes(slug: string, mcdDir: string): MapNode[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  try {
    const raw = execSync('git branch --format="%(refname:short)|%(committerdate:iso)|%(subject)"', {
      cwd: projectPath, encoding: 'utf-8', timeout: 5000
    })
    return raw.trim().split('\n').filter(Boolean).slice(0, 6).map((line, i) => {
      const [name, date, subject] = line.split('|')
      return {
        id: `branch-${i}`,
        type: 'branch' as NodeType,
        label: name?.trim() ?? `branch-${i}`,
        detail: subject?.trim() ?? '',
        size: name?.trim() === 'main' || name?.trim() === 'master' ? 1 : 3,
        ts: date?.trim(),
      }
    })
  } catch { return [] }
}

function getProposalNodes(slug: string, mcdDir: string): MapNode[] {
  const backlogPath = path.join(mcdDir, '..', '..', 'BACKLOG.md')
  let content = ''
  try { content = fs.readFileSync(backlogPath, 'utf-8') } catch {
    // try cwd-relative
    try { content = fs.readFileSync('BACKLOG.md', 'utf-8') } catch { return [] }
  }

  const sections = content.split(/^## /m).filter(Boolean)
  const matching: MapNode[] = []
  for (const sec of sections) {
    if (!sec.toLowerCase().includes(slug.toLowerCase())) continue
    const titleMatch = sec.match(/^(P\d+[^\\n]*)/)
    const title = titleMatch?.[1]?.trim() ?? sec.slice(0, 40)
    const statusMatch = sec.match(/\*\*Status:\*\*\s*`([^`]+)`/)
    const status = statusMatch?.[1] ?? ''
    matching.push({
      id: `proposal-${matching.length}`,
      type: 'proposal',
      label: title.slice(0, 50),
      detail: `Status: ${status}\n${sec.slice(0, 200)}`,
      size: status.includes('done') ? 1 : 3,
    })
  }
  return matching.slice(0, 5)
}

function getProjectState(slug: string, mcdDir: string): string {
  // Check channels.json for anything useful; default to 'unknown'
  const channels = readJson<{ projects?: Record<string, { slug?: string; state?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )
  const proj = Object.values(channels?.projects ?? {}).find((p) => p.slug === slug)
  return proj?.state ?? 'unknown'
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ slug, state: 'unknown', nodes: [], checkedAt: new Date().toISOString() } satisfies MapData)

  const nodes: MapNode[] = [
    ...getMemoryNodes(slug),
    ...getScheduleNodes(slug, mcdDir),
    ...getInjectNodes(slug, mcdDir),
    ...getBranchNodes(slug, mcdDir),
    ...getProposalNodes(slug, mcdDir),
  ]

  const state = getProjectState(slug, mcdDir)

  return Response.json({ slug, state, nodes, checkedAt: new Date().toISOString() } satisfies MapData)
}

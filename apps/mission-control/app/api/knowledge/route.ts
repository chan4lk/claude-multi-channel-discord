import * as fs from 'fs'
import * as path from 'path'
import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'

export const dynamic = 'force-dynamic'

export type KnowledgeNodeType = 'project' | 'memory' | 'goal'
export type GoalStatus = 'active' | 'paused' | 'completed'
export type ProjectState = 'idle' | 'active' | 'stalled' | 'autonomous'

export interface KnowledgeNode {
  id: string
  type: KnowledgeNodeType
  label: string
  // project
  state?: ProjectState
  ageMins?: number
  // memory
  memType?: string
  content?: string
  accessCount?: number
  channelSlug?: string
  // goal
  goalStatus?: GoalStatus
  goalText?: string
  // layout hint
  size: number
}

export interface KnowledgeEdge {
  source: string
  target: string
  kind: 'project-memory' | 'project-goal'
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function getTranscriptMtime(slug: string, mcdDir: string): number | null {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return null }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(process.env.HOME ?? '/root', '.claude', 'projects', encoded)
  try {
    const files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
    let latest = 0
    for (const f of files) {
      try { const m = fs.statSync(path.join(transcriptDir, f)).mtimeMs; if (m > latest) latest = m } catch {}
    }
    return latest || null
  } catch { return null }
}

function classifyState(mtime: number | null, hasSchedule: boolean): ProjectState {
  const ageMs = mtime ? Date.now() - mtime : Infinity
  if (ageMs < 30_000) return 'active'
  if (ageMs < 5 * 60_000) return hasSchedule ? 'autonomous' : 'idle'
  if (ageMs < 2 * 60 * 60_000) return hasSchedule ? 'autonomous' : 'stalled'
  return hasSchedule ? 'autonomous' : 'idle'
}

function parseGoal(raw: string): { goalText: string; goalStatus: GoalStatus } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (match) {
    const statusMatch = match[1].match(/^status:\s*(\w+)$/m)
    const s = statusMatch?.[1]
    const goalStatus: GoalStatus = (s === 'paused' || s === 'completed') ? s : 'active'
    return { goalText: (match[2].trim() || raw).slice(0, 200), goalStatus }
  }
  return { goalText: raw.trim().slice(0, 200), goalStatus: 'active' }
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ nodes: [], edges: [] } satisfies KnowledgeGraph)

  const channels = readJson<{
    projects?: Record<string, { slug?: string }>
    defaults?: { stuckThresholdMinutes?: number }
  }>(path.join(mcdDir, 'channels.json'))

  const schedules = readJson<{ schedules?: Array<{ chatId?: string; enabled?: boolean }> }>(
    path.join(mcdDir, 'schedules.json')
  )

  const chatIdToSlug = new Map<string, string>()
  const slugs: string[] = []
  if (channels?.projects) {
    for (const [chatId, proj] of Object.entries(channels.projects)) {
      if (proj.slug) { chatIdToSlug.set(chatId, proj.slug); slugs.push(proj.slug) }
    }
  }

  const scheduledSlugs = new Set<string>()
  for (const s of schedules?.schedules ?? []) {
    if (s.enabled !== false && s.chatId) {
      const slug = chatIdToSlug.get(s.chatId)
      if (slug) scheduledSlugs.add(slug)
    }
  }

  const nodes: KnowledgeNode[] = []
  const edges: KnowledgeEdge[] = []

  // Project nodes
  for (const slug of slugs) {
    const mtime = getTranscriptMtime(slug, mcdDir)
    const ageMs = mtime ? Date.now() - mtime : Infinity
    const ageMins = Math.min(Math.floor(ageMs / 60_000), 9999)
    const state = classifyState(mtime, scheduledSlugs.has(slug))
    nodes.push({ id: slug, type: 'project', label: slug, state, ageMins, size: 20 })
  }

  // Goal nodes + project-goal edges
  for (const slug of slugs) {
    const goalPath = path.join(mcdDir, 'projects', slug, 'GOAL.md')
    try {
      const raw = fs.readFileSync(goalPath, 'utf-8').trim()
      if (!raw) continue
      const { goalText, goalStatus } = parseGoal(raw)
      const goalId = `goal:${slug}`
      nodes.push({ id: goalId, type: 'goal', label: goalText.slice(0, 40), goalText, goalStatus, size: 16 })
      edges.push({ source: slug, target: goalId, kind: 'project-goal' })
    } catch {}
  }

  // Memory nodes + project-memory edges (top 100 by access_count)
  const channelsDir = process.env.MCD_CHANNELS_DIR ?? path.join(process.env.HOME ?? '/root', '.claude', 'channels', 'discord-multi')
  const dbPath = path.join(channelsDir, 'memory.db')
  if (existsSync(dbPath)) {
    try {
      const db = new Database(dbPath, { readonly: true, fileMustExist: true })
      try {
        type MemRow = { id: string; channel_slug: string | null; type: string; content: string; access_count: number }
        const rows = db.prepare(
          `SELECT id, channel_slug, type, content, access_count
           FROM memories
           ORDER BY access_count DESC, last_accessed_at DESC
           LIMIT 100`
        ).all() as MemRow[]

        const slugSet = new Set(slugs)
        for (const row of rows) {
          const memId = `mem:${row.id}`
          const maxSize = 18
          const minSize = 8
          const size = Math.min(maxSize, minSize + Math.round((row.access_count ?? 0) * 0.5))
          nodes.push({
            id: memId,
            type: 'memory',
            label: row.type,
            memType: row.type,
            content: row.content?.slice(0, 200),
            accessCount: row.access_count,
            channelSlug: row.channel_slug ?? undefined,
            size,
          })
          if (row.channel_slug && slugSet.has(row.channel_slug)) {
            edges.push({ source: row.channel_slug, target: memId, kind: 'project-memory' })
          }
        }
      } finally {
        db.close()
      }
    } catch {}
  }

  return Response.json({ nodes, edges } satisfies KnowledgeGraph)
}

import * as fs from 'fs'
import * as path from 'path'
import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'

export const dynamic = 'force-dynamic'

export type ProjectState = 'idle' | 'active' | 'stalled' | 'autonomous'
export type GoalStatus = 'active' | 'paused' | 'completed' | 'none'

export interface NexusProject {
  slug: string
  state: ProjectState
  ageMins: number
  memoryCount: number
  proposalPending: number
  proposalDone: number
  goalStatus: GoalStatus
  goalText: string | null
}

export interface NexusFleet {
  projects: number
  memories: number
  proposalPending: number
  proposalDone: number
  activeGoals: number
}

export interface NexusResponse {
  projects: NexusProject[]
  fleet: NexusFleet
  generatedAt: string
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function readFile(filePath: string): string | null {
  try { return fs.readFileSync(filePath, 'utf-8') } catch { return null }
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

// Count pending/done proposals from a project's BACKLOG.md (`## P… — Title` sections).
function countProposals(content: string): { pending: number; done: number } {
  let pending = 0
  let done = 0
  const sections = content.split(/^##\s+/m).slice(1)
  for (const section of sections) {
    if (!section.split('\n')[0]?.trim()) continue
    if (section.includes('[x] done')) done++
    else if (section.includes('[ ] pending') || section.includes('[ ] in-progress')) pending++
  }
  return { pending, done }
}

function parseGoal(raw: string): { goalText: string; goalStatus: GoalStatus } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (match) {
    const statusMatch = match[1].match(/^status:\s*(\w+)$/m)
    const s = statusMatch?.[1]
    const goalStatus: GoalStatus = (s === 'paused' || s === 'completed') ? s : 'active'
    return { goalText: (match[2].trim() || raw).slice(0, 160), goalStatus }
  }
  return { goalText: raw.trim().slice(0, 160), goalStatus: 'active' }
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  const empty: NexusResponse = {
    projects: [],
    fleet: { projects: 0, memories: 0, proposalPending: 0, proposalDone: 0, activeGoals: 0 },
    generatedAt: new Date().toISOString(),
  }
  if (!mcdDir) return Response.json(empty)

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )
  const schedules = readJson<{ schedules?: Array<{ chatId?: string; enabled?: boolean }> }>(
    path.join(mcdDir, 'schedules.json')
  )

  const chatIdToSlug = new Map<string, string>()
  const slugs: string[] = []
  for (const [chatId, proj] of Object.entries(channels?.projects ?? {})) {
    if (proj.slug) { chatIdToSlug.set(chatId, proj.slug); slugs.push(proj.slug) }
  }

  const scheduledSlugs = new Set<string>()
  for (const s of schedules?.schedules ?? []) {
    if (s.enabled !== false && s.chatId) {
      const slug = chatIdToSlug.get(s.chatId)
      if (slug) scheduledSlugs.add(slug)
    }
  }

  // Memory counts per channel_slug from memory.db (one query, grouped).
  const memCounts = new Map<string, number>()
  const dbPath = path.join(mcdDir, 'memory.db')
  if (existsSync(dbPath)) {
    try {
      const db = new Database(dbPath, { readonly: true, fileMustExist: true })
      try {
        const rows = db.prepare(
          `SELECT channel_slug AS slug, COUNT(*) AS n FROM memories WHERE channel_slug IS NOT NULL GROUP BY channel_slug`
        ).all() as Array<{ slug: string; n: number }>
        for (const r of rows) memCounts.set(r.slug, r.n)
      } finally {
        db.close()
      }
    } catch {}
  }

  const projects: NexusProject[] = []
  for (const slug of slugs) {
    const projectDir = path.join(mcdDir, 'projects', slug)
    const mtime = getTranscriptMtime(slug, mcdDir)
    const ageMins = Math.min(mtime ? Math.floor((Date.now() - mtime) / 60_000) : 9999, 9999)
    const state = classifyState(mtime, scheduledSlugs.has(slug))

    let proposalPending = 0
    let proposalDone = 0
    const backlog = readFile(path.join(projectDir, 'BACKLOG.md'))
    if (backlog) {
      const c = countProposals(backlog)
      proposalPending = c.pending
      proposalDone = c.done
    }

    let goalStatus: GoalStatus = 'none'
    let goalText: string | null = null
    const goalRaw = readFile(path.join(projectDir, 'GOAL.md'))
    if (goalRaw && goalRaw.trim()) {
      const g = parseGoal(goalRaw.trim())
      goalStatus = g.goalStatus
      goalText = g.goalText
    }

    projects.push({
      slug,
      state,
      ageMins,
      memoryCount: memCounts.get(slug) ?? 0,
      proposalPending,
      proposalDone,
      goalStatus,
      goalText,
    })
  }

  // Busiest first: pending proposals, then memory volume.
  projects.sort((a, b) => (b.proposalPending - a.proposalPending) || (b.memoryCount - a.memoryCount))

  const fleet: NexusFleet = {
    projects: projects.length,
    memories: projects.reduce((s, p) => s + p.memoryCount, 0),
    proposalPending: projects.reduce((s, p) => s + p.proposalPending, 0),
    proposalDone: projects.reduce((s, p) => s + p.proposalDone, 0),
    activeGoals: projects.filter((p) => p.goalStatus === 'active').length,
  }

  return Response.json({ projects, fleet, generatedAt: new Date().toISOString() } satisfies NexusResponse)
}

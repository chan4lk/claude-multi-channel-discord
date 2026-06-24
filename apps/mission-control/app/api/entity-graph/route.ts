import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

export const dynamic = 'force-dynamic'

// P213 — Unified Entity Graph (Project ⇄ Memory ⇄ Proposal).
// One tri-partite graph fusing runtime projects, the memories they own, and the
// proposals they're working. Edges: project→memory (ownership) and
// project→proposal (pending/active work). No orphan references — every edge
// endpoint is guaranteed to be in `nodes`.

export type EntityKind = 'project' | 'memory' | 'proposal'

export interface EntityNode {
  id: string // `${kind}:${key}`
  kind: EntityKind
  label: string
  slug: string // owning project slug (for project nodes, its own slug)
  degree: number // edge count (project nodes sized by this)
  meta: Record<string, string | number | null>
  href: string // deep-link to the entity's full view
}

export interface EntityEdge {
  source: string // node id
  target: string // node id
  kind: 'owns' | 'works'
}

export interface EntityGraphResponse {
  nodes: EntityNode[]
  edges: EntityEdge[]
  counts: { projects: number; memories: number; proposals: number }
}

function mcdDir(): string {
  return process.env.MCD_CHANNELS_DIR ?? join(process.env.HOME ?? '/root', '.claude', 'channels', 'discord-multi')
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function readFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

interface ProposalItem { title: string; status: string }

// Pending/active proposals only — done items are noise on this canvas.
function parseBacklogMd(content: string): ProposalItem[] {
  const out: ProposalItem[] = []
  const sections = content.split(/^##\s+/m).slice(1)
  for (const section of sections) {
    const lines = section.split('\n')
    const titleLine = lines[0]?.trim() ?? ''
    const title = titleLine.replace(/^[A-Z0-9]+\s+[—–-]\s+/, '').trim()
    if (!title) continue
    let status = 'unknown'
    for (const line of lines) {
      if (line.includes('[x] done')) { status = 'done'; break }
      if (line.includes('[ ] pending') || line.includes('[ ] in-progress')) { status = 'pending'; break }
    }
    if (status === 'pending') out.push({ title, status })
  }
  return out
}

function parseSpecclawStatus(content: string): ProposalItem[] {
  const out: ProposalItem[] = []
  for (const line of content.split('\n')) {
    const m = line.match(/^[-*]\s+\[([ x])\]\s+(.+)/)
    if (m && m[1] === ' ') {
      const title = m[2]?.trim() ?? ''
      if (title) out.push({ title, status: 'pending' })
    }
  }
  return out
}

function firstLine(content: string, max = 60): string {
  const line = content.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

export async function GET(): Promise<Response> {
  const empty: EntityGraphResponse = { nodes: [], edges: [], counts: { projects: 0, memories: 0, proposals: 0 } }
  const dir = mcdDir()

  const channels = readJson<{ projects?: Record<string, { slug?: string; model?: string }> }>(join(dir, 'channels.json'))
  const projectEntries = Object.values(channels?.projects ?? {}).filter((p) => p.slug)
  if (projectEntries.length === 0) return Response.json(empty)

  const nodes = new Map<string, EntityNode>()
  const edges: EntityEdge[] = []
  const degree = new Map<string, number>()
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1)

  const ensureProject = (slug: string, model?: string): string => {
    const id = `project:${slug}`
    if (!nodes.has(id)) {
      nodes.set(id, {
        id, kind: 'project', label: slug, slug, degree: 0,
        meta: { model: model ?? null },
        href: `/focus/${encodeURIComponent(slug)}`,
      })
    }
    return id
  }

  for (const p of projectEntries) ensureProject(p.slug!, p.model)

  // Memory nodes (owned by their channel_slug) ----------------------------
  const dbPath = join(dir, 'memory.db')
  let memoryCount = 0
  if (existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const rows = db.prepare(
        `SELECT id, channel_slug, type, content, access_count
           FROM memories ORDER BY last_accessed_at DESC LIMIT 300`
      ).all() as Array<{ id: number; channel_slug: string; type: string; content: string; access_count: number }>
      for (const r of rows) {
        if (!r.channel_slug) continue
        const projId = ensureProject(r.channel_slug)
        const id = `memory:${r.id}`
        nodes.set(id, {
          id, kind: 'memory', label: firstLine(r.content) || `memory ${r.id}`, slug: r.channel_slug, degree: 0,
          meta: { type: r.type ?? null, accessCount: r.access_count ?? 0 },
          href: `/memory-graph?slug=${encodeURIComponent(r.channel_slug)}`,
        })
        edges.push({ source: projId, target: id, kind: 'owns' })
        bump(projId); bump(id)
        memoryCount++
      }
    } finally {
      db.close()
    }
  }

  // Proposal nodes (worked by their project) ------------------------------
  let proposalCount = 0
  for (const p of projectEntries) {
    const slug = p.slug!
    const projectDir = join(dir, 'projects', slug)
    const items: ProposalItem[] = []
    const backlog = readFile(join(projectDir, 'BACKLOG.md'))
    if (backlog) items.push(...parseBacklogMd(backlog))
    const status = readFile(join(projectDir, '.specclaw', 'STATUS.md'))
    if (status) items.push(...parseSpecclawStatus(status))

    items.forEach((item, i) => {
      const projId = ensureProject(slug)
      const id = `proposal:${slug}:${i}`
      nodes.set(id, {
        id, kind: 'proposal', label: item.title, slug, degree: 0,
        meta: { status: item.status },
        href: `/backlog`,
      })
      edges.push({ source: projId, target: id, kind: 'works' })
      bump(projId); bump(id)
      proposalCount++
    })
  }

  // Stamp degree onto every node.
  for (const n of nodes.values()) n.degree = degree.get(n.id) ?? 0

  return Response.json({
    nodes: Array.from(nodes.values()),
    edges,
    counts: {
      projects: Array.from(nodes.values()).filter((n) => n.kind === 'project').length,
      memories: memoryCount,
      proposals: proposalCount,
    },
  } satisfies EntityGraphResponse)
}

import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import {
  computeBridge,
  type BridgeMemory,
  type BridgeProposal,
  type BridgeGraph,
} from '../../../lib/memory-proposal-bridge'

export const dynamic = 'force-dynamic'

// P215 — Memory ⇄ Proposal Theme Bridge.
// Surfaces token-overlap between memory descriptions and pending proposals, so an
// operator can see when a proposal's theme is already grounded in prior learning.

export type { BridgeGraph, BridgeNode, BridgeEdge } from '../../../lib/memory-proposal-bridge'

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

function firstLine(content: string): string {
  return content.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
}

// Pending proposals only, with their title + problem statement as theme text.
function parseBacklogMd(content: string, slug: string, start: number): BridgeProposal[] {
  const out: BridgeProposal[] = []
  const sections = content.split(/^##\s+/m).slice(1)
  let i = start
  for (const section of sections) {
    const lines = section.split('\n')
    const titleLine = lines[0]?.trim() ?? ''
    const title = titleLine.replace(/^[A-Z0-9]+\s+[—–-]\s+/, '').trim()
    if (!title) continue
    const isPending = section.includes('[ ] pending') || section.includes('[ ] in-progress')
    if (!isPending) continue
    // Grab the Problem section text (best-effort) to enrich theme matching.
    const probMatch = section.match(/###\s+Problem\s*\n([\s\S]*?)(?:\n###|\n##|$)/)
    const problem = probMatch?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
    out.push({ id: `proposal:${slug}:${i}`, slug, title, text: `${title}. ${problem}` })
    i++
  }
  return out
}

function parseSpecclawStatus(content: string, slug: string, start: number): BridgeProposal[] {
  const out: BridgeProposal[] = []
  let i = start
  for (const line of content.split('\n')) {
    const m = line.match(/^[-*]\s+\[([ x])\]\s+(.+)/)
    if (m && m[1] === ' ') {
      const title = m[2]?.trim() ?? ''
      if (title) { out.push({ id: `proposal:${slug}:${i}`, slug, title, text: title }); i++ }
    }
  }
  return out
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const minShared = Math.max(1, parseInt(url.searchParams.get('min') ?? '2', 10) || 2)
  const empty: BridgeGraph = { memories: [], proposals: [], edges: [], threshold: minShared }
  const dir = mcdDir()

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(join(dir, 'channels.json'))
  const projectEntries = Object.values(channels?.projects ?? {}).filter((p) => p.slug)
  if (projectEntries.length === 0) return Response.json(empty)

  // Memories (descriptions) -------------------------------------------------
  const memories: BridgeMemory[] = []
  const dbPath = join(dir, 'memory.db')
  if (existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const rows = db.prepare(
        `SELECT id, channel_slug, type, content FROM memories
           WHERE channel_slug IS NOT NULL AND channel_slug != ''
           ORDER BY last_accessed_at DESC LIMIT 300`
      ).all() as Array<{ id: number; channel_slug: string; type: string; content: string }>
      for (const r of rows) {
        const text = firstLine(r.content) || r.content.slice(0, 120)
        if (!text) continue
        memories.push({ id: `memory:${r.id}`, slug: r.channel_slug, text, type: r.type })
      }
    } finally {
      db.close()
    }
  }

  // Proposals (pending) -----------------------------------------------------
  const proposals: BridgeProposal[] = []
  for (const p of projectEntries) {
    const slug = p.slug!
    const projectDir = join(dir, 'projects', slug)
    const backlog = readFile(join(projectDir, 'BACKLOG.md'))
    if (backlog) proposals.push(...parseBacklogMd(backlog, slug, proposals.length))
    const status = readFile(join(projectDir, '.specclaw', 'STATUS.md'))
    if (status) proposals.push(...parseSpecclawStatus(status, slug, proposals.length))
  }

  if (memories.length === 0 || proposals.length === 0) return Response.json(empty)

  return Response.json(computeBridge(memories, proposals, minShared))
}

import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export interface BacklogItem {
  title: string
  status: 'pending' | 'done' | 'unknown'
  createdAt: string | null
}

export interface ProjectBacklog {
  slug: string
  items: BacklogItem[]
  pendingCount: number
}

export interface BacklogResponse {
  projects: ProjectBacklog[]
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

function parseBacklogMd(content: string): BacklogItem[] {
  const items: BacklogItem[] = []
  // Match headings like ## P1 — Title
  const sections = content.split(/^##\s+/m).slice(1)
  for (const section of sections) {
    const lines = section.split('\n')
    const titleLine = lines[0]?.trim() ?? ''
    const title = titleLine.replace(/^[A-Z0-9]+\s+[—–-]\s+/, '').trim()
    if (!title) continue

    let status: BacklogItem['status'] = 'unknown'
    let createdAt: string | null = null

    for (const line of lines) {
      if (line.includes('[x] done')) status = 'done'
      else if (line.includes('[ ] pending') || line.includes('[ ] in-progress')) status = 'pending'

      const dateMatch = line.match(/\*\*Created:\*\*\s*(\d{4}-\d{2}-\d{2})/)
      if (dateMatch) createdAt = dateMatch[1] ?? null
    }

    items.push({ title, status, createdAt })
  }
  return items
}

function parseSpecclawStatus(content: string): BacklogItem[] {
  const items: BacklogItem[] = []
  const lines = content.split('\n')
  for (const line of lines) {
    // Match lines like: - [ ] proposal-name or - [x] proposal-name
    const m = line.match(/^[-*]\s+\[([ x])\]\s+(.+)/)
    if (m) {
      const done = m[1] === 'x'
      const title = m[2]?.trim() ?? ''
      if (title) {
        items.push({ title, status: done ? 'done' : 'pending', createdAt: null })
      }
    }
  }
  return items
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ projects: [] } satisfies BacklogResponse)
  }

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const result: ProjectBacklog[] = []

  for (const proj of Object.values(channels?.projects ?? {})) {
    const slug = proj.slug
    if (!slug) continue

    const projectDir = path.join(mcdDir, 'projects', slug)
    const items: BacklogItem[] = []

    // Try BACKLOG.md
    const backlogContent = readFile(path.join(projectDir, 'BACKLOG.md'))
    if (backlogContent) {
      items.push(...parseBacklogMd(backlogContent))
    }

    // Try .specclaw/STATUS.md
    const statusContent = readFile(path.join(projectDir, '.specclaw', 'STATUS.md'))
    if (statusContent) {
      items.push(...parseSpecclawStatus(statusContent))
    }

    if (items.length === 0) continue

    const pendingCount = items.filter((i) => i.status === 'pending').length
    result.push({ slug, items, pendingCount })
  }

  result.sort((a, b) => b.pendingCount - a.pendingCount)

  return Response.json({ projects: result } satisfies BacklogResponse)
}

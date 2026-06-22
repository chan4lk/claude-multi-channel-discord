import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference' | 'unknown'

export interface MemoryEntry {
  id: string
  project: string
  filename: string
  filePath: string
  name: string
  type: MemoryType
  description: string
  body: string
  lastModifiedMs: number
  isStale: boolean
}

export interface MemoryAuditResponse {
  entries: MemoryEntry[]
  generatedAt: string
}

const STALE_DAYS = 30
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000

function parseFrontmatter(content: string): {
  name: string
  type: MemoryType
  description: string
  body: string
} {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!fmMatch) {
    return { name: '', type: 'unknown', description: '', body: content.trim() }
  }

  const fm = fmMatch[1]
  const body = fmMatch[2].trim()

  function extractField(key: string): string {
    const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
    return m ? m[1].trim() : ''
  }

  const name = extractField('name')
  const description = extractField('description')
  const rawType = extractField('type')
  const type: MemoryType = ['user', 'feedback', 'project', 'reference'].includes(rawType)
    ? (rawType as MemoryType)
    : 'unknown'

  return { name, type, description, body }
}

function scanProjectMemory(projectDir: string, slug: string): MemoryEntry[] {
  const memDir = path.join(projectDir, 'memory')
  let files: string[] = []
  try {
    files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')
  } catch { return [] }

  const entries: MemoryEntry[] = []

  for (const filename of files) {
    const filePath = path.join(memDir, filename)
    let content = ''
    let statResult: fs.Stats | null = null
    try {
      content = fs.readFileSync(filePath, 'utf-8')
      statResult = fs.statSync(filePath)
    } catch { continue }

    const lastModifiedMs = statResult?.mtimeMs ?? Date.now()
    const isStale = Date.now() - lastModifiedMs > STALE_MS

    const { name, type, description, body } = parseFrontmatter(content)

    entries.push({
      id: `${slug}/${filename}`,
      project: slug,
      filename,
      filePath,
      name: name || filename.replace(/\.md$/, ''),
      type,
      description,
      body,
      lastModifiedMs,
      isStale,
    })
  }

  return entries
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ entries: [], generatedAt: new Date().toISOString() } satisfies MemoryAuditResponse)
  }

  const projectsDir = path.join(mcdDir, 'projects')
  let projectDirs: string[] = []
  try {
    projectDirs = fs.readdirSync(projectsDir).filter((name) => {
      if (name.startsWith('.')) return false
      const fullPath = path.join(projectsDir, name)
      try { return fs.statSync(fullPath).isDirectory() } catch { return false }
    })
  } catch {
    return Response.json({ entries: [], generatedAt: new Date().toISOString() } satisfies MemoryAuditResponse)
  }

  const allEntries: MemoryEntry[] = []

  for (const slug of projectDirs) {
    const projectDir = path.join(projectsDir, slug)
    const entries = scanProjectMemory(projectDir, slug)
    allEntries.push(...entries)
  }

  // Sort by lastModified desc
  allEntries.sort((a, b) => b.lastModifiedMs - a.lastModifiedMs)

  return Response.json({
    entries: allEntries,
    generatedAt: new Date().toISOString(),
  } satisfies MemoryAuditResponse)
}

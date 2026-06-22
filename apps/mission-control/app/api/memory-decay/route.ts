import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export interface MemoryFile {
  filename: string
  name: string
  ageDays: number
  decayPct: number
  body: string
}

export interface ProjectMemoryDecay {
  slug: string
  memoryCount: number
  staleCount: number
  freshCount: number
  oldestAgeDays: number
  newestAgeDays: number
  avgAgeDays: number
  refreshNeeded: boolean
  memories: MemoryFile[]
}

export interface MemoryDecayResponse {
  projects: ProjectMemoryDecay[]
  mostStale: { slug: string; filename: string; name: string; ageDays: number }[]
  generatedAt: string
}

function parseName(content: string): string {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!fmMatch) return ''
  const fm = fmMatch[1]
  const m = fm.match(/^name:\s*(.+)$/m)
  return m ? m[1].trim() : ''
}

function parseBody(content: string): string {
  const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/)
  const body = fmMatch ? fmMatch[1].trim() : content.trim()
  const lines = body.split('\n').slice(0, 2)
  return lines.join(' ').slice(0, 200)
}

function scanProjectMemory(projectDir: string, slug: string): ProjectMemoryDecay | null {
  const memDir = path.join(projectDir, 'memory')
  let files: string[] = []
  try {
    files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')
  } catch { return null }

  if (files.length === 0) return null

  const now = Date.now()
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  const memories: MemoryFile[] = []

  for (const filename of files) {
    const filePath = path.join(memDir, filename)
    let content = ''
    let statResult: fs.Stats | null = null
    try {
      content = fs.readFileSync(filePath, 'utf-8')
      statResult = fs.statSync(filePath)
    } catch { continue }

    const mtimeMs = statResult?.mtimeMs ?? now
    const ageDays = Math.floor((now - mtimeMs) / MS_PER_DAY)
    const decayPct = Math.min(100, Math.round((ageDays / 60) * 100))
    const name = parseName(content) || filename.replace(/\.md$/, '')
    const body = parseBody(content)

    memories.push({ filename, name, ageDays, decayPct, body })
  }

  if (memories.length === 0) return null

  const ageDaysArr = memories.map((m) => m.ageDays)
  const staleCount = memories.filter((m) => m.ageDays > 30).length
  const freshCount = memories.filter((m) => m.ageDays <= 7).length
  const oldestAgeDays = Math.max(...ageDaysArr)
  const newestAgeDays = Math.min(...ageDaysArr)
  const avgAgeDays = Math.round(ageDaysArr.reduce((s, v) => s + v, 0) / ageDaysArr.length)
  const refreshNeeded = staleCount / memories.length > 0.5

  memories.sort((a, b) => b.ageDays - a.ageDays)

  return {
    slug,
    memoryCount: memories.length,
    staleCount,
    freshCount,
    oldestAgeDays,
    newestAgeDays,
    avgAgeDays,
    refreshNeeded,
    memories,
  }
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({
      projects: [],
      mostStale: [],
      generatedAt: new Date().toISOString(),
    } satisfies MemoryDecayResponse)
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
    return Response.json({
      projects: [],
      mostStale: [],
      generatedAt: new Date().toISOString(),
    } satisfies MemoryDecayResponse)
  }

  const projects: ProjectMemoryDecay[] = []

  for (const slug of projectDirs) {
    const projectDir = path.join(projectsDir, slug)
    const result = scanProjectMemory(projectDir, slug)
    if (result) projects.push(result)
  }

  // Sort projects by avgAgeDays desc
  projects.sort((a, b) => b.avgAgeDays - a.avgAgeDays)

  // Top 10 most stale individual memories across all projects
  const allMemories: { slug: string; filename: string; name: string; ageDays: number }[] = []
  for (const p of projects) {
    for (const m of p.memories) {
      allMemories.push({ slug: p.slug, filename: m.filename, name: m.name, ageDays: m.ageDays })
    }
  }
  allMemories.sort((a, b) => b.ageDays - a.ageDays)
  const mostStale = allMemories.slice(0, 10)

  return Response.json({
    projects,
    mostStale,
    generatedAt: new Date().toISOString(),
  } satisfies MemoryDecayResponse)
}

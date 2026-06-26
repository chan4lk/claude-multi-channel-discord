import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

export interface MemoryGapProject {
  slug: string
  hasMemoryDir: boolean
  typeCounts: Record<MemoryType, number>
  missingTypes: MemoryType[]
  totalFiles: number
  isActive: boolean   // transcript modified < 7d
  gapCount: number    // number of missing canonical types
}

export interface MemoryGapsResponse {
  projects: MemoryGapProject[]
  generatedAt: string
}

function getProjectSlugs(mcdDir: string): string[] {
  const projectsDir = path.join(mcdDir, 'projects')
  try {
    return fs.readdirSync(projectsDir).filter((s) => {
      if (s.startsWith('.')) return false
      try {
        const stat = fs.statSync(path.join(projectsDir, s))
        return stat.isDirectory() || stat.isSymbolicLink()
      } catch { return false }
    })
  } catch { return [] }
}

function getProjectDir(mcdDir: string, slug: string): string | null {
  const p = path.join(mcdDir, 'projects', slug)
  try { return fs.realpathSync(p) } catch { return null }
}

function isActiveProject(projectDir: string): boolean {
  const sevenDaysMs = 7 * 24 * 3_600_000
  const encoded = projectDir.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    const files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
    if (files.length === 0) return false
    const mtimes = files.map((f) => {
      try { return fs.statSync(path.join(transcriptDir, f)).mtimeMs } catch { return 0 }
    })
    return (Date.now() - Math.max(...mtimes)) < sevenDaysMs
  } catch { return false }
}

function analyzeMemoryDir(projectDir: string): {
  hasMemoryDir: boolean
  typeCounts: Record<MemoryType, number>
  missingTypes: MemoryType[]
  totalFiles: number
} {
  const memDir = path.join(projectDir, 'memory')
  const typeCounts: Record<MemoryType, number> = { user: 0, feedback: 0, project: 0, reference: 0 }

  if (!fs.existsSync(memDir)) {
    return { hasMemoryDir: false, typeCounts, missingTypes: [...MEMORY_TYPES], totalFiles: 0 }
  }

  let totalFiles = 0
  try {
    const files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md'))
    totalFiles = files.length
    for (const f of files) {
      for (const t of MEMORY_TYPES) {
        if (f.startsWith(`${t}_`) || f === `${t}.md`) typeCounts[t]++
      }
    }
  } catch { /* ignore */ }

  const missingTypes = MEMORY_TYPES.filter((t) => typeCounts[t] === 0)
  return { hasMemoryDir: true, typeCounts, missingTypes, totalFiles }
}

export async function GET(): Promise<Response> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const slugs = getProjectSlugs(mcdDir)
  const projects: MemoryGapProject[] = []

  for (const slug of slugs) {
    const dir = getProjectDir(mcdDir, slug)
    if (!dir) continue
    const { hasMemoryDir, typeCounts, missingTypes, totalFiles } = analyzeMemoryDir(dir)
    const isActive = isActiveProject(dir)
    projects.push({
      slug,
      hasMemoryDir,
      typeCounts,
      missingTypes,
      totalFiles,
      isActive,
      gapCount: missingTypes.length + (hasMemoryDir ? 0 : 1),
    })
  }

  // Sort by gap count desc, then active first
  projects.sort((a, b) => b.gapCount - a.gapCount || (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0))

  return Response.json({
    projects,
    generatedAt: new Date().toISOString(),
  } satisfies MemoryGapsResponse)
}

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

export interface MemoryRadarProject {
  slug: string
  typeCounts: Record<MemoryType, number>
  typeWords: Record<MemoryType, number>
  totalFiles: number
  totalWords: number
}

export interface MemoryRadarResponse {
  projects: MemoryRadarProject[]
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

function analyzeMemory(projectDir: string): {
  typeCounts: Record<MemoryType, number>
  typeWords: Record<MemoryType, number>
  totalFiles: number
  totalWords: number
} {
  const typeCounts: Record<MemoryType, number> = { user: 0, feedback: 0, project: 0, reference: 0 }
  const typeWords: Record<MemoryType, number> = { user: 0, feedback: 0, project: 0, reference: 0 }
  const memDir = path.join(projectDir, 'memory')

  try {
    if (!fs.existsSync(memDir)) return { typeCounts, typeWords, totalFiles: 0, totalWords: 0 }
    const files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md'))
    let totalFiles = 0
    let totalWords = 0
    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(memDir, f), 'utf-8')
        const words = content.split(/\s+/).filter(Boolean).length
        totalFiles++
        totalWords += words
        for (const t of MEMORY_TYPES) {
          if (f.startsWith(`${t}_`) || f === `${t}.md`) {
            typeCounts[t]++
            typeWords[t] += words
          }
        }
      } catch { /* skip unreadable */ }
    }
    return { typeCounts, typeWords, totalFiles, totalWords }
  } catch {
    return { typeCounts, typeWords, totalFiles: 0, totalWords: 0 }
  }
}

export async function GET(): Promise<Response> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const slugs = getProjectSlugs(mcdDir)
  const projects: MemoryRadarProject[] = []

  for (const slug of slugs) {
    const dir = getProjectDir(mcdDir, slug)
    if (!dir) continue
    const { typeCounts, typeWords, totalFiles, totalWords } = analyzeMemory(dir)
    projects.push({ slug, typeCounts, typeWords, totalFiles, totalWords })
  }

  // Sort by total files desc, max 20
  projects.sort((a, b) => b.totalFiles - a.totalFiles)
  const top20 = projects.slice(0, 20)

  return Response.json({
    projects: top20,
    generatedAt: new Date().toISOString(),
  } satisfies MemoryRadarResponse)
}

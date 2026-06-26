import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface MemoryFileInfo {
  name: string
  ageDays: number
  wordCount: number
}

export interface MemoryAgeProject {
  slug: string
  files: MemoryFileInfo[]
  staleCount: number
}

export interface MemoryAgeResponse {
  projects: MemoryAgeProject[]
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

function getMemoryFiles(projectDir: string): MemoryFileInfo[] {
  const memDir = path.join(projectDir, 'memory')
  try {
    if (!fs.existsSync(memDir)) return []
    const now = Date.now()
    return fs.readdirSync(memDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        try {
          const fp = path.join(memDir, f)
          const stat = fs.statSync(fp)
          const content = fs.readFileSync(fp, 'utf-8')
          const wordCount = content.split(/\s+/).filter(Boolean).length
          const ageDays = Math.floor((now - stat.mtimeMs) / 86_400_000)
          return { name: f, ageDays, wordCount }
        } catch { return null }
      })
      .filter((x): x is MemoryFileInfo => x !== null)
  } catch { return [] }
}

export async function GET(): Promise<Response> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const slugs = getProjectSlugs(mcdDir)

  const projects: MemoryAgeProject[] = []
  for (const slug of slugs) {
    const dir = getProjectDir(mcdDir, slug)
    if (!dir) continue
    const files = getMemoryFiles(dir)
    const staleCount = files.filter((f) => f.ageDays > 30).length
    projects.push({ slug, files, staleCount })
  }

  // Sort by stale count desc, then total file count desc
  projects.sort((a, b) => b.staleCount - a.staleCount || b.files.length - a.files.length)

  return Response.json({
    projects,
    generatedAt: new Date().toISOString(),
  } satisfies MemoryAgeResponse)
}

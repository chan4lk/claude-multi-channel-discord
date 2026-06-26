import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface OrphanFile {
  id: string
  project: string
  file: string
  wordCount: number
  lastModifiedMs: number
  ageDays: number
  snippet: string
}

export interface MemoryOrphanReportResponse {
  orphans: OrphanFile[]
  totalFiles: number
  orphanRate: number
  projects: string[]
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

function extractLinks(content: string): string[] {
  return [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]!.trim())
}

function countWords(content: string): number {
  return content.split(/\s+/).filter(Boolean).length
}

function firstLine(content: string): string {
  const line = content.split('\n').find((l) => l.trim().length > 0 && !l.startsWith('---'))
  return (line ?? '').replace(/^#+\s*/, '').trim().slice(0, 120)
}

export async function GET(): Promise<Response> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const slugs = getProjectSlugs(mcdDir)

  interface NodeEntry {
    id: string
    project: string
    file: string
    content: string
    mtimeMs: number
    outSlugs: string[]
    slug: string
  }

  const nodes = new Map<string, NodeEntry>()

  // Pass 1: collect all memory files
  for (const project of slugs) {
    let realPath = path.join(mcdDir, 'projects', project)
    try { realPath = fs.realpathSync(realPath) } catch { continue }
    const memDir = path.join(realPath, 'memory')
    let files: string[]
    try { files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md')) } catch { continue }

    for (const file of files) {
      const filePath = path.join(memDir, file)
      let content = ''
      let mtimeMs = Date.now()
      try {
        const stat = fs.statSync(filePath)
        mtimeMs = stat.mtimeMs
        content = fs.readFileSync(filePath, 'utf-8')
      } catch { continue }

      const id = `${project}/${file}`
      const slug = file.replace(/\.md$/, '').toLowerCase()
      const outSlugs = extractLinks(content).map((l) => l.toLowerCase())
      nodes.set(id, { id, project, file, content, mtimeMs, outSlugs, slug })
    }
  }

  // Build slug → ids index
  const slugToIds = new Map<string, string[]>()
  for (const [id, node] of nodes) {
    if (!slugToIds.has(node.slug)) slugToIds.set(node.slug, [])
    slugToIds.get(node.slug)!.push(id)
  }

  // Count in-degrees and out-degrees
  const inDegree = new Map<string, number>()
  const outDegree = new Map<string, number>()
  for (const id of nodes.keys()) { inDegree.set(id, 0); outDegree.set(id, 0) }

  for (const node of nodes.values()) {
    let resolvedOut = 0
    for (const targetSlug of node.outSlugs) {
      const candidates = slugToIds.get(targetSlug) ?? []
      const sameProject = candidates.find((c) => c.startsWith(`${node.project}/`))
      const targetId = sameProject ?? candidates[0]
      if (!targetId || targetId === node.id) continue
      resolvedOut++
      inDegree.set(targetId, (inDegree.get(targetId) ?? 0) + 1)
    }
    outDegree.set(node.id, resolvedOut)
  }

  // Collect orphans: inDegree=0 AND outDegree=0
  const now = Date.now()
  const orphans: OrphanFile[] = []
  for (const [id, node] of nodes) {
    if ((inDegree.get(id) ?? 0) === 0 && (outDegree.get(id) ?? 0) === 0) {
      const ageDays = Math.floor((now - node.mtimeMs) / 86_400_000)
      orphans.push({
        id,
        project: node.project,
        file: node.file,
        wordCount: countWords(node.content),
        lastModifiedMs: node.mtimeMs,
        ageDays,
        snippet: firstLine(node.content),
      })
    }
  }

  // Sort oldest first
  orphans.sort((a, b) => a.lastModifiedMs - b.lastModifiedMs)

  const projectNames = [...new Set(orphans.map((o) => o.project))]

  return Response.json({
    orphans,
    totalFiles: nodes.size,
    orphanRate: nodes.size > 0 ? Math.round((orphans.length / nodes.size) * 1000) / 10 : 0,
    projects: projectNames,
    generatedAt: new Date().toISOString(),
  } satisfies MemoryOrphanReportResponse)
}

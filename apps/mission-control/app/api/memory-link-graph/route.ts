import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface MemoryNode {
  id: string        // "project/filename"
  slug: string      // filename without .md
  project: string
  type: string      // from frontmatter type field
  wordCount: number
  inDegree: number
  outDegree: number
}

export interface MemoryEdge {
  source: string    // id
  target: string    // id
  project: string
}

export interface MemoryLinkGraphResponse {
  nodes: MemoryNode[]
  edges: MemoryEdge[]
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

function getRealProjectPath(mcdDir: string, slug: string): string | null {
  try { return fs.realpathSync(path.join(mcdDir, 'projects', slug)) } catch { return null }
}

function extractType(content: string): string {
  const match = content.match(/^---[\s\S]*?^---/m)
  if (!match) return 'unknown'
  const typeMatch = match[0].match(/^\s*type:\s*(\S+)/m)
  return typeMatch?.[1] ?? 'unknown'
}

function extractLinks(content: string): string[] {
  const matches = [...content.matchAll(/\[\[([^\]]+)\]\]/g)]
  return matches.map((m) => m[1]!.trim())
}

function countWords(content: string): number {
  return content.split(/\s+/).filter(Boolean).length
}

export async function GET(): Promise<Response> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const slugs = getProjectSlugs(mcdDir)
  const projectNames: string[] = []
  const nodeMap = new Map<string, MemoryNode>()
  const rawEdges: { source: string; target: string; project: string; targetSlug: string }[] = []

  for (const project of slugs) {
    const realPath = getRealProjectPath(mcdDir, project)
    if (!realPath) continue
    const memDir = path.join(realPath, 'memory')
    let files: string[]
    try { files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md')) } catch { continue }
    if (files.length === 0) continue

    projectNames.push(project)

    for (const file of files) {
      const id = `${project}/${file}`
      const slug = file.replace(/\.md$/, '')
      let content = ''
      try { content = fs.readFileSync(path.join(memDir, file), 'utf-8') } catch { continue }

      const type = extractType(content)
      const wordCount = countWords(content)
      const links = extractLinks(content)

      nodeMap.set(id, {
        id,
        slug,
        project,
        type,
        wordCount,
        inDegree: 0,
        outDegree: 0,
      })

      for (const link of links) {
        rawEdges.push({ source: id, target: '', project, targetSlug: link })
      }
    }
  }

  // Resolve target slugs → node ids. Try same project first, then any project.
  const slugToIds = new Map<string, string[]>()
  for (const [id, node] of nodeMap) {
    const key = node.slug.toLowerCase()
    if (!slugToIds.has(key)) slugToIds.set(key, [])
    slugToIds.get(key)!.push(id)
  }

  const edges: MemoryEdge[] = []
  for (const raw of rawEdges) {
    const key = raw.targetSlug.toLowerCase()
    const candidates = slugToIds.get(key) ?? []
    const sameProject = candidates.find((c) => c.startsWith(`${raw.project}/`))
    const targetId = sameProject ?? candidates[0]
    if (!targetId || targetId === raw.source) continue

    edges.push({ source: raw.source, target: targetId, project: raw.project })
    const srcNode = nodeMap.get(raw.source)
    const tgtNode = nodeMap.get(targetId)
    if (srcNode) srcNode.outDegree++
    if (tgtNode) tgtNode.inDegree++
  }

  return Response.json({
    nodes: [...nodeMap.values()],
    edges,
    projects: projectNames,
    generatedAt: new Date().toISOString(),
  } satisfies MemoryLinkGraphResponse)
}

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export type BranchType = 'goal' | 'memory' | 'proposal'

export interface MindMapNode {
  id: string
  type: 'fleet' | 'project' | BranchType
  label: string
  parentId: string | null
  slug?: string
  href?: string
}

export interface MindMapLink {
  source: string
  target: string
}

export interface MindMapResponse {
  nodes: MindMapNode[]
  links: MindMapLink[]
  computedAt: string
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function readGoalText(slug: string, mcdDir: string): string | null {
  const goalPath = path.join(mcdDir, 'projects', slug, 'GOAL.md')
  try {
    const raw = fs.readFileSync(goalPath, 'utf-8').trim()
    if (!raw) return null
    const match = raw.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)
    const text = match ? match[1].trim() : raw
    return text.slice(0, 60) || null
  } catch { return null }
}

function readMemoryTitles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { /* ok */ }
  const encoded = encodeProjectCwd(realPath)
  const memoryDir = path.join(os.homedir(), '.claude', 'projects', encoded, 'memory')
  const titles: string[] = []
  try {
    const files = fs.readdirSync(memoryDir).filter((f) => f.endsWith('.md'))
    for (const f of files.slice(0, 3)) {
      try {
        const content = fs.readFileSync(path.join(memoryDir, f), 'utf-8')
        const nameMatch = content.match(/^name:\s*(.+)$/m)
        const title = nameMatch ? nameMatch[1].trim() : f.replace('.md', '')
        titles.push(title.slice(0, 24))
      } catch { /* skip */ }
    }
  } catch { /* no memory dir */ }
  return titles
}

function readProposalTitles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { /* ok */ }
  const specclaw = path.join(realPath, '.specclaw', 'changes')
  const titles: string[] = []
  try {
    const changes = fs.readdirSync(specclaw)
    for (const dir of changes.slice(0, 3)) {
      try {
        const proposalPath = path.join(specclaw, dir, 'proposal.md')
        const content = fs.readFileSync(proposalPath, 'utf-8')
        const titleMatch = content.match(/^#\s+(.+)$/m)
        const title = titleMatch ? titleMatch[1].trim() : dir
        titles.push(title.slice(0, 24))
      } catch { /* skip */ }
    }
  } catch { /* no specclaw */ }
  return titles
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const slugs = Object.values(channels?.projects ?? {})
    .map((p) => p.slug)
    .filter((s): s is string => !!s)

  const nodes: MindMapNode[] = []
  const links: MindMapLink[] = []

  // Root fleet node
  nodes.push({ id: 'fleet', type: 'fleet', label: 'FLEET', parentId: null })

  for (const slug of slugs) {
    const projectId = `project:${slug}`
    nodes.push({
      id: projectId,
      type: 'project',
      label: slug.slice(0, 24),
      parentId: 'fleet',
      slug,
      href: `/projects/${slug}`,
    })
    links.push({ source: 'fleet', target: projectId })

    // GOAL branch
    const goalText = readGoalText(slug, mcdDir)
    if (goalText) {
      const goalId = `goal:${slug}`
      nodes.push({
        id: goalId,
        type: 'goal',
        label: goalText,
        parentId: projectId,
        slug,
        href: `/goals?slug=${slug}`,
      })
      links.push({ source: projectId, target: goalId })
    }

    // MEMORY branches
    const memTitles = readMemoryTitles(slug, mcdDir)
    for (let i = 0; i < memTitles.length; i++) {
      const memId = `memory:${slug}:${i}`
      nodes.push({
        id: memId,
        type: 'memory',
        label: memTitles[i],
        parentId: projectId,
        slug,
        href: `/knowledge?slug=${slug}`,
      })
      links.push({ source: projectId, target: memId })
    }

    // PROPOSAL branches
    const propTitles = readProposalTitles(slug, mcdDir)
    for (let i = 0; i < propTitles.length; i++) {
      const propId = `proposal:${slug}:${i}`
      nodes.push({
        id: propId,
        type: 'proposal',
        label: propTitles[i],
        parentId: projectId,
        slug,
        href: `/pipeline?slug=${slug}`,
      })
      links.push({ source: projectId, target: propId })
    }
  }

  return Response.json({
    nodes,
    links,
    computedAt: new Date().toISOString(),
  } satisfies MindMapResponse)
}

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export type CellState = 'allowed-used' | 'allowed-unused' | 'implicit-used' | 'disallowed' | 'none'

export interface ProjectCapability {
  slug: string
  permissionMode: string | null
  allowedTools: string[]
  disallowedTools: string[]
  isWildcard: boolean  // permissionMode === 'bypassPermissions' or allowedTools includes '*'
  usedTools: Record<string, number>  // tool -> use count last 7d
  coverageScore: number  // distinct used / distinct allowed (0-100)
}

export interface CapabilityMapResponse {
  slugs: string[]
  tools: string[]   // sorted union
  projects: ProjectCapability[]
  generatedAt: string
}

let cache: { data: CapabilityMapResponse; ts: number } | null = null
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findJsonlFiles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return [] }
}

function scanToolUsage(slug: string, mcdDir: string): Record<string, number> {
  const cutoff = Date.now() - 7 * 24 * 3_600_000
  const files = findJsonlFiles(slug, mcdDir)
  const counts: Record<string, number> = {}

  for (const file of files) {
    try { if (fs.statSync(file).mtimeMs < cutoff) continue } catch { continue }
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let parsed: { role?: string; content?: unknown } | null = null
      try { parsed = JSON.parse(line) } catch { continue }
      if (!parsed) continue

      if (Array.isArray(parsed.content)) {
        for (const block of parsed.content as Array<{ type?: string; name?: string }>) {
          if (block.type === 'tool_use' && block.name) {
            counts[block.name] = (counts[block.name] ?? 0) + 1
          }
        }
      }
    }
  }
  return counts
}

interface ChannelProject {
  slug?: string
  claude?: {
    permissionMode?: string
    allowedTools?: string[]
    disallowedTools?: string[]
  }
}

interface ChannelsJson {
  projects?: Record<string, ChannelProject>
  defaults?: {
    claude?: {
      permissionMode?: string
      allowedTools?: string[]
      disallowedTools?: string[]
    }
  }
}

export async function GET(): Promise<Response> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return Response.json(cache.data)
  }

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channelsPath = path.join(mcdDir, 'channels.json')
  const channels = readJson<ChannelsJson>(channelsPath)

  const defaultClaude = channels?.defaults?.claude ?? {}
  const defaultAllowed = defaultClaude.allowedTools ?? []
  const defaultDisallowed = defaultClaude.disallowedTools ?? []

  const projects: ProjectCapability[] = []
  const toolUnion = new Set<string>()

  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      const slug = proj.slug
      if (!slug || slug === 'master') continue

      const claude = proj.claude ?? {}
      const allowedTools = claude.allowedTools ?? defaultAllowed
      const disallowedTools = claude.disallowedTools ?? defaultDisallowed
      const permissionMode = claude.permissionMode ?? defaultClaude.permissionMode ?? null
      const isWildcard = permissionMode === 'bypassPermissions' || allowedTools.includes('*')

      // Add to tool union
      for (const t of allowedTools) { if (t !== '*') toolUnion.add(t) }
      for (const t of disallowedTools) { toolUnion.add(t) }

      const usedTools = scanToolUsage(slug, mcdDir)
      for (const t of Object.keys(usedTools)) toolUnion.add(t)

      // Coverage: distinct tools used that are also in allowed (or wildcard)
      const usedSet = new Set(Object.keys(usedTools))
      const effectiveAllowed = isWildcard
        ? usedSet  // wildcard: all used are "allowed"
        : new Set(allowedTools.filter((t) => t !== '*'))
      const usedAndAllowed = isWildcard ? usedSet.size : [...usedSet].filter((t) => effectiveAllowed.has(t)).length
      const totalAllowed = isWildcard ? Math.max(usedSet.size, 1) : Math.max(effectiveAllowed.size, 1)
      const coverageScore = Math.round((usedAndAllowed / totalAllowed) * 100)

      projects.push({ slug, permissionMode, allowedTools, disallowedTools, isWildcard, usedTools, coverageScore })
    }
  }

  // Sort tools: most-observed first
  const toolTotals: Record<string, number> = {}
  for (const p of projects) {
    for (const [t, c] of Object.entries(p.usedTools)) {
      toolTotals[t] = (toolTotals[t] ?? 0) + c
    }
  }
  const tools = [...toolUnion].sort((a, b) => (toolTotals[b] ?? 0) - (toolTotals[a] ?? 0))

  const data: CapabilityMapResponse = {
    slugs: projects.map((p) => p.slug),
    tools,
    projects,
    generatedAt: new Date().toISOString(),
  }

  cache = { data, ts: Date.now() }
  return Response.json(data)
}

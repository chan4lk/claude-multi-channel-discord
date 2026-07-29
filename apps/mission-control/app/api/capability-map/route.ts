import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { requireSession } from '@/src/security'
import { toolCounts } from '@/src/fact-index'

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

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
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
  const unauth = await requireSession()
  if (unauth) return unauth

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channelsPath = path.join(mcdDir, 'channels.json')
  const channels = readJson<ChannelsJson>(channelsPath)

  const defaultClaude = channels?.defaults?.claude ?? {}
  const defaultAllowed = defaultClaude.allowedTools ?? []
  const defaultDisallowed = defaultClaude.disallowedTools ?? []

  // 7-day tool usage per slug from the fact index (was a transcript scan
  // behind a 1h TTL cache; the indexed query is cheap enough to run fresh).
  const cutoffMs = Date.now() - 7 * 24 * 3_600_000
  const usageBySlug = new Map<string, Record<string, number>>()
  for (const row of toolCounts({ sinceMs: cutoffMs })) {
    const counts = usageBySlug.get(row.slug) ?? {}
    counts[row.tool_name] = (counts[row.tool_name] ?? 0) + row.count
    usageBySlug.set(row.slug, counts)
  }

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

      const usedTools = usageBySlug.get(slug) ?? {}
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

  return Response.json(data)
}

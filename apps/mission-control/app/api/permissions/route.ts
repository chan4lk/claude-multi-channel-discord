import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export type PermissionCell = 'allowed' | 'disallowed' | 'default' | 'bypass'

export interface ProjectPermissions {
  slug: string
  permissionMode: string | null
  allowedTools: string[]
  disallowedTools: string[]
  isWildcardAllow: boolean
  isBypass: boolean
}

export interface PermissionsResponse {
  projects: ProjectPermissions[]
  allTools: string[]     // union of all named tools across fleet
  defaults: {
    permissionMode: string | null
    allowedTools: string[]
    disallowedTools: string[]
  }
  generatedAt: string
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

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function normalizeTools(tools: string[] | undefined): string[] {
  return (tools ?? []).filter((t) => typeof t === 'string' && t.length > 0)
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ projects: [], allTools: [], defaults: { permissionMode: null, allowedTools: [], disallowedTools: [] }, generatedAt: new Date().toISOString() } satisfies PermissionsResponse)
  }

  const channels = readJson<ChannelsJson>(path.join(mcdDir, 'channels.json'))

  const defaultClaude = channels?.defaults?.claude ?? {}
  const defaults = {
    permissionMode: defaultClaude.permissionMode ?? null,
    allowedTools: normalizeTools(defaultClaude.allowedTools),
    disallowedTools: normalizeTools(defaultClaude.disallowedTools),
  }

  const projects: ProjectPermissions[] = []
  const toolSet = new Set<string>([...defaults.allowedTools, ...defaults.disallowedTools])

  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      const slug = proj.slug
      if (!slug) continue

      const claude = proj.claude ?? {}
      const allowedTools = normalizeTools(claude.allowedTools)
      const disallowedTools = normalizeTools(claude.disallowedTools)
      const permissionMode = claude.permissionMode ?? null

      for (const t of allowedTools) toolSet.add(t)
      for (const t of disallowedTools) toolSet.add(t)

      projects.push({
        slug,
        permissionMode,
        allowedTools,
        disallowedTools,
        isWildcardAllow: allowedTools.includes('*'),
        isBypass: permissionMode === 'bypassPermissions' || permissionMode === 'bypass',
      })
    }
  }

  // Sort tools alphabetically, wildcards first
  const allTools = [...toolSet].sort((a, b) => {
    if (a === '*') return -1
    if (b === '*') return 1
    return a.localeCompare(b)
  })

  projects.sort((a, b) => {
    // Risky first
    const riskA = (a.isBypass ? 2 : 0) + (a.isWildcardAllow ? 1 : 0)
    const riskB = (b.isBypass ? 2 : 0) + (b.isWildcardAllow ? 1 : 0)
    if (riskB !== riskA) return riskB - riskA
    return a.slug.localeCompare(b.slug)
  })

  return Response.json({ projects, allTools, defaults, generatedAt: new Date().toISOString() } satisfies PermissionsResponse)
}

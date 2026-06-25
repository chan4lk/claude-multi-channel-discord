import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export type LifecycleStage = 'spawned' | 'contacted' | 'active' | 'drifting' | 'retired'

export interface LifecycleProject {
  slug: string
  stage: LifecycleStage
  lastMessageTs?: string
  firstMessageTs?: string
  firstToolCallTs?: string
  createdTs?: string
}

export interface StageInfo {
  name: LifecycleStage
  label: string
  count: number
  projects: LifecycleProject[]
  color: string
}

export interface LifecycleFunnelResponse {
  stages: StageInfo[]
  medianActivationMinutes: number | null
  medianFirstToolCallMinutes: number | null
  generatedAt: string
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function findJsonlFiles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = realPath.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(transcriptDir, f))
  } catch { return [] }
}

interface ParsedEvents {
  firstUserMessageTs?: string
  firstToolCallTs?: string
  lastUserMessageTs?: string
}

function parseProjectEvents(slug: string, mcdDir: string): ParsedEvents {
  const files = findJsonlFiles(slug, mcdDir)
  let firstUserTs: string | undefined
  let firstToolTs: string | undefined
  let lastUserTs: string | undefined

  for (const file of files) {
    let lines: string[]
    try { lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean) } catch { continue }
    for (const raw of lines) {
      let rec: { type?: string; timestamp?: string; message?: { role?: string; content?: Array<{ type?: string }> } }
      try { rec = JSON.parse(raw) } catch { continue }

      const ts = rec.timestamp
      if (!ts) continue
      const role = rec.message?.role
      const content = rec.message?.content ?? []

      if (role === 'user' && content.length > 0 && content[0]?.type !== 'tool_result') {
        if (!firstUserTs || ts < firstUserTs) firstUserTs = ts
        if (!lastUserTs || ts > lastUserTs) lastUserTs = ts
      }

      if (role === 'assistant' && content.some(c => c.type === 'tool_use')) {
        if (!firstToolTs || ts < firstToolTs) firstToolTs = ts
      }
    }
  }

  return { firstUserMessageTs: firstUserTs, firstToolCallTs: firstToolTs, lastUserMessageTs: lastUserTs }
}

function getDirCreationTs(dirPath: string): string | undefined {
  try {
    const stat = fs.statSync(dirPath)
    // Use birthtime if available, else ctime
    const t = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.ctimeMs
    return new Date(t).toISOString()
  } catch { return undefined }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2
}

const STAGE_META: Record<LifecycleStage, { label: string; color: string }> = {
  spawned: { label: 'Spawned', color: '#64748B' },
  contacted: { label: 'Contacted', color: '#22D3EE' },
  active: { label: 'Active', color: '#4ADE80' },
  drifting: { label: 'Drifting', color: '#F59E0B' },
  retired: { label: 'Retired', color: '#475569' },
}

const STAGE_ORDER: LifecycleStage[] = ['spawned', 'contacted', 'active', 'drifting', 'retired']

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const allSlugs: string[] = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug) allSlugs.push(proj.slug)
    }
  }

  // Retired projects from archive dir
  const archiveDir = path.join(mcdDir, 'projects', '.archive')
  const retiredSlugs: string[] = []
  try {
    retiredSlugs.push(
      ...fs.readdirSync(archiveDir)
        .filter(d => fs.statSync(path.join(archiveDir, d)).isDirectory())
        .map(d => d.replace(/-\d+$/, ''))
    )
  } catch {}

  const retiredSet = new Set(retiredSlugs)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString()

  const projectInfos: LifecycleProject[] = []
  const activationMinutes: number[] = []
  const firstToolMinutes: number[] = []

  for (const slug of allSlugs) {
    const projectDir = path.join(mcdDir, 'projects', slug)
    const createdTs = getDirCreationTs(projectDir)

    if (retiredSet.has(slug)) {
      projectInfos.push({ slug, stage: 'retired', createdTs })
      continue
    }

    const events = parseProjectEvents(slug, mcdDir)
    const { firstUserMessageTs, firstToolCallTs, lastUserMessageTs } = events

    // Compute stage
    let stage: LifecycleStage
    if (!firstUserMessageTs) {
      stage = 'spawned'
    } else if (!firstToolCallTs) {
      stage = 'contacted'
    } else if (lastUserMessageTs && lastUserMessageTs < sevenDaysAgo) {
      stage = 'drifting'
    } else {
      stage = 'active'
    }

    projectInfos.push({
      slug,
      stage,
      createdTs,
      firstMessageTs: firstUserMessageTs,
      firstToolCallTs,
      lastMessageTs: lastUserMessageTs,
    })

    // Activation: created → first user message
    if (createdTs && firstUserMessageTs) {
      const mins = (Date.parse(firstUserMessageTs) - Date.parse(createdTs)) / 60_000
      if (mins >= 0 && mins < 525_600) activationMinutes.push(mins)
    }

    // First tool call: first message → first tool call
    if (firstUserMessageTs && firstToolCallTs) {
      const mins = (Date.parse(firstToolCallTs) - Date.parse(firstUserMessageTs)) / 60_000
      if (mins >= 0 && mins < 525_600) firstToolMinutes.push(mins)
    }
  }

  // Build stage buckets
  const buckets = new Map<LifecycleStage, LifecycleProject[]>()
  for (const stage of STAGE_ORDER) buckets.set(stage, [])
  for (const p of projectInfos) {
    buckets.get(p.stage)!.push(p)
  }

  const stages: StageInfo[] = STAGE_ORDER.map(stage => ({
    name: stage,
    label: STAGE_META[stage].label,
    color: STAGE_META[stage].color,
    count: buckets.get(stage)!.length,
    projects: buckets.get(stage)!,
  }))

  return Response.json({
    stages,
    medianActivationMinutes: median(activationMinutes),
    medianFirstToolCallMinutes: median(firstToolMinutes),
    generatedAt: new Date().toISOString(),
  } satisfies LifecycleFunnelResponse)
}

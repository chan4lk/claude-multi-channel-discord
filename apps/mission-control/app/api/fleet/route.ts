import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export type ProjectState = 'idle' | 'active' | 'stalled' | 'autonomous'

export interface FleetProject {
  slug: string
  state: ProjectState
  ageMins: number
  lastReplyMs: number | null
  stuckThresholdMinutes: number
}

export interface FleetResponse {
  idle: number
  active: number
  stalled: number
  autonomous: number
  projects: FleetProject[]
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function getTranscriptMtime(slug: string, mcdDir: string): number | null {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try {
    realPath = fs.realpathSync(projectPath)
  } catch {
    return null
  }

  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)

  let jsonlFiles: string[] = []
  try {
    jsonlFiles = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return null
  }

  if (jsonlFiles.length === 0) return null

  let latestMtime = 0
  for (const file of jsonlFiles) {
    try {
      const mtime = fs.statSync(path.join(transcriptDir, file)).mtimeMs
      if (mtime > latestMtime) latestMtime = mtime
    } catch {}
  }

  return latestMtime || null
}

function classifyState(slug: string, mcdDir: string, scheduledSlugs: Set<string>, stuckThresholdMinutes: number): FleetProject {
  const mtime = getTranscriptMtime(slug, mcdDir)
  const ageMs = mtime ? Date.now() - mtime : Infinity
  const ageMins = Math.min(Math.floor(ageMs / 60_000), 9999)
  const hasSchedule = scheduledSlugs.has(slug)

  let state: ProjectState
  if (ageMs < 30_000) {
    state = 'active'
  } else if (ageMs < 5 * 60_000) {
    // Recently finished — treat as idle (or autonomous if scheduled)
    state = hasSchedule ? 'autonomous' : 'idle'
  } else if (ageMs < 2 * 60 * 60_000) {
    // 5min–2h: stalled window
    state = hasSchedule ? 'autonomous' : 'stalled'
  } else {
    // Very old or no transcript
    state = hasSchedule ? 'autonomous' : 'idle'
  }

  return { slug, state, ageMins, lastReplyMs: mtime, stuckThresholdMinutes }
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ idle: 0, active: 0, stalled: 0, autonomous: 0, projects: [] } satisfies FleetResponse)
  }

  const channels = readJson<{ projects?: Record<string, { slug?: string; stuckThresholdMinutes?: number }> }>(
    path.join(mcdDir, 'channels.json')
  )
  const schedules = readJson<{ schedules?: Array<{ chatId?: string; enabled?: boolean }> }>(
    path.join(mcdDir, 'schedules.json')
  )

  const chatIdToSlug = new Map<string, string>()
  const projectSlugs: string[] = []
  const slugToStuck = new Map<string, number>()
  if (channels?.projects) {
    for (const [chatId, proj] of Object.entries(channels.projects)) {
      if (proj.slug) {
        chatIdToSlug.set(chatId, proj.slug)
        projectSlugs.push(proj.slug)
        if (proj.stuckThresholdMinutes) {
          slugToStuck.set(proj.slug, proj.stuckThresholdMinutes)
        }
      }
    }
  }

  const scheduledSlugs = new Set<string>()
  for (const s of schedules?.schedules ?? []) {
    if (s.enabled !== false && s.chatId) {
      const slug = chatIdToSlug.get(s.chatId)
      if (slug) scheduledSlugs.add(slug)
    }
  }

  const projects: FleetProject[] = projectSlugs.map((slug) =>
    classifyState(slug, mcdDir, scheduledSlugs, slugToStuck.get(slug) ?? 5)
  )

  const counts = { idle: 0, active: 0, stalled: 0, autonomous: 0 }
  for (const p of projects) counts[p.state]++

  return Response.json({ ...counts, projects } satisfies FleetResponse)
}

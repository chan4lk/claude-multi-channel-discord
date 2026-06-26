import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { scoreProject } from '../../../lib/attention'
import type { FleetProject } from '../fleet/route'

export const dynamic = 'force-dynamic'

export interface GravityProject {
  slug: string
  attentionScore: number // 0-100
  state: 'active' | 'idle' | 'stuck' | 'circuit-open'
  platform: string
  queuedCount: number
  factors: { key: string; label: string; score: number; color: string }[]
  reason: string
}

export interface AttentionGravityResponse {
  projects: GravityProject[]
  generatedAt: string
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

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ projects: [], generatedAt: new Date().toISOString() } satisfies AttentionGravityResponse)
  }

  const channels = readJson<{
    projects?: Record<string, {
      slug?: string
      platform?: string
      stuckThresholdMinutes?: number
      monthlyTokenBudget?: number
    }>
    defaults?: { stuckThresholdMinutes?: number }
  }>(path.join(mcdDir, 'channels.json'))

  const circuitState = readJson<Record<string, { circuitOpen: boolean; slug: string; ts: string }>>(
    path.join(mcdDir, 'circuit-state.json')
  ) ?? {}

  const budgetQueueState = readJson<Record<string, { slug: string; count: number; updatedAt: string }>>(
    path.join(mcdDir, 'budget-queue-state.json')
  ) ?? {}

  const defaultThreshold = channels?.defaults?.stuckThresholdMinutes ?? 5

  const gravityProjects: GravityProject[] = []

  if (channels?.projects) {
    for (const [chatId, proj] of Object.entries(channels.projects)) {
      if (!proj.slug) continue

      const slug = proj.slug
      const stuckThresholdMinutes = proj.stuckThresholdMinutes ?? defaultThreshold
      const platform = proj.platform ?? 'discord'

      const mtime = getTranscriptMtime(slug, mcdDir)
      const ageMs = mtime ? Date.now() - mtime : Infinity
      const ageMins = Math.min(Math.floor(ageMs / 60_000), 9999)

      // Determine state
      let state: 'active' | 'idle' | 'stuck'
      if (ageMins < 2) {
        state = 'active'
      } else if (ageMins > stuckThresholdMinutes) {
        state = 'stuck'
      } else {
        state = 'idle'
      }

      // Circuit breaker check (auto-expire after 10 min)
      const circuit = circuitState[chatId]
      const circuitOpen = !!(circuit?.circuitOpen && (Date.now() - new Date(circuit.ts).getTime() < 10 * 60_000))

      // Queue count
      let queuedCount = 0
      const queueEntry = budgetQueueState[chatId]
      if (queueEntry?.count) queuedCount = queueEntry.count

      // Build minimal FleetProject for scoreProject()
      const fp: FleetProject = {
        slug,
        state: state === 'stuck' ? 'stalled' : state === 'active' ? 'active' : 'idle',
        ageMins,
        stuckThresholdMinutes,
        platform,
        queuedCount,
        circuitOpen,
        monthlyTokenBudget: proj.monthlyTokenBudget,
      }

      const scored = scoreProject(fp)

      const finalState: GravityProject['state'] = circuitOpen ? 'circuit-open' : state

      gravityProjects.push({
        slug,
        attentionScore: Math.round(scored.total),
        state: finalState,
        platform,
        queuedCount,
        factors: scored.factors.map((f) => ({
          key: f.key,
          label: f.label,
          score: Math.round(f.score * 100),
          color: f.color,
        })),
        reason: scored.reason,
      })
    }
  }

  // Sort by attention score descending
  gravityProjects.sort((a, b) => b.attentionScore - a.attentionScore)

  return Response.json({
    projects: gravityProjects,
    generatedAt: new Date().toISOString(),
  } satisfies AttentionGravityResponse)
}

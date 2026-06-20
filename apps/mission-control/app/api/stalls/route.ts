import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface StallEntry {
  slug: string
  stallAgeMins: number
  stallReason: string
  snippet: string | null
}

export interface StallsResponse {
  stalls: StallEntry[]
  checkedAt: string
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

interface TranscriptInfo {
  mtime: number | null
  latestFile: string | null
}

function getTranscriptInfo(slug: string, mcdDir: string): TranscriptInfo {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try {
    realPath = fs.realpathSync(projectPath)
  } catch {
    return { mtime: null, latestFile: null }
  }

  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)

  let jsonlFiles: string[] = []
  try {
    jsonlFiles = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return { mtime: null, latestFile: null }
  }

  if (jsonlFiles.length === 0) return { mtime: null, latestFile: null }

  let latestFile = ''
  let latestMtime = 0
  for (const file of jsonlFiles) {
    try {
      const mtime = fs.statSync(path.join(transcriptDir, file)).mtimeMs
      if (mtime > latestMtime) {
        latestMtime = mtime
        latestFile = path.join(transcriptDir, file)
      }
    } catch {}
  }

  return { mtime: latestMtime || null, latestFile: latestFile || null }
}

function extractSnippet(transcriptFile: string): string | null {
  try {
    const content = fs.readFileSync(transcriptFile, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean).reverse()
    for (const line of lines.slice(0, 50)) {
      try {
        const entry = JSON.parse(line)
        if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
          for (const block of entry.message.content) {
            if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
              return block.text.slice(0, 200).trim()
            }
          }
        }
      } catch {}
    }
  } catch {}
  return null
}

function stallReason(ageMins: number): string {
  if (ageMins > 60) return `Inactive ${ageMins}m — likely waiting for operator input`
  if (ageMins > 30) return `Inactive ${ageMins}m — may be blocked on a question`
  return `Inactive ${ageMins}m — possible stall or slow tool call`
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ stalls: [], checkedAt: new Date().toISOString() } satisfies StallsResponse)
  }

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )
  const schedules = readJson<{ schedules?: Array<{ chatId?: string; enabled?: boolean }> }>(
    path.join(mcdDir, 'schedules.json')
  )

  const chatIdToSlug = new Map<string, string>()
  const projectSlugs: string[] = []
  if (channels?.projects) {
    for (const [chatId, proj] of Object.entries(channels.projects)) {
      if (proj.slug) {
        chatIdToSlug.set(chatId, proj.slug)
        projectSlugs.push(proj.slug)
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

  const stalls: StallEntry[] = []

  for (const slug of projectSlugs) {
    if (slug === 'master') continue
    const { mtime, latestFile } = getTranscriptInfo(slug, mcdDir)
    if (!mtime) continue

    const ageMs = Date.now() - mtime
    const ageMins = Math.floor(ageMs / 60_000)

    // Stalled window: 5min–2h, not scheduled (scheduled channels are 'autonomous')
    if (ageMs >= 5 * 60_000 && ageMs < 2 * 60 * 60_000 && !scheduledSlugs.has(slug)) {
      const snippet = latestFile ? extractSnippet(latestFile) : null
      stalls.push({ slug, stallAgeMins: ageMins, stallReason: stallReason(ageMins), snippet })
    }
  }

  stalls.sort((a, b) => b.stallAgeMins - a.stallAgeMins)

  return Response.json({ stalls, checkedAt: new Date().toISOString() } satisfies StallsResponse)
}

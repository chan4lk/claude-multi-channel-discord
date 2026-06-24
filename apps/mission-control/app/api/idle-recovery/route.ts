import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface IdleRecoveryEvent {
  slug: string
  ts: string           // ISO timestamp of the reactivation user message
  date: string         // YYYY-MM-DD
  gapHours: number     // idle gap before this reactivation (float, >= 2)
  firstTurnQuality: number // score 0-100
  toolCount: number
  resumed: boolean
}

export interface IdleRecoveryResponse {
  events: IdleRecoveryEvent[]
  windowDays: number
  generatedAt: string
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((c) => c.type === 'text').map((c) => c.text ?? '').join(' ')
  }
  return ''
}

function countToolCalls(content: unknown): number {
  if (!Array.isArray(content)) return 0
  return (content as Array<{ type?: string }>).filter((c) => c.type === 'tool_use').length
}

const ERROR_PATTERNS = /\b(error|failed|exception|undefined|null is not|cannot read|traceback)\b/i

interface JsonlLine {
  role?: string
  content?: unknown
  timestamp?: string
}

function findJsonlFiles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = realPath.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return [] }
}

function scoreFirstTurn(assistantMsg: JsonlLine): { score: number; toolCount: number } {
  const text = extractText(assistantMsg.content)
  const toolCallCount = countToolCalls(assistantMsg.content)
  const hasError = ERROR_PATTERNS.test(text)

  const lenScore = Math.min(text.length / 500, 1)
  const toolScore = Math.min(toolCallCount / 3, 1)
  const errorPenalty = hasError ? 0 : 1
  const score = Math.round((0.4 * lenScore + 0.3 * toolScore + 0.3 * errorPenalty) * 100)
  return { score, toolCount: toolCallCount }
}

function computeRecoveryEvents(slug: string, mcdDir: string, windowMs: number, resumed: boolean): IdleRecoveryEvent[] {
  const cutoff = Date.now() - windowMs
  const files = findJsonlFiles(slug, mcdDir)
  const events: IdleRecoveryEvent[] = []

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }

    const lines: JsonlLine[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try { lines.push(JSON.parse(line) as JsonlLine) } catch { continue }
    }

    // Find consecutive user messages with gap >= 2h
    let lastUserTs: number | null = null
    for (let i = 0; i < lines.length; i++) {
      const msg = lines[i]
      if (!msg.timestamp) continue
      const msgTs = new Date(msg.timestamp).getTime()

      if (msg.role === 'user') {
        if (lastUserTs !== null) {
          const gapMs = msgTs - lastUserTs
          const gapHours = gapMs / 3_600_000

          if (gapHours >= 2 && msgTs >= cutoff) {
            // Find next assistant message
            let assistantMsg: JsonlLine | null = null
            for (let j = i + 1; j < lines.length; j++) {
              if (lines[j].role === 'assistant') {
                assistantMsg = lines[j]
                break
              }
            }

            if (assistantMsg) {
              const { score, toolCount } = scoreFirstTurn(assistantMsg)
              events.push({
                slug,
                ts: msg.timestamp,
                date: msg.timestamp.slice(0, 10),
                gapHours: Math.round(gapHours * 10) / 10,
                firstTurnQuality: score,
                toolCount,
                resumed,
              })
            }
          }
        }
        lastUserTs = msgTs
      }
    }
  }

  return events
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const windowDays = Math.max(1, Math.min(365, parseInt(url.searchParams.get('window') ?? '90', 10)))
  const windowMs = windowDays * 24 * 3_600_000

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channelsPath = path.join(mcdDir, 'channels.json')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(channelsPath)
  const slugs: string[] = []

  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug && proj.slug !== 'master') slugs.push(proj.slug)
    }
  }

  const allEvents: IdleRecoveryEvent[] = []

  for (const slug of slugs) {
    const sessionIdPath = path.join(mcdDir, 'projects', slug, '.session-id')
    const resumed = fs.existsSync(sessionIdPath)
    const events = computeRecoveryEvents(slug, mcdDir, windowMs, resumed)
    allEvents.push(...events)
  }

  // Sort by ts descending, cap at 500
  allEvents.sort((a, b) => b.ts.localeCompare(a.ts))
  const trimmed = allEvents.slice(0, 500)

  return Response.json({
    events: trimmed,
    windowDays,
    generatedAt: new Date().toISOString(),
  } satisfies IdleRecoveryResponse)
}

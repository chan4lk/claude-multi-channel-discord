import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface ThoughtEntry {
  slug: string
  thinkingText: string
  ts: string
  inFlight: boolean
}

export interface ThoughtStreamResponse {
  entries: ThoughtEntry[]
  generatedAt: string
}

interface ContentBlock {
  type?: string
  thinking?: string
}

interface JsonlLine {
  timestamp?: string
  message?: {
    role?: string
    content?: ContentBlock[] | string
  }
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function findActiveJsonlFile(slug: string, mcdDir: string): string | null {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return null }
  const encoded = realPath.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  let files: string[]
  try {
    files = fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return null }
  if (files.length === 0) return null
  // Most recently modified file = active session
  let latest = files[0]!
  let latestMtime = 0
  for (const f of files) {
    try {
      const mtime = fs.statSync(f).mtimeMs
      if (mtime > latestMtime) { latestMtime = mtime; latest = f }
    } catch { /* skip */ }
  }
  return latest
}

function extractLatestThinking(jsonlPath: string): { thinkingText: string; ts: string; inFlight: boolean } | null {
  let lines: string[]
  try { lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean) } catch { return null }

  let lastThinkingText: string | null = null
  let lastThinkingTs: string | null = null
  let seenAssistantReplyAfterThinking = false

  for (const raw of lines) {
    let line: JsonlLine
    try { line = JSON.parse(raw) } catch { continue }
    const role = line.message?.role
    const content = line.message?.content

    if (role === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'thinking' && block.thinking) {
          lastThinkingText = block.thinking
          lastThinkingTs = line.timestamp ?? null
          seenAssistantReplyAfterThinking = false
        }
        // Text block after thinking = reply produced = turn complete
        if (block.type === 'text' && lastThinkingText) {
          seenAssistantReplyAfterThinking = true
        }
      }
    }
    // Tool result means turn is still in flight (model is processing results)
    if (role === 'user' && Array.isArray(content)) {
      const hasToolResult = content.some((b) => b.type === 'tool_result')
      if (hasToolResult && lastThinkingText) {
        seenAssistantReplyAfterThinking = false
      }
    }
  }

  if (!lastThinkingText || !lastThinkingTs) return null

  return {
    thinkingText: lastThinkingText,
    ts: lastThinkingTs,
    inFlight: !seenAssistantReplyAfterThinking,
  }
}

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

  const entries: ThoughtEntry[] = []
  const STALE_MS = 5 * 60_000 // thoughts older than 5min are not surfaced

  for (const slug of allSlugs) {
    const jsonlPath = findActiveJsonlFile(slug, mcdDir)
    if (!jsonlPath) continue
    const result = extractLatestThinking(jsonlPath)
    if (!result) continue
    const ageMs = Date.now() - Date.parse(result.ts)
    if (ageMs > STALE_MS && !result.inFlight) continue
    entries.push({
      slug,
      thinkingText: result.thinkingText,
      ts: result.ts,
      inFlight: result.inFlight,
    })
  }

  // Sort: in-flight first, then by ts desc
  entries.sort((a, b) => {
    if (a.inFlight !== b.inFlight) return a.inFlight ? -1 : 1
    return b.ts.localeCompare(a.ts)
  })

  return Response.json({ entries, generatedAt: new Date().toISOString() } satisfies ThoughtStreamResponse)
}

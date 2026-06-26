import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export type ReplayEventType = 'user' | 'tool_use' | 'tool_result' | 'reply' | 'agent_span'

export interface ReplayEvent {
  id: string
  ts: number
  endTs: number | null
  type: ReplayEventType
  label: string
  durationMs: number | null
  parentId: string | null
  content: string
  status: 'ok' | 'error' | null
}

export interface SessionInfo {
  sessionId: string
  file: string
  startTs: number
  endTs: number
  turns: number
}

export interface SessionReplayResponse {
  slug: string
  sessionId: string
  sessionFile: string
  events: ReplayEvent[]
  sessions: SessionInfo[]
  startTs: number
  endTs: number
  checkedAt: string
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function transcriptDir(slug: string, mcdDir: string): string | null {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return null }
  return path.join(os.homedir(), '.claude', 'projects', encodeProjectCwd(realPath))
}

function listJsonlFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(dir, f))
      .sort()
  } catch { return [] }
}

function readJson(line: string): Record<string, unknown> | null {
  try { return JSON.parse(line) as Record<string, unknown> } catch { return null }
}

function truncate(s: string, max: number): string {
  if (!s) return ''
  return s.length <= max ? s : s.slice(0, max) + '…'
}

function parseEvents(filePath: string): ReplayEvent[] {
  const events: ReplayEvent[] = []
  let lines: string[] = []
  try {
    lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean)
  } catch { return [] }

  // Track pending tool_uses to compute duration when result arrives
  const pendingTools = new Map<string, { idx: number; startTs: number }>()

  for (const line of lines) {
    const obj = readJson(line)
    if (!obj) continue

    const tsRaw = obj.timestamp as string | undefined
    const ts = tsRaw ? new Date(tsRaw).getTime() : 0
    if (!ts) continue

    const type = obj.type as string

    if (type === 'user') {
      const msgContent = obj.message as { role?: string; content?: unknown } | undefined
      const contentArr = msgContent?.content
      let text = ''
      if (Array.isArray(contentArr)) {
        for (const block of contentArr) {
          const b = block as { type?: string; text?: string }
          if (b.type === 'text') text += b.text ?? ''
        }
      } else if (typeof msgContent?.content === 'string') {
        text = msgContent.content
      }
      if (!text) continue
      const id = `user-${ts}-${events.length}`
      events.push({
        id,
        ts,
        endTs: null,
        type: 'user',
        label: truncate(text.replace(/\n/g, ' '), 80),
        durationMs: null,
        parentId: null,
        content: truncate(text, 1000),
        status: null,
      })
    } else if (type === 'assistant') {
      const msgContent = obj.message as { content?: unknown } | undefined
      const contentArr = msgContent?.content
      if (!Array.isArray(contentArr)) continue
      for (const block of contentArr) {
        const b = block as { type?: string; text?: string; id?: string; name?: string; input?: unknown }
        if (b.type === 'text' && b.text) {
          const id = `reply-${ts}-${events.length}`
          events.push({
            id,
            ts,
            endTs: null,
            type: 'reply',
            label: truncate(b.text.replace(/\n/g, ' '), 80),
            durationMs: null,
            parentId: null,
            content: truncate(b.text, 1500),
            status: null,
          })
        } else if (b.type === 'tool_use' && b.id) {
          const id = `tool_use-${b.id}`
          const inputStr = b.input ? truncate(JSON.stringify(b.input), 400) : ''
          events.push({
            id,
            ts,
            endTs: null,
            type: 'tool_use',
            label: `${b.name ?? 'tool'}(${inputStr.slice(0, 40)})`,
            durationMs: null,
            parentId: null,
            content: `Tool: ${b.name}\nInput: ${inputStr}`,
            status: null,
          })
          pendingTools.set(b.id, { idx: events.length - 1, startTs: ts })
        }
      }
    } else if (type === 'tool_result') {
      const toolUseId = obj.tool_use_id as string | undefined
      const contentRaw = obj.content as unknown
      let resultText = ''
      if (Array.isArray(contentRaw)) {
        for (const block of contentRaw) {
          const b = block as { type?: string; text?: string }
          if (b.type === 'text') resultText += b.text ?? ''
        }
      } else if (typeof contentRaw === 'string') {
        resultText = contentRaw
      }
      const isError = !!(obj.is_error as boolean | undefined)

      if (toolUseId && pendingTools.has(toolUseId)) {
        const { idx, startTs } = pendingTools.get(toolUseId)!
        const dur = ts - startTs
        events[idx].endTs = ts
        events[idx].durationMs = dur > 0 ? dur : null
        events[idx].status = isError ? 'error' : 'ok'
        pendingTools.delete(toolUseId)

        const id = `tool_result-${toolUseId}`
        events.push({
          id,
          ts,
          endTs: null,
          type: 'tool_result',
          label: isError ? `error: ${truncate(resultText, 60)}` : truncate(resultText.replace(/\n/g, ' '), 60),
          durationMs: null,
          parentId: `tool_use-${toolUseId}`,
          content: truncate(resultText, 1500),
          status: isError ? 'error' : 'ok',
        })
      }
    }
  }

  return events.sort((a, b) => a.ts - b.ts)
}

function getSessionInfo(filePath: string): SessionInfo | null {
  const basename = path.basename(filePath, '.jsonl')
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean)
    let startTs = 0, endTs = 0, turns = 0
    for (const line of lines) {
      const obj = readJson(line)
      if (!obj?.timestamp) continue
      const ms = new Date(obj.timestamp as string).getTime()
      if (!startTs || ms < startTs) startTs = ms
      if (ms > endTs) endTs = ms
      if ((obj.type as string) === 'assistant') turns++
    }
    if (!startTs) return null
    return { sessionId: basename, file: basename, startTs, endTs: endTs || startTs, turns }
  } catch { return null }
}

export async function GET(req: NextRequest): Promise<Response> {
  const sp = req.nextUrl.searchParams
  const slug = sp.get('slug') ?? ''
  const sessionId = sp.get('sessionId') ?? ''

  if (!slug) return Response.json({ error: 'slug required' }, { status: 400 })

  const mcdDir = process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const dir = transcriptDir(slug, mcdDir)
  if (!dir) return Response.json({ error: 'project not found' }, { status: 404 })

  const allFiles = listJsonlFiles(dir)
  const sessions: SessionInfo[] = allFiles
    .map((f) => getSessionInfo(f))
    .filter((s): s is SessionInfo => s !== null)
    .sort((a, b) => b.startTs - a.startTs)

  // Pick target file
  let targetFile = allFiles[allFiles.length - 1] ?? ''
  if (sessionId) {
    const match = allFiles.find((f) => path.basename(f, '.jsonl') === sessionId)
    if (match) targetFile = match
  }

  if (!targetFile) {
    return Response.json({
      slug,
      sessionId: '',
      sessionFile: '',
      events: [],
      sessions,
      startTs: 0,
      endTs: 0,
      checkedAt: new Date().toISOString(),
    } satisfies SessionReplayResponse)
  }

  const events = parseEvents(targetFile)
  const startTs = events[0]?.ts ?? 0
  const endTs = events[events.length - 1]?.ts ?? startTs

  return Response.json({
    slug,
    sessionId: path.basename(targetFile, '.jsonl'),
    sessionFile: path.basename(targetFile),
    events,
    sessions,
    startTs,
    endTs,
    checkedAt: new Date().toISOString(),
  } satisfies SessionReplayResponse)
}

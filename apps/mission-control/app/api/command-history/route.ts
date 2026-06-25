import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface CommandHistoryEntry {
  ts: string
  user: string
  userId: string
  platform: string
  text: string
  responseSnippet: string
}

export interface CommandHistoryResponse {
  entries: CommandHistoryEntry[]
  total: number
  users: string[]
  generatedAt: string
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function getMasterJsonlFiles(mcdDir: string): string[] {
  const masterPath = path.join(mcdDir, 'projects', 'master')
  let realPath = masterPath
  try { realPath = fs.realpathSync(masterPath) } catch { return [] }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(transcriptDir, f))
  } catch { return [] }
}

interface RawEntry {
  type?: string
  uuid?: string
  timestamp?: string
  message?: {
    role?: string
    content?: unknown
  }
}

function extractChannelMsg(content: unknown): { ts: string; user: string; userId: string; platform: string; text: string } | null {
  if (typeof content !== 'string') return null
  const m = content.match(/<channel\s+source="([^"]+)"\s+chat_id="[^"]*"\s+message_id="[^"]*"\s+user="([^"]*)"\s+user_id="([^"]*)"\s+ts="([^"]*)"[^>]*>([\s\S]*?)<\/channel>/)
  if (!m) return null
  return {
    platform: m[1],
    user: m[2],
    userId: m[3],
    ts: m[4],
    text: m[5].trim(),
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 365)
  const userFilter = url.searchParams.get('user') ?? ''
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const files = getMasterJsonlFiles(mcdDir)
  const generatedAt = new Date().toISOString()

  // Map uuid -> next assistant text (for response snippet)
  const uuidToResponseSnippet = new Map<string, string>()
  const allEntries: RawEntry[] = []

  for (const filePath of files) {
    let raw = ''
    try { raw = fs.readFileSync(filePath, 'utf-8') } catch { continue }
    const lines = raw.split('\n').filter(Boolean)
    for (const line of lines) {
      try { allEntries.push(JSON.parse(line) as RawEntry) } catch { continue }
    }
  }

  // Build uuid→response map: find assistant messages following user messages
  const uuidToEntry = new Map<string, RawEntry>()
  for (const e of allEntries) {
    if (e.uuid) uuidToEntry.set(e.uuid, e)
  }

  // For each assistant entry, find its parent user entry and map to snippet
  for (const e of allEntries) {
    if (e.type !== 'assistant') continue
    const content = e.message?.content
    if (!Array.isArray(content)) continue
    const textBlock = content.find((c: unknown) => typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'text')
    if (!textBlock) continue
    const text = (textBlock as Record<string, unknown>).text as string | undefined
    if (!text) continue
    const parentUuid = (e as Record<string, unknown>).parentUuid as string | undefined
    if (parentUuid && !uuidToResponseSnippet.has(parentUuid)) {
      uuidToResponseSnippet.set(parentUuid, text.slice(0, 200))
    }
  }

  const entries: CommandHistoryEntry[] = []
  const userSet = new Set<string>()

  for (const e of allEntries) {
    if (e.type !== 'user') continue
    const channelMsg = extractChannelMsg(e.message?.content)
    if (!channelMsg) continue
    if (channelMsg.userId === '__mcd_scheduler__') continue
    if (channelMsg.ts < cutoff) continue
    if (userFilter && channelMsg.user !== userFilter) continue

    userSet.add(channelMsg.user)
    const responseSnippet = e.uuid ? (uuidToResponseSnippet.get(e.uuid) ?? '') : ''
    entries.push({
      ts: channelMsg.ts,
      user: channelMsg.user,
      userId: channelMsg.userId,
      platform: channelMsg.platform,
      text: channelMsg.text,
      responseSnippet,
    })
  }

  entries.sort((a, b) => b.ts.localeCompare(a.ts))

  return Response.json({
    entries: entries.slice(0, 500),
    total: entries.length,
    users: [...userSet].sort(),
    generatedAt,
  } satisfies CommandHistoryResponse)
}

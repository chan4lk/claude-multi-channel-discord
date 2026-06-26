import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface PulseProject {
  slug: string
  active: boolean
  lastActiveMs: number
  sessionCount: number
  turnsPerDay7: number
}

export interface LivePulseSnapshot {
  projects: PulseProject[]
  activeCount: number
  generatedAt: string
}

function getProjectSlugs(mcdDir: string): string[] {
  const projectsDir = path.join(mcdDir, 'projects')
  try {
    return fs.readdirSync(projectsDir).filter((s) => {
      if (s.startsWith('.')) return false
      try {
        const stat = fs.statSync(path.join(projectsDir, s))
        return stat.isDirectory() || stat.isSymbolicLink()
      } catch { return false }
    })
  } catch { return [] }
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

interface JsonlLine {
  message?: { role?: string; content?: unknown[] }
  timestamp?: string
}

function getProjectPulse(slug: string, mcdDir: string): PulseProject {
  const jsonlFiles = findJsonlFiles(slug, mcdDir)
  const now = Date.now()
  const sevenDaysAgo = now - 7 * 86_400_000
  const tenSecondsAgo = now - 10_000

  let lastActiveMs = 0
  let turnsLast7d = 0

  for (const filePath of jsonlFiles) {
    let mtimeMs = 0
    try { mtimeMs = fs.statSync(filePath).mtimeMs } catch { continue }
    if (mtimeMs > lastActiveMs) lastActiveMs = mtimeMs

    let lines: string[]
    try { lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean) } catch { continue }

    for (const raw of lines) {
      let line: JsonlLine
      try { line = JSON.parse(raw) } catch { continue }
      if (line.message?.role !== 'user' || !line.timestamp) continue
      const content = line.message.content
      if (!Array.isArray(content) || content.length === 0) continue
      const first = content[0] as { type?: string }
      if (first?.type === 'tool_result') continue
      const tsMs = Date.parse(line.timestamp)
      if (!isNaN(tsMs) && tsMs >= sevenDaysAgo) turnsLast7d++
    }
  }

  return {
    slug,
    active: lastActiveMs >= tenSecondsAgo,
    lastActiveMs,
    sessionCount: jsonlFiles.length,
    turnsPerDay7: turnsLast7d / 7,
  }
}

function buildSnapshot(mcdDir: string): LivePulseSnapshot {
  const slugs = getProjectSlugs(mcdDir)
  const projects = slugs.map((s) => getProjectPulse(s, mcdDir))
  return {
    projects,
    activeCount: projects.filter((p) => p.active).length,
    generatedAt: new Date().toISOString(),
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  // SSE stream
  if (url.searchParams.get('stream') === '1') {
    const encoder = new TextEncoder()
    let closed = false

    const stream = new ReadableStream({
      async start(controller) {
        function emit() {
          if (closed) return
          try {
            const snap = buildSnapshot(mcdDir)
            const data = `data: ${JSON.stringify(snap)}\n\n`
            controller.enqueue(encoder.encode(data))
          } catch {
            // continue
          }
        }

        emit()
        const interval = setInterval(emit, 3000)

        req.signal.addEventListener('abort', () => {
          closed = true
          clearInterval(interval)
          try { controller.close() } catch { /* already closed */ }
        })
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  // Snapshot endpoint
  return Response.json(buildSnapshot(mcdDir))
}

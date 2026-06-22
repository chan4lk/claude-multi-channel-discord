import { execSync } from 'child_process'
import { NextRequest } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function listTmuxSessions(): string[] {
  try {
    const out = execSync('tmux list-sessions -F "#{session_name}"', { timeout: 3000, encoding: 'utf-8' })
    return out.trim().split('\n').filter(Boolean)
  } catch { return [] }
}

function capturePane(session: string, fullHistory: boolean): string {
  try {
    const args = fullHistory ? `-pt ${session} -S -` : `-pt ${session} -e`
    const out = execSync(`tmux capture-pane ${args} 2>/dev/null; tmux save-buffer -`, {
      timeout: 5000, encoding: 'utf-8',
    })
    return out
  } catch {
    // Fallback: capture without escape codes
    try {
      const out = execSync(`tmux capture-pane -pt ${session} && tmux save-buffer -`, {
        timeout: 5000, encoding: 'utf-8',
      })
      return out
    } catch { return '' }
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const mcdDir = process.env.MCD_CHANNELS_DIR

  if (!mcdDir) {
    return new Response('MCD_CHANNELS_DIR not set', { status: 500 })
  }

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )
  const slugs = Object.values(channels?.projects ?? {}).map((p) => p.slug).filter(Boolean)
  if (!slugs.includes(slug)) {
    return new Response('Project not found', { status: 404 })
  }

  const url = new URL(req.url)
  const fullHistory = url.searchParams.get('full') === '1'

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      let intervalId: ReturnType<typeof setInterval>
      let aborted = false

      function send(data: string) {
        if (aborted) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      function tick() {
        if (aborted) return
        const sessions = listTmuxSessions()
        const session = sessions.find((s) => s.startsWith(`mcd-${slug}-`))

        if (!session) {
          send('__OFFLINE__')
          return
        }

        const output = capturePane(session, fullHistory)
        send(output)
      }

      tick()
      intervalId = setInterval(tick, 1500)

      req.signal.addEventListener('abort', () => {
        aborted = true
        clearInterval(intervalId)
        try { controller.close() } catch {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

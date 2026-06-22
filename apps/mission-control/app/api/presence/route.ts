import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export interface OperatorPresence {
  handle: string
  page: string
  slug?: string
  ts: number
}

// In-memory presence store — persists for the lifetime of the Next.js process
const presenceMap = new Map<string, OperatorPresence>()
const EVICT_MS = 30_000

function evictStale() {
  const now = Date.now()
  for (const [handle, op] of presenceMap) {
    if (now - op.ts > EVICT_MS) presenceMap.delete(handle)
  }
}

function activeOperators(): OperatorPresence[] {
  evictStale()
  return Array.from(presenceMap.values()).sort((a, b) => b.ts - a.ts)
}

// SSE: GET /api/presence — streams operator list every 3s
export async function GET(): Promise<Response> {
  const stream = new ReadableStream({
    start(controller) {
      function send() {
        const ops = activeOperators()
        const data = JSON.stringify({ operators: ops })
        controller.enqueue(`data: ${data}\n\n`)
      }

      send()
      const id = setInterval(send, 3_000)

      // Clean up when client disconnects (stream cancel)
      return () => clearInterval(id)
    },
    cancel() {
      // Cleanup handled by the return value of start
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

// POST /api/presence/ping — client announces current page
export async function POST(req: NextRequest): Promise<Response> {
  let body: { handle?: string; page?: string; slug?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const handle = (body.handle ?? '').trim().slice(0, 32)
  const page = (body.page ?? '/').slice(0, 128)
  const slug = body.slug ? body.slug.slice(0, 64) : undefined

  if (!handle) return Response.json({ ok: false, error: 'handle required' }, { status: 400 })

  presenceMap.set(handle, { handle, page, slug, ts: Date.now() })
  evictStale()

  return Response.json({ ok: true, operators: activeOperators() })
}

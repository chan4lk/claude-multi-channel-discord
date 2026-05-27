import { addClient, removeClient } from '../../../../src/sse'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  let controller!: ReadableStreamDefaultController
  const stream = new ReadableStream({
    start(c) {
      controller = c
      addClient(controller)
      const hb = setInterval(() => {
        try {
          c.enqueue(': keepalive\n\n')
        } catch {
          clearInterval(hb)
        }
      }, 15_000)
      // Store hb on controller object so cancel can reach it
      ;(c as unknown as Record<string, unknown>)['__hb'] = hb
    },
    cancel() {
      const hb = (controller as unknown as Record<string, unknown>)['__hb'] as ReturnType<typeof setInterval> | undefined
      if (hb !== undefined) clearInterval(hb)
      removeClient(controller)
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

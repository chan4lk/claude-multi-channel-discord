import { addClient, removeClient } from '../../../../src/sse'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  let controller!: ReadableStreamDefaultController
  const stream = new ReadableStream({
    start(c) {
      controller = c
      addClient(controller)
    },
    cancel() {
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

import { NextRequest } from 'next/server'

const HUB_URL = process.env.HUB_URL ?? 'http://localhost:4001'

export async function GET(_req: NextRequest) {
  const upstream = await fetch(`${HUB_URL}/events/stream`, {
    headers: { Accept: 'text/event-stream' },
  })
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

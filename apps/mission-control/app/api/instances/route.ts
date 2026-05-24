import { NextRequest } from 'next/server'

const HUB_URL = process.env.HUB_URL ?? 'http://localhost:4001'

export async function GET(_req: NextRequest) {
  const res = await fetch(`${HUB_URL}/api/instances`)
  const data = await res.json()
  return Response.json(data)
}

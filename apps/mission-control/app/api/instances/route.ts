import { getInstances } from '../../../src/db'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const rows = getInstances()
  return Response.json(rows)
}

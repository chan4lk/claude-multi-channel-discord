import { getInstances, getInstanceActivity } from '../../../src/db'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const rows = getInstances()
  const enriched = rows.map((row) => ({
    ...row,
    ...getInstanceActivity(row.instance_id),
  }))
  return Response.json(enriched)
}

import { getAllAnnotations } from '../../../../src/db'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const rows = getAllAnnotations()
  // Return as slug→note map for easy lookup
  const map: Record<string, string> = {}
  for (const row of rows) map[row.slug] = row.note
  return Response.json(map)
}

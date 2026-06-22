import { NextRequest } from 'next/server'
import { insertSnapshot, getSnapshots, getSnapshot, deleteSnapshot } from '../../../src/db'
import { computeFleet } from '../../../src/fleet-compute'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (id) {
    const row = getSnapshot(Number(id))
    if (!row) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json(row)
  }

  return Response.json({ snapshots: getSnapshots(100) })
}

export async function POST(req: NextRequest): Promise<Response> {
  let label = ''
  try {
    const body = await req.json() as Record<string, unknown>
    label = String(body.label ?? '').trim().slice(0, 120)
  } catch {}

  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })

  let fleet: ReturnType<typeof computeFleet>
  try {
    fleet = computeFleet(mcdDir)
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }

  const snapshotData = {
    idle: fleet.idle,
    active: fleet.active,
    stalled: fleet.stalled,
    autonomous: fleet.autonomous,
    projects: fleet.projects.map(p => ({
      slug: p.slug,
      state: p.state,
      ageMins: p.ageMins,
      monthlyTokensUsed: p.monthlyTokensUsed ?? 0,
      monthlyTokenBudget: p.monthlyTokenBudget ?? 0,
      goalText: p.goalText ?? '',
      goalStatus: p.goalStatus ?? '',
    })),
  }

  const id = insertSnapshot(label, fleet.projects.length, snapshotData)
  return Response.json({ ok: true, id })
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const id = Number(searchParams.get('id'))
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  deleteSnapshot(id)
  return Response.json({ ok: true })
}

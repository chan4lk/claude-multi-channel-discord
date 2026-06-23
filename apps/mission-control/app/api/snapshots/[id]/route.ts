import { NextRequest } from 'next/server'
import { getSnapshot, updateSnapshotLabel, deleteSnapshot } from '../../../../src/db'

export const dynamic = 'force-dynamic'

// PATCH /api/snapshots/[id] — rename a snapshot's label (P149 AC5)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: idStr } = await params
  const id = Number(idStr)
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })

  let label = ''
  try {
    const body = await req.json() as Record<string, unknown>
    label = String(body.label ?? '').trim().slice(0, 120)
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  const ok = updateSnapshotLabel(id, label)
  if (!ok) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ ok: true, id, label })
}

// DELETE /api/snapshots/[id] — soft-delete (P149 AC5)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: idStr } = await params
  const id = Number(idStr)
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  if (!getSnapshot(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  deleteSnapshot(id)
  return Response.json({ ok: true })
}

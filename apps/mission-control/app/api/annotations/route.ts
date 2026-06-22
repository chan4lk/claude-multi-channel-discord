import {
  insertTurnAnnotation,
  updateTurnAnnotation,
  deleteTurnAnnotation,
  getTurnAnnotations,
  type TurnAnnotationTag,
  type TurnAnnotationRow,
} from '@/src/db'

export const dynamic = 'force-dynamic'

export type { TurnAnnotationTag, TurnAnnotationRow }

const VALID_TAGS: TurnAnnotationTag[] = ['note', 'warning', 'bug']

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug') ?? undefined
  const tag = url.searchParams.get('tag') as TurnAnnotationTag | null
  const sessionFile = url.searchParams.get('sessionFile') ?? undefined
  const cursor = url.searchParams.get('cursor') ? parseInt(url.searchParams.get('cursor')!, 10) : undefined
  const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : 200

  const rows = getTurnAnnotations({
    slug,
    tag: tag && VALID_TAGS.includes(tag) ? tag : undefined,
    sessionFile,
    cursor,
    limit,
  })

  return Response.json({ annotations: rows })
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.json() as {
    id?: number
    slug: string
    sessionFile?: string
    turnIndex: number
    tag: TurnAnnotationTag
    note: string
  }

  if (!body.slug || body.turnIndex == null || !body.tag || body.note == null) {
    return Response.json({ error: 'slug, turnIndex, tag, note required' }, { status: 400 })
  }
  if (!VALID_TAGS.includes(body.tag)) {
    return Response.json({ error: 'invalid tag' }, { status: 400 })
  }
  if (body.note.length > 200) {
    return Response.json({ error: 'note max 200 chars' }, { status: 400 })
  }

  if (body.id) {
    updateTurnAnnotation(body.id, body.tag, body.note)
    return Response.json({ ok: true, id: body.id })
  }

  const id = insertTurnAnnotation(
    body.slug,
    body.sessionFile ?? '',
    body.turnIndex,
    body.tag,
    body.note
  )
  return Response.json({ ok: true, id }, { status: 201 })
}

export async function DELETE(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  deleteTurnAnnotation(parseInt(id, 10))
  return Response.json({ ok: true })
}

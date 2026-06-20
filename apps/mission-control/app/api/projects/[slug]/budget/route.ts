import * as fs from 'fs'
import * as path from 'path'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

type ChannelsJson = {
  projects?: Record<string, { slug?: string; monthlyTokenBudget?: number; [key: string]: unknown }>
  [key: string]: unknown
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug: targetSlug } = await params
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })
  }

  let body: { budget: number | null }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { budget } = body
  if (budget !== null && (typeof budget !== 'number' || budget < 0 || !Number.isFinite(budget))) {
    return Response.json({ error: 'budget must be a non-negative number or null' }, { status: 400 })
  }

  const channelsPath = path.join(mcdDir, 'channels.json')
  let channels: ChannelsJson
  try {
    channels = JSON.parse(fs.readFileSync(channelsPath, 'utf-8')) as ChannelsJson
  } catch {
    return Response.json({ error: 'Failed to read channels.json' }, { status: 500 })
  }

  let foundChatId: string | null = null
  for (const [chatId, proj] of Object.entries(channels.projects ?? {})) {
    if (proj.slug === targetSlug) {
      foundChatId = chatId
      break
    }
  }

  if (!foundChatId) {
    return Response.json({ error: `Project '${targetSlug}' not found` }, { status: 404 })
  }

  if (budget === null) {
    delete channels.projects![foundChatId]!.monthlyTokenBudget
  } else {
    channels.projects![foundChatId]!.monthlyTokenBudget = budget
  }

  const tmpPath = channelsPath + '.tmp'
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(channels, null, 2) + '\n', 'utf-8')
    fs.renameSync(tmpPath, channelsPath)
  } catch {
    try { fs.unlinkSync(tmpPath) } catch {}
    return Response.json({ error: 'Failed to write channels.json' }, { status: 500 })
  }

  return Response.json({
    ok: true,
    slug: targetSlug,
    monthlyTokenBudget: budget,
  })
}

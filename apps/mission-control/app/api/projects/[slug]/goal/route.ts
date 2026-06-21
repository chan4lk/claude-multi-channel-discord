import { NextRequest } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

type GoalStatus = 'active' | 'paused' | 'completed'

function goalFilePath(slug: string): string | null {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return null
  return path.join(mcdDir, 'projects', slug, 'GOAL.md')
}

function parseGoal(raw: string): { goalText: string; goalStatus: GoalStatus } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (match) {
    const body = match[2].trim()
    const statusMatch = match[1].match(/^status:\s*(\w+)$/m)
    const s = statusMatch?.[1] as GoalStatus | undefined
    const goalStatus: GoalStatus = (s === 'paused' || s === 'completed') ? s : 'active'
    return { goalText: body || raw, goalStatus }
  }
  return { goalText: raw.trim(), goalStatus: 'active' }
}

function formatGoal(text: string, status: GoalStatus): string {
  return `---\nstatus: ${status}\n---\n${text}`
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const filePath = goalFilePath(slug)
  if (!filePath) return Response.json({ slug, goalText: null, goalStatus: null })
  try {
    const raw = fs.readFileSync(filePath, 'utf-8').trim()
    if (!raw) return Response.json({ slug, goalText: null, goalStatus: null })
    const { goalText, goalStatus } = parseGoal(raw)
    return Response.json({ slug, goalText, goalStatus })
  } catch {
    return Response.json({ slug, goalText: null, goalStatus: null })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const filePath = goalFilePath(slug)
  if (!filePath) return new Response('Server not configured', { status: 500 })
  let body: { text?: string; status?: string }
  try { body = await req.json() as { text?: string; status?: string } }
  catch { return new Response('Bad Request', { status: 400 }) }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    try { fs.unlinkSync(filePath) } catch { /* already absent */ }
    return Response.json({ slug, goalText: null, goalStatus: null })
  }
  const s = body.status as GoalStatus | undefined
  const status: GoalStatus = (s === 'paused' || s === 'completed') ? s : 'active'
  fs.writeFileSync(filePath, formatGoal(text, status), 'utf-8')
  return Response.json({ slug, goalText: text, goalStatus: status })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const filePath = goalFilePath(slug)
  if (!filePath) return new Response('Server not configured', { status: 500 })
  try { fs.unlinkSync(filePath) } catch { /* already absent */ }
  return Response.json({ slug, deleted: true })
}

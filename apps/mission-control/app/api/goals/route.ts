import { NextRequest } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

type GoalStatus = 'active' | 'paused' | 'completed'

interface GoalCard {
  slug: string
  goalText: string
  status: GoalStatus
  lastModified: string | null
}

function parseGoal(raw: string): { goalText: string; status: GoalStatus } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (match) {
    const body = match[2].trim()
    const statusMatch = match[1].match(/^status:\s*(\w+)$/m)
    const s = statusMatch?.[1] as GoalStatus | undefined
    const status: GoalStatus = (s === 'paused' || s === 'completed') ? s : 'active'
    return { goalText: body || raw, status }
  }
  return { goalText: raw.trim(), status: 'active' }
}

export async function GET(_req: NextRequest): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ goals: [] })

  let channels: { projects?: Record<string, { slug?: string }> }
  try {
    channels = JSON.parse(fs.readFileSync(path.join(mcdDir, 'channels.json'), 'utf-8'))
  } catch {
    return Response.json({ goals: [] })
  }

  const projects = Object.values(channels.projects ?? {})
  const goals: GoalCard[] = []

  for (const proj of projects) {
    const slug = proj.slug
    if (!slug) continue
    const goalPath = path.join(mcdDir, 'projects', slug, 'GOAL.md')
    try {
      const raw = fs.readFileSync(goalPath, 'utf-8').trim()
      if (!raw) continue
      const stat = fs.statSync(goalPath)
      const { goalText, status } = parseGoal(raw)
      goals.push({
        slug,
        goalText,
        status,
        lastModified: stat.mtime.toISOString(),
      })
    } catch {
      // no GOAL.md — skip
    }
  }

  return Response.json({ goals })
}

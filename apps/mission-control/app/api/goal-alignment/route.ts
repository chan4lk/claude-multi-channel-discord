import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

type GoalStatus = 'active' | 'paused' | 'completed'

interface GoalEntry {
  slug: string
  goalText: string
  status: GoalStatus
}

interface AlignmentMatrix {
  slugs: string[]
  matrix: number[][] // matrix[i][j] = similarity between slugs[i] and slugs[j]
  goals: Record<string, string> // slug → first line of goal
  statuses: Record<string, GoalStatus>
  outliers: string[] // slugs with no goal or sim < 0.05 to all others
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
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

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
  )
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const t of a) { if (b.has(t)) intersection++ }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ slugs: [], matrix: [], goals: {}, statuses: {}, outliers: [] })

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )
  const projects = Object.values(channels?.projects ?? {})

  const entries: GoalEntry[] = []
  const noGoalSlugs: string[] = []

  for (const proj of projects) {
    const slug = proj.slug
    if (!slug) continue
    const goalPath = path.join(mcdDir, 'projects', slug, 'GOAL.md')
    try {
      const raw = fs.readFileSync(goalPath, 'utf-8').trim()
      if (!raw) { noGoalSlugs.push(slug); continue }
      const { goalText, status } = parseGoal(raw)
      entries.push({ slug, goalText, status })
    } catch {
      noGoalSlugs.push(slug)
    }
  }

  entries.sort((a, b) => a.slug.localeCompare(b.slug))
  const slugs = entries.map((e) => e.slug)
  const tokenSets = entries.map((e) => tokenize(e.goalText))

  // Build NxN similarity matrix
  const n = slugs.length
  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1
    for (let j = i + 1; j < n; j++) {
      const sim = jaccardSimilarity(tokenSets[i], tokenSets[j])
      matrix[i][j] = sim
      matrix[j][i] = sim
    }
  }

  // Find outliers: max similarity to any other project < 0.05
  const outliers: string[] = [...noGoalSlugs]
  for (let i = 0; i < n; i++) {
    let maxSim = 0
    for (let j = 0; j < n; j++) {
      if (i !== j && matrix[i][j] > maxSim) maxSim = matrix[i][j]
    }
    if (maxSim < 0.05) outliers.push(slugs[i])
  }

  const goals: Record<string, string> = {}
  const statuses: Record<string, GoalStatus> = {}
  for (const e of entries) {
    goals[e.slug] = e.goalText.split('\n')[0].slice(0, 120)
    statuses[e.slug] = e.status
  }

  return Response.json({ slugs, matrix, goals, statuses, outliers } satisfies AlignmentMatrix)
}

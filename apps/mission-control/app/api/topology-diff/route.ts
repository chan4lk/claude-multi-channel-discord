import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export interface SnapProject {
  slug: string
  platform: string
  model: string
  chatId: string
}

interface Snapshot {
  date: string
  projects: SnapProject[]
}

export interface ChangedField {
  slug: string
  field: string
  from: string
  to: string
}

export interface TopologyDiffResponse {
  snapshots: { date: string }[]
  diff: {
    added: SnapProject[]
    removed: SnapProject[]
    changed: ChangedField[]
  }
  fromDate: string
  toDate: string
  generatedAt: string
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T
  } catch {
    return null
  }
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function readSnapshots(snapshotPath: string): Snapshot[] {
  try {
    const raw = fs.readFileSync(snapshotPath, 'utf-8')
    const lines = raw.split('\n').filter((l) => l.trim().length > 0)
    const snaps: Snapshot[] = []
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Snapshot
        if (parsed.date && Array.isArray(parsed.projects)) {
          snaps.push(parsed)
        }
      } catch {
        // skip malformed lines
      }
    }
    return snaps
  } catch {
    return []
  }
}

function appendSnapshot(snapshotPath: string, snap: Snapshot): void {
  try {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true })
    fs.appendFileSync(snapshotPath, JSON.stringify(snap) + '\n', 'utf-8')
  } catch {
    // best-effort
  }
}

function buildTodaySnapshot(mcdDir: string): SnapProject[] {
  const channelsPath = path.join(mcdDir, 'channels.json')
  const channels = readJson<Record<string, unknown>>(channelsPath)
  if (!channels) return []

  const projects = (channels as { projects?: Record<string, Record<string, unknown>> }).projects ?? {}
  const defaults = (channels as { defaults?: Record<string, unknown> }).defaults ?? {}
  const defaultModel = (defaults as { model?: string }).model ?? 'unknown'

  const result: SnapProject[] = []
  for (const [chatId, proj] of Object.entries(projects)) {
    const p = proj as Record<string, unknown>
    result.push({
      slug: (p.slug as string) ?? chatId,
      platform: (p.platform as string) ?? 'discord',
      model: (p.model as string) ?? defaultModel,
      chatId,
    })
  }
  return result
}

export async function GET(req: NextRequest): Promise<NextResponse<TopologyDiffResponse>> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const snapshotPath = path.join(mcdDir, 'memory', 'topology-snapshots.jsonl')

  const searchParams = req.nextUrl.searchParams
  const today = toDateStr(new Date())
  const sevenDaysAgo = toDateStr(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))

  let fromDate = searchParams.get('from') ?? sevenDaysAgo
  let toDate = searchParams.get('to') ?? today

  // Clamp range to 90 days
  const fromMs = new Date(fromDate).getTime()
  const toMs = new Date(toDate).getTime()
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000
  if (toMs - fromMs > ninetyDaysMs) {
    fromDate = toDateStr(new Date(toMs - ninetyDaysMs))
  }

  // Read existing snapshots
  let snapshots = readSnapshots(snapshotPath)

  // If no snapshot for today, append one
  const hasTodaySnap = snapshots.some((s) => s.date === today)
  if (!hasTodaySnap) {
    const todayProjects = buildTodaySnapshot(mcdDir)
    const newSnap: Snapshot = { date: today, projects: todayProjects }
    appendSnapshot(snapshotPath, newSnap)
    snapshots = [...snapshots, newSnap]
  }

  // Filter snapshots within range (inclusive)
  const inRange = snapshots
    .filter((s) => s.date >= fromDate && s.date <= toDate)
    .sort((a, b) => a.date.localeCompare(b.date))

  // Build diff: earliest vs latest in range (or fallback to overall earliest/latest)
  const allSorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))

  let fromSnap: Snapshot | undefined = inRange[0] ?? allSorted[0]
  let toSnap: Snapshot | undefined = inRange[inRange.length - 1] ?? allSorted[allSorted.length - 1]

  // If from and to are the same snapshot, there's nothing to diff
  const diff: TopologyDiffResponse['diff'] = { added: [], removed: [], changed: [] }

  if (fromSnap && toSnap && fromSnap.date !== toSnap.date) {
    const fromMap = new Map<string, SnapProject>(fromSnap.projects.map((p) => [p.slug, p]))
    const toMap = new Map<string, SnapProject>(toSnap.projects.map((p) => [p.slug, p]))

    for (const [slug, proj] of toMap) {
      if (!fromMap.has(slug)) {
        diff.added.push(proj)
      } else {
        const prev = fromMap.get(slug)!
        if (prev.platform !== proj.platform) {
          diff.changed.push({ slug, field: 'platform', from: prev.platform, to: proj.platform })
        }
        if (prev.model !== proj.model) {
          diff.changed.push({ slug, field: 'model', from: prev.model, to: proj.model })
        }
      }
    }

    for (const [slug, proj] of fromMap) {
      if (!toMap.has(slug)) {
        diff.removed.push(proj)
      }
    }
  }

  return NextResponse.json({
    snapshots: inRange.map((s) => ({ date: s.date })),
    diff,
    fromDate,
    toDate,
    generatedAt: new Date().toISOString(),
  })
}

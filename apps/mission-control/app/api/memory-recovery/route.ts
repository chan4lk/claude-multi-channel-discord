import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface OrphanRecord {
  id: string
  project: string
  file: string
  firstFlaggedAt: string
  resolvedAt?: string
  resolution: 'relinked' | 'deleted' | 'ignored' | null
}

export interface OpenOrphan {
  id: string
  project: string
  file: string
  snippet: string
  firstFlaggedAt: string
  daysOrphaned: number
}

export interface WeekBucket {
  weekLabel: string
  relinked: number
  deleted: number
  ignored: number
  stillOpen: number
}

export interface ProjectSparkline {
  project: string
  weeklyOpenCounts: number[]
}

export interface MemoryRecoveryResponse {
  openOrphans: OpenOrphan[]
  records: OrphanRecord[]
  weeklyHistory: WeekBucket[]
  projectSparklines: ProjectSparkline[]
  totalOpen: number
  totalResolved: number
  generatedAt: string
}

function getMcdDir(): string {
  return (
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  )
}

function getRecoveryPath(mcdDir: string): string {
  return path.join(mcdDir, 'memory-recovery.json')
}

function loadRecords(mcdDir: string): OrphanRecord[] {
  const p = getRecoveryPath(mcdDir)
  try {
    const raw = fs.readFileSync(p, 'utf-8')
    return JSON.parse(raw) as OrphanRecord[]
  } catch {
    return []
  }
}

function saveRecords(mcdDir: string, records: OrphanRecord[]): void {
  const p = getRecoveryPath(mcdDir)
  fs.writeFileSync(p, JSON.stringify(records, null, 2), { mode: 0o600 })
}

function getProjectSlugs(mcdDir: string): string[] {
  const projectsDir = path.join(mcdDir, 'projects')
  try {
    return fs.readdirSync(projectsDir).filter((s) => {
      if (s.startsWith('.')) return false
      try {
        const stat = fs.statSync(path.join(projectsDir, s))
        return stat.isDirectory() || stat.isSymbolicLink()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

function extractLinks(content: string): string[] {
  return [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]!.trim())
}

function firstLine(content: string): string {
  const line = content.split('\n').find((l) => l.trim().length > 0 && !l.startsWith('---'))
  return (line ?? '').replace(/^#+\s*/, '').trim().slice(0, 120)
}

interface ScannedOrphan {
  id: string
  project: string
  file: string
  snippet: string
}

function scanCurrentOrphans(mcdDir: string): ScannedOrphan[] {
  const slugs = getProjectSlugs(mcdDir)

  interface NodeEntry {
    id: string
    project: string
    file: string
    snippet: string
    outSlugs: string[]
    slug: string
  }

  const nodes = new Map<string, NodeEntry>()

  for (const project of slugs) {
    let realPath = path.join(mcdDir, 'projects', project)
    try {
      realPath = fs.realpathSync(realPath)
    } catch {
      continue
    }
    const memDir = path.join(realPath, 'memory')
    let files: string[]
    try {
      files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md'))
    } catch {
      continue
    }

    for (const file of files) {
      const filePath = path.join(memDir, file)
      let content = ''
      try {
        content = fs.readFileSync(filePath, 'utf-8')
      } catch {
        continue
      }
      const id = `${project}/${file}`
      const slug = file.replace(/\.md$/, '').toLowerCase()
      const outSlugs = extractLinks(content).map((l) => l.toLowerCase())
      nodes.set(id, { id, project, file, snippet: firstLine(content), outSlugs, slug })
    }
  }

  const slugToIds = new Map<string, string[]>()
  for (const [id, node] of nodes) {
    if (!slugToIds.has(node.slug)) slugToIds.set(node.slug, [])
    slugToIds.get(node.slug)!.push(id)
  }

  const inDegree = new Map<string, number>()
  const outDegree = new Map<string, number>()
  for (const id of nodes.keys()) {
    inDegree.set(id, 0)
    outDegree.set(id, 0)
  }

  for (const node of nodes.values()) {
    let resolvedOut = 0
    for (const targetSlug of node.outSlugs) {
      const candidates = slugToIds.get(targetSlug) ?? []
      const sameProject = candidates.find((c) => c.startsWith(`${node.project}/`))
      const targetId = sameProject ?? candidates[0]
      if (!targetId || targetId === node.id) continue
      resolvedOut++
      inDegree.set(targetId, (inDegree.get(targetId) ?? 0) + 1)
    }
    outDegree.set(node.id, resolvedOut)
  }

  const orphans: ScannedOrphan[] = []
  for (const [id, node] of nodes) {
    if ((inDegree.get(id) ?? 0) === 0 && (outDegree.get(id) ?? 0) === 0) {
      orphans.push({ id, project: node.project, file: node.file, snippet: node.snippet })
    }
  }
  return orphans
}

function isoWeekLabel(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().slice(0, 10)
}

function buildWeeklyHistory(records: OrphanRecord[], nowMs: number): WeekBucket[] {
  const buckets: Map<string, WeekBucket> = new Map()

  const now = new Date(nowMs)
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i * 7)
    const label = isoWeekLabel(d)
    if (!buckets.has(label)) {
      buckets.set(label, { weekLabel: label, relinked: 0, deleted: 0, ignored: 0, stillOpen: 0 })
    }
  }

  for (const rec of records) {
    if (rec.resolvedAt) {
      const label = isoWeekLabel(new Date(rec.resolvedAt))
      if (!buckets.has(label)) continue
      const b = buckets.get(label)!
      if (rec.resolution === 'relinked') b.relinked++
      else if (rec.resolution === 'deleted') b.deleted++
      else if (rec.resolution === 'ignored') b.ignored++
    } else {
      const label = isoWeekLabel(now)
      const b = buckets.get(label)
      if (b) b.stillOpen++
    }
  }

  return [...buckets.values()].sort((a, b) => a.weekLabel.localeCompare(b.weekLabel))
}

function buildProjectSparklines(records: OrphanRecord[], nowMs: number): ProjectSparkline[] {
  const projectSet = new Set(records.map((r) => r.project))
  const result: ProjectSparkline[] = []
  const now = new Date(nowMs)

  for (const project of projectSet) {
    const weeklyOpenCounts: number[] = []
    for (let i = 7; i >= 0; i--) {
      const weekEnd = new Date(now)
      weekEnd.setDate(weekEnd.getDate() - i * 7)
      const weekEndMs = weekEnd.getTime()
      const openCount = records.filter((r) => {
        if (r.project !== project) return false
        const flaggedMs = new Date(r.firstFlaggedAt).getTime()
        if (flaggedMs > weekEndMs) return false
        if (!r.resolvedAt) return true
        const resolvedMs = new Date(r.resolvedAt).getTime()
        return resolvedMs > weekEndMs
      }).length
      weeklyOpenCounts.push(openCount)
    }
    result.push({ project, weeklyOpenCounts })
  }

  return result.sort((a, b) => {
    const aLast = a.weeklyOpenCounts[a.weeklyOpenCounts.length - 1] ?? 0
    const bLast = b.weeklyOpenCounts[b.weeklyOpenCounts.length - 1] ?? 0
    return bLast - aLast
  })
}

export async function GET(): Promise<Response> {
  const mcdDir = getMcdDir()
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()

  const currentOrphans = scanCurrentOrphans(mcdDir)
  const currentIds = new Set(currentOrphans.map((o) => o.id))

  let records = loadRecords(mcdDir)
  const recordMap = new Map(records.map((r) => [r.id, r]))

  // Auto-append new orphans
  for (const orphan of currentOrphans) {
    if (!recordMap.has(orphan.id)) {
      const rec: OrphanRecord = {
        id: orphan.id,
        project: orphan.project,
        file: orphan.file,
        firstFlaggedAt: nowIso,
        resolution: null,
      }
      records.push(rec)
      recordMap.set(orphan.id, rec)
    }
  }

  // Auto-resolve: relinked or deleted
  for (const rec of records) {
    if (rec.resolution !== null) continue
    if (!currentIds.has(rec.id)) {
      const mcdDir2 = getMcdDir()
      const [project, file] = rec.id.split('/')
      let realPath = path.join(mcdDir2, 'projects', project!)
      try {
        realPath = fs.realpathSync(realPath)
      } catch {
        // project dir gone — mark deleted
        rec.resolution = 'deleted'
        rec.resolvedAt = nowIso
        continue
      }
      const filePath = path.join(realPath, 'memory', file!)
      const exists = fs.existsSync(filePath)
      rec.resolution = exists ? 'relinked' : 'deleted'
      rec.resolvedAt = nowIso
    }
  }

  saveRecords(mcdDir, records)

  const snippetMap = new Map(currentOrphans.map((o) => [o.id, o.snippet]))

  const openOrphans: OpenOrphan[] = records
    .filter((r) => r.resolution === null)
    .map((r) => {
      const daysOrphaned = Math.floor((nowMs - new Date(r.firstFlaggedAt).getTime()) / 86_400_000)
      return {
        id: r.id,
        project: r.project,
        file: r.file,
        snippet: snippetMap.get(r.id) ?? '',
        firstFlaggedAt: r.firstFlaggedAt,
        daysOrphaned,
      }
    })
    .sort((a, b) => b.daysOrphaned - a.daysOrphaned)

  const weeklyHistory = buildWeeklyHistory(records, nowMs)
  const projectSparklines = buildProjectSparklines(records, nowMs)

  return Response.json({
    openOrphans,
    records,
    weeklyHistory,
    projectSparklines,
    totalOpen: openOrphans.length,
    totalResolved: records.filter((r) => r.resolution !== null).length,
    generatedAt: nowIso,
  } satisfies MemoryRecoveryResponse)
}

export async function POST(req: Request): Promise<Response> {
  const mcdDir = getMcdDir()
  const body = (await req.json()) as { id?: string }
  if (!body.id) return Response.json({ error: 'id required' }, { status: 400 })

  const records = loadRecords(mcdDir)
  const rec = records.find((r) => r.id === body.id)
  if (!rec) return Response.json({ error: 'not found' }, { status: 404 })
  if (rec.resolution !== null) return Response.json({ error: 'already resolved' }, { status: 409 })

  rec.resolution = 'ignored'
  rec.resolvedAt = new Date().toISOString()
  saveRecords(mcdDir, records)

  return Response.json({ ok: true })
}

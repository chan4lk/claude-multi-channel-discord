import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface RadarScores {
  health: number         // 0–100
  velocity: number       // 0–100
  memory: number         // 0–100
  schedule: number       // 0–100
  toolDiversity: number  // 0–100
  backlogCoverage: number // 0–100
}

export interface RadarProject {
  slug: string
  platform: string
  scores: RadarScores
}

export interface InsightRadarResponse {
  projects: RadarProject[]
  generatedAt: string
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findJsonlFiles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return [] }
}

// health: circuit trips in last 7 days → score = max(0, 100 - tripCount * 15)
function computeHealthScore(slug: string, mcdDir: string, nowMs: number): number {
  const logPath = path.join(mcdDir, 'projects', slug, 'circuit-events.jsonl')
  let raw = ''
  try { raw = fs.readFileSync(logPath, 'utf-8') } catch { return 80 }

  const cutoff = new Date(nowMs - 7 * 86_400_000).toISOString()
  let tripCount = 0
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as { ts?: string; event?: string }
      if (e.event === 'open' && e.ts && e.ts >= cutoff) tripCount++
    } catch { continue }
  }
  return Math.max(0, 100 - tripCount * 15)
}

// velocity: user turns in last 7 days → score = min(100, turnsLast7d * 5)
function computeVelocityScore(slug: string, mcdDir: string, nowMs: number): number {
  const files = findJsonlFiles(slug, mcdDir)
  if (files.length === 0) return 0

  const cutoff = new Date(nowMs - 7 * 86_400_000).toISOString()
  let turnsLast7d = 0

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const rec = JSON.parse(line) as { role?: string; timestamp?: string }
        if (rec.role !== 'user') continue
        const ts = rec.timestamp ?? ''
        if (ts && ts < cutoff) continue
        turnsLast7d++
      } catch { continue }
    }
  }
  return Math.min(100, turnsLast7d * 5)
}

// memory: count .md files, bonus for [[link]] refs
function computeMemoryScore(slug: string, mcdDir: string): number {
  const memoryDir = path.join(mcdDir, 'projects', slug, 'memory')
  let files: string[] = []
  try {
    files = fs.readdirSync(memoryDir).filter((f) => f.endsWith('.md'))
  } catch { return 0 }

  const fileCount = files.length
  let base = Math.min(100, fileCount * 10)

  let linkCount = 0
  for (const f of files) {
    try {
      const content = fs.readFileSync(path.join(memoryDir, f), 'utf-8')
      const matches = content.match(/\[\[.*?\]\]/g)
      if (matches) linkCount += matches.length
    } catch { continue }
  }
  const bonus = Math.min(20, linkCount * 2)
  return Math.min(100, base + bonus)
}

// schedule: enabled ratio or neutral 50 if no schedules
function computeScheduleScore(
  chatId: string,
  schedulesPath: string
): number {
  const data = readJson<{ schedules?: Array<{ chatId?: string; enabled?: boolean; paused?: boolean }> }>(schedulesPath)
  if (!data?.schedules) return 50

  const projectSchedules = data.schedules.filter((s) => s.chatId === chatId)
  if (projectSchedules.length === 0) return 50

  const enabledCount = projectSchedules.filter(
    (s) => s.enabled !== false && s.paused !== true
  ).length
  return Math.round((enabledCount / projectSchedules.length) * 80 + 20)
}

// toolDiversity: unique tool names in last 7 days → score = min(100, uniqueToolCount * 12)
function computeToolDiversityScore(slug: string, mcdDir: string, nowMs: number): number {
  const files = findJsonlFiles(slug, mcdDir)
  if (files.length === 0) return 0

  const cutoff = new Date(nowMs - 7 * 86_400_000).toISOString()
  const toolNames = new Set<string>()

  for (const file of files) {
    let fileStat: fs.Stats | null = null
    try { fileStat = fs.statSync(file) } catch { continue }
    if (fileStat && fileStat.mtimeMs < nowMs - 7 * 86_400_000) continue

    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const rec = JSON.parse(line) as { type?: string; name?: string; timestamp?: string }
        if (rec.type !== 'tool_use' || !rec.name) continue
        const ts = rec.timestamp ?? ''
        if (ts && ts < cutoff) continue
        toolNames.add(rec.name)
      } catch { continue }
    }
  }
  return Math.min(100, toolNames.size * 12)
}

// backlogCoverage: [x] done vs [ ] pending in BACKLOG.md
function computeBacklogCoverageScore(slug: string, mcdDir: string): number {
  const backlogPath = path.join(mcdDir, 'projects', slug, 'BACKLOG.md')
  let raw = ''
  try { raw = fs.readFileSync(backlogPath, 'utf-8') } catch { return 50 }

  const doneCount = (raw.match(/\[x\]/gi) ?? []).length
  const pendingCount = (raw.match(/\[ \]/g) ?? []).length
  const total = doneCount + pendingCount
  if (total === 0) return 50
  return Math.round((doneCount / total) * 100)
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const schedulesPath = path.join(mcdDir, 'schedules.json')

  const channels = readJson<{
    projects?: Record<string, { slug?: string; platform?: string }>
  }>(path.join(mcdDir, 'channels.json'))

  const nowMs = Date.now()
  const projects: RadarProject[] = []

  if (channels?.projects) {
    for (const [chatId, proj] of Object.entries(channels.projects)) {
      const slug = proj.slug
      if (!slug || slug === 'master') continue

      const platform = proj.platform ?? 'discord'

      const health = computeHealthScore(slug, mcdDir, nowMs)
      const velocity = computeVelocityScore(slug, mcdDir, nowMs)
      const memory = computeMemoryScore(slug, mcdDir)
      const schedule = computeScheduleScore(chatId, schedulesPath)
      const toolDiversity = computeToolDiversityScore(slug, mcdDir, nowMs)
      const backlogCoverage = computeBacklogCoverageScore(slug, mcdDir)

      projects.push({
        slug,
        platform,
        scores: { health, velocity, memory, schedule, toolDiversity, backlogCoverage },
      })
    }
  }

  // Sort by average score descending
  projects.sort((a, b) => {
    const avgA = Object.values(a.scores).reduce((s, v) => s + v, 0) / 6
    const avgB = Object.values(b.scores).reduce((s, v) => s + v, 0) / 6
    return avgB - avgA
  })

  return Response.json({ projects, generatedAt: new Date().toISOString() } satisfies InsightRadarResponse)
}

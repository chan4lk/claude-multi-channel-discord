import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export type LifecycleStage = 'proposed' | 'planned' | 'building' | 'verifying' | 'merged'

export interface LifecycleProposal {
  id: string
  project: string
  changeName: string
  title: string
  stage: LifecycleStage
  stageReason: string
  createdAtMs: number
  updatedAtMs: number
  ageDays: number
  stageAgeDays: number
  prUrl: string | null
  hasSpec: boolean
  hasTasks: boolean
  hasVerify: boolean
  taskCount: number
  tasksDone: number
  proposalSnippet: string
}

export interface ThroughputMetrics {
  mergedLast4Weeks: number
  mergedPerWeek: number[]
  avgTimeToMergeDays: number | null
  totalActive: number
  totalMerged: number
}

export interface ProposalLifecycleResponse {
  proposals: LifecycleProposal[]
  throughput: ThroughputMetrics
  projects: string[]
  generatedAt: string
}

function getProjectSlugs(mcdDir: string): string[] {
  const projectsDir = path.join(mcdDir, 'projects')
  try {
    return fs.readdirSync(projectsDir).filter((s) => {
      if (s.startsWith('.')) return false
      try {
        const stat = fs.statSync(path.join(projectsDir, s))
        return stat.isDirectory() || stat.isSymbolicLink()
      } catch { return false }
    })
  } catch { return [] }
}

function extractTitle(content: string): string {
  const h1 = content.match(/^#\s+(.+)$/m)
  if (h1) return h1[1]!.trim()
  const titleLine = content.match(/title[:\s]+(.+)/i)
  if (titleLine) return titleLine[1]!.trim()
  return 'Untitled Proposal'
}

function countTasks(tasksContent: string): { total: number; done: number } {
  const lines = tasksContent.split('\n')
  let total = 0
  let done = 0
  for (const line of lines) {
    if (/^\s*-\s+\[[ x]\]/.test(line)) {
      total++
      if (/^\s*-\s+\[x\]/i.test(line)) done++
    }
  }
  return { total, done }
}

function inferStage(changeDir: string): { stage: LifecycleStage; reason: string } {
  const has = (file: string) => {
    try { fs.accessSync(path.join(changeDir, file)); return true } catch { return false }
  }
  if (has('pr-url.txt')) return { stage: 'merged', reason: 'pr-url.txt present' }
  if (has('verify-report.md')) return { stage: 'verifying', reason: 'verify-report.md present' }
  if (has('tasks.md')) return { stage: 'building', reason: 'tasks.md present' }
  if (has('spec.md')) return { stage: 'planned', reason: 'spec.md present' }
  return { stage: 'proposed', reason: 'proposal.md only' }
}

function getMtime(p: string): number {
  try { return fs.statSync(p).mtimeMs } catch { return 0 }
}

function getStageFile(changeDir: string, stage: LifecycleStage): string {
  switch (stage) {
    case 'merged': return path.join(changeDir, 'pr-url.txt')
    case 'verifying': return path.join(changeDir, 'verify-report.md')
    case 'building': return path.join(changeDir, 'tasks.md')
    case 'planned': return path.join(changeDir, 'spec.md')
    default: return path.join(changeDir, 'proposal.md')
  }
}

function weekIndex(tsMs: number, nowMs: number): number {
  return Math.floor((nowMs - tsMs) / (7 * 86_400_000))
}

export async function GET(): Promise<Response> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const slugs = getProjectSlugs(mcdDir)
  const now = Date.now()
  const proposals: LifecycleProposal[] = []

  for (const project of slugs) {
    let realPath = path.join(mcdDir, 'projects', project)
    try { realPath = fs.realpathSync(realPath) } catch { continue }

    const specclaw = path.join(realPath, '.specclaw', 'changes')
    let changeDirs: string[]
    try {
      changeDirs = fs.readdirSync(specclaw).filter((d) => {
        try { return fs.statSync(path.join(specclaw, d)).isDirectory() } catch { return false }
      })
    } catch { continue }

    for (const changeName of changeDirs) {
      const changeDir = path.join(specclaw, changeName)
      const proposalPath = path.join(changeDir, 'proposal.md')

      let proposalContent = ''
      let createdAtMs = now
      try {
        const stat = fs.statSync(proposalPath)
        createdAtMs = stat.mtimeMs
        proposalContent = fs.readFileSync(proposalPath, 'utf-8')
      } catch { continue }

      const { stage, reason } = inferStage(changeDir)
      const stageFilePath = getStageFile(changeDir, stage)
      const stageMtime = getMtime(stageFilePath)
      const updatedAtMs = Math.max(
        getMtime(path.join(changeDir, 'proposal.md')),
        getMtime(path.join(changeDir, 'spec.md')),
        getMtime(path.join(changeDir, 'tasks.md')),
        getMtime(path.join(changeDir, 'verify-report.md')),
      )

      let prUrl: string | null = null
      try {
        const prFile = path.join(changeDir, 'pr-url.txt')
        prUrl = fs.readFileSync(prFile, 'utf-8').trim() || null
      } catch { /* no pr-url */ }

      const hasSpec = fs.existsSync(path.join(changeDir, 'spec.md'))
      const hasTasks = fs.existsSync(path.join(changeDir, 'tasks.md'))
      const hasVerify = fs.existsSync(path.join(changeDir, 'verify-report.md'))

      let taskCount = 0
      let tasksDone = 0
      if (hasTasks) {
        try {
          const tc = fs.readFileSync(path.join(changeDir, 'tasks.md'), 'utf-8')
          const counts = countTasks(tc)
          taskCount = counts.total
          tasksDone = counts.done
        } catch { /* ignore */ }
      }

      const snippet = proposalContent.slice(0, 200).replace(/\n+/g, ' ').trim()

      proposals.push({
        id: `${project}/${changeName}`,
        project,
        changeName,
        title: extractTitle(proposalContent),
        stage,
        stageReason: reason,
        createdAtMs,
        updatedAtMs: updatedAtMs || createdAtMs,
        ageDays: Math.max(0, Math.floor((now - createdAtMs) / 86_400_000)),
        stageAgeDays: Math.max(0, Math.floor((now - (stageMtime || createdAtMs)) / 86_400_000)),
        prUrl,
        hasSpec,
        hasTasks,
        hasVerify,
        taskCount,
        tasksDone,
        proposalSnippet: snippet,
      })
    }
  }

  proposals.sort((a, b) => b.updatedAtMs - a.updatedAtMs)

  // Throughput: merged proposals per week (last 4 weeks)
  const merged = proposals.filter((p) => p.stage === 'merged')
  const perWeek = [0, 0, 0, 0]
  const mergeTimings: number[] = []

  for (const p of merged) {
    const stageMtime = getMtime(getStageFile(
      path.join(
        (() => {
          let rp = path.join(mcdDir, 'projects', p.project)
          try { rp = fs.realpathSync(rp) } catch { /* use as-is */ }
          return rp
        })(),
        '.specclaw',
        'changes',
        p.changeName,
      ),
      p.stage,
    ))
    const idx = weekIndex(stageMtime || p.updatedAtMs, now)
    if (idx < 4) perWeek[idx]++
    const daysToMerge = Math.max(0, Math.floor(((stageMtime || p.updatedAtMs) - p.createdAtMs) / 86_400_000))
    mergeTimings.push(daysToMerge)
  }

  const mergedLast4Weeks = perWeek.reduce((a, b) => a + b, 0)
  const avgTimeToMergeDays =
    mergeTimings.length > 0
      ? Math.round(mergeTimings.reduce((a, b) => a + b, 0) / mergeTimings.length)
      : null

  const projects = [...new Set(proposals.map((p) => p.project))].sort()

  return Response.json({
    proposals,
    throughput: {
      mergedLast4Weeks,
      mergedPerWeek: perWeek,
      avgTimeToMergeDays,
      totalActive: proposals.filter((p) => p.stage !== 'merged').length,
      totalMerged: merged.length,
    },
    projects,
    generatedAt: new Date().toISOString(),
  } satisfies ProposalLifecycleResponse)
}

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export type Stage = 'proposed' | 'planning' | 'building' | 'verifying' | 'done'

export interface KanbanCard {
  id: string
  project: string
  changeName: string
  title: string
  age: string
  ageDays: number
  stage: Stage
}

export interface KanbanColumn {
  stage: Stage
  label: string
  cards: KanbanCard[]
}

export interface ProposalKanbanResponse {
  columns: KanbanColumn[]
  total: number
  computedAt: string
}

const STAGE_ORDER: Stage[] = ['proposed', 'planning', 'building', 'verifying', 'done']

const STAGE_LABELS: Record<Stage, string> = {
  proposed: 'Proposed',
  planning: 'Planning',
  building: 'Building',
  verifying: 'Verifying',
  done: 'Done',
}

function relAge(mtimeMs: number): { label: string; days: number } {
  const diffMs = Date.now() - mtimeMs
  const days = Math.floor(diffMs / 86_400_000)
  if (days === 0) return { label: 'today', days: 0 }
  if (days === 1) return { label: '1d ago', days: 1 }
  return { label: `${days}d ago`, days }
}

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)/m)
  if (match) return match[1].trim()
  const line = content.split('\n').find((l) => l.trim().length > 0)
  return line?.trim() ?? 'Untitled'
}

function inferStage(changeDir: string): Stage {
  const has = (name: string) => fs.existsSync(path.join(changeDir, name))
  if (has('verify-report.md')) {
    try {
      const report = fs.readFileSync(path.join(changeDir, 'verify-report.md'), 'utf-8')
      if (/APPROVED/i.test(report)) return 'done'
    } catch {}
    return 'verifying'
  }
  if (has('tasks.md')) return 'building'
  if (has('spec.md')) return 'planning'
  return 'proposed'
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

export async function GET(): Promise<Response> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const slugs = getProjectSlugs(mcdDir)
  const cards: KanbanCard[] = []

  for (const slug of slugs) {
    const projectPath = path.join(mcdDir, 'projects', slug)
    let realPath = projectPath
    try { realPath = fs.realpathSync(projectPath) } catch { continue }

    const specclawDir = path.join(realPath, '.specclaw', 'changes')
    let changes: string[] = []
    try {
      changes = fs.readdirSync(specclawDir).filter((name) => {
        try { return fs.statSync(path.join(specclawDir, name)).isDirectory() } catch { return false }
      })
    } catch { continue }

    for (const changeName of changes) {
      const changeDir = path.join(specclawDir, changeName)
      const proposalPath = path.join(changeDir, 'proposal.md')
      if (!fs.existsSync(proposalPath)) continue

      let content = ''
      let mtimeMs = Date.now()
      try {
        mtimeMs = fs.statSync(proposalPath).mtimeMs
        content = fs.readFileSync(proposalPath, 'utf-8')
      } catch { continue }

      const stage = inferStage(changeDir)
      const { label: age, days: ageDays } = relAge(mtimeMs)
      const title = extractTitle(content)

      cards.push({ id: `${slug}/${changeName}`, project: slug, changeName, title, age, ageDays, stage })
    }
  }

  const columns: KanbanColumn[] = STAGE_ORDER.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    cards: cards.filter((c) => c.stage === stage).sort((a, b) => a.ageDays - b.ageDays),
  }))

  return Response.json({
    columns,
    total: cards.length,
    computedAt: new Date().toISOString(),
  } satisfies ProposalKanbanResponse)
}

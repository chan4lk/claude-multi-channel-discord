import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export type ProposalStage = 'proposed' | 'planning' | 'building' | 'verifying' | 'done'

export interface KanbanCard {
  id: string
  project: string
  slug: string
  title: string
  age: number
  lastModifiedMs: number
  stage: ProposalStage
  stageReason: string
}

export interface KanbanColumn {
  stage: ProposalStage
  label: string
  cards: KanbanCard[]
}

export interface ProposalKanbanResponse {
  columns: KanbanColumn[]
  totalProposals: number
  projects: string[]
  generatedAt: string
}

const STAGE_ORDER: ProposalStage[] = ['proposed', 'planning', 'building', 'verifying', 'done']

const COLUMN_LABELS: Record<ProposalStage, string> = {
  proposed: 'Proposed',
  planning: 'Planning',
  building: 'Building',
  verifying: 'Verifying',
  done: 'Done',
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

function extractTitle(proposalContent: string): string {
  const match = proposalContent.match(/^#\s+(.+)$/m)
  if (match) return match[1]!.trim()
  const titleMatch = proposalContent.match(/title[:\s]+(.+)/i)
  if (titleMatch) return titleMatch[1]!.trim()
  return 'Untitled Proposal'
}

function inferStage(changeDir: string): { stage: ProposalStage; reason: string } {
  const has = (file: string) => {
    try { fs.accessSync(path.join(changeDir, file)); return true } catch { return false }
  }

  if (has('verify-report.md')) {
    const prMatch = fs.existsSync(path.join(changeDir, 'pr-url.txt'))
    if (prMatch) return { stage: 'done', reason: 'pr-url.txt present' }
    return { stage: 'verifying', reason: 'verify-report.md present' }
  }
  if (has('tasks.md')) return { stage: 'building', reason: 'tasks.md present' }
  if (has('spec.md')) return { stage: 'planning', reason: 'spec.md present' }
  return { stage: 'proposed', reason: 'proposal.md only' }
}

export async function GET(): Promise<Response> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const slugs = getProjectSlugs(mcdDir)
  const now = Date.now()
  const allCards: KanbanCard[] = []

  for (const project of slugs) {
    let realPath = path.join(mcdDir, 'projects', project)
    try { realPath = fs.realpathSync(realPath) } catch { continue }

    const specclaw = path.join(realPath, '.specclaw', 'changes')
    let changeDirs: string[]
    try {
      changeDirs = fs.readdirSync(specclaw).filter((d) => {
        try {
          return fs.statSync(path.join(specclaw, d)).isDirectory()
        } catch { return false }
      })
    } catch { continue }

    for (const changeSlug of changeDirs) {
      const changeDir = path.join(specclaw, changeSlug)
      const proposalPath = path.join(changeDir, 'proposal.md')
      let proposalContent = ''
      let mtimeMs = now
      try {
        const stat = fs.statSync(proposalPath)
        mtimeMs = stat.mtimeMs
        proposalContent = fs.readFileSync(proposalPath, 'utf-8')
      } catch { continue }

      const title = extractTitle(proposalContent)
      const { stage, reason } = inferStage(changeDir)
      const age = Math.floor((now - mtimeMs) / 86_400_000)

      allCards.push({
        id: `${project}/${changeSlug}`,
        project,
        slug: changeSlug,
        title,
        age,
        lastModifiedMs: mtimeMs,
        stage,
        stageReason: reason,
      })
    }
  }

  allCards.sort((a, b) => b.lastModifiedMs - a.lastModifiedMs)

  const columns: KanbanColumn[] = STAGE_ORDER.map((stage) => ({
    stage,
    label: COLUMN_LABELS[stage],
    cards: allCards.filter((c) => c.stage === stage),
  }))

  const projects = [...new Set(allCards.map((c) => c.project))].sort()

  return Response.json({
    columns,
    totalProposals: allCards.length,
    projects,
    generatedAt: new Date().toISOString(),
  } satisfies ProposalKanbanResponse)
}

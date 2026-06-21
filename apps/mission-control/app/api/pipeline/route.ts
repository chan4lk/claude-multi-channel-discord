import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export type PipelineStage = 'propose' | 'plan' | 'build' | 'verify' | 'pr' | 'completed'

export interface PipelineCard {
  slug: string
  name: string
  stage: PipelineStage
  daysInStage: number
  lastModifiedMs: number
  stalled: boolean
  tasksDone: number
  tasksTotal: number
  prUrl: string | null
  proposalSnippet: string | null
  tasksChecklist: Array<{ label: string; done: boolean }>
}

function readFile(p: string): string | null {
  try { return fs.readFileSync(p, 'utf-8') } catch { return null }
}

function fileMtimeMs(p: string): number | null {
  try { return fs.statSync(p).mtimeMs } catch { return null }
}

function detectStage(changeDir: string): PipelineStage {
  if (fs.existsSync(path.join(changeDir, 'verify-report.md'))) return 'verify'
  if (fs.existsSync(path.join(changeDir, 'tasks.md'))) return 'build'
  if (fs.existsSync(path.join(changeDir, 'spec.md'))) return 'plan'
  return 'propose'
}

function stageAnchorFile(stage: PipelineStage): string {
  if (stage === 'completed') return 'verify-report.md'
  if (stage === 'pr') return 'verify-report.md'
  if (stage === 'verify') return 'verify-report.md'
  if (stage === 'build') return 'tasks.md'
  if (stage === 'plan') return 'spec.md'
  return 'proposal.md'
}

function parseTasks(content: string): Array<{ label: string; done: boolean }> {
  const result: Array<{ label: string; done: boolean }> = []
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)/)
    if (!m) continue
    result.push({ label: m[2].trim(), done: m[1] !== ' ' })
  }
  return result
}

function extractPrUrl(verifyReport: string): string | null {
  const m = verifyReport.match(/https?:\/\/github\.com\/\S+\/pull\/\d+/)
  return m ? m[0] : null
}

function snippet(content: string, maxLen = 200): string | null {
  if (!content) return null
  const body = content.replace(/^#+[^\n]*\n/gm, '').replace(/\*\*/g, '').trim()
  return body.length > maxLen ? body.slice(0, maxLen) + '…' : body || null
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json([])

  const projectsDir = path.join(mcdDir, 'projects')
  let slugs: string[]
  try {
    slugs = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => d.name)
      .filter((s) => s !== '.archive' && s !== 'master')
  } catch {
    return Response.json([])
  }

  const cards: PipelineCard[] = []
  const nowMs = Date.now()

  for (const slug of slugs) {
    const realDir = (() => {
      const p = path.join(projectsDir, slug)
      try { return fs.realpathSync(p) } catch { return p }
    })()
    const changesDir = path.join(realDir, '.specclaw', 'changes')
    if (!fs.existsSync(changesDir)) continue

    let changeDirs: string[]
    try {
      changeDirs = fs.readdirSync(changesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch { continue }

    for (const changeName of changeDirs) {
      const changeDir = path.join(changesDir, changeName)
      let stage = detectStage(changeDir)

      const verifyContent = readFile(path.join(changeDir, 'verify-report.md'))
      const prUrl = verifyContent ? extractPrUrl(verifyContent) : null
      if (prUrl) stage = 'pr'

      const tasksContent = readFile(path.join(changeDir, 'tasks.md'))
      const tasksChecklist = tasksContent ? parseTasks(tasksContent) : []
      const tasksDone = tasksChecklist.filter((t) => t.done).length
      const tasksTotal = tasksChecklist.length

      // Completed: PR found + all tasks checked (or no tasks.md at all)
      if (prUrl && (tasksTotal === 0 || tasksDone === tasksTotal)) stage = 'completed'

      const anchorFile = path.join(changeDir, stageAnchorFile(stage))
      const anchorMtime = fileMtimeMs(anchorFile) ?? nowMs
      const daysInStage = Math.floor((nowMs - anchorMtime) / 86_400_000)

      // Last modification across all files in change dir
      let lastModifiedMs = anchorMtime
      try {
        for (const f of fs.readdirSync(changeDir)) {
          const mt = fileMtimeMs(path.join(changeDir, f)) ?? 0
          if (mt > lastModifiedMs) lastModifiedMs = mt
        }
      } catch {}

      const stalled = (stage === 'build' || stage === 'verify') && daysInStage >= 1

      const proposalContent = readFile(path.join(changeDir, 'proposal.md'))
      const proposalSnippet = proposalContent ? snippet(proposalContent) : null

      cards.push({
        slug,
        name: changeName,
        stage,
        daysInStage,
        lastModifiedMs,
        stalled,
        tasksDone,
        tasksTotal,
        prUrl,
        proposalSnippet,
        tasksChecklist,
      })
    }
  }

  // Sort by last modified desc
  cards.sort((a, b) => b.lastModifiedMs - a.lastModifiedMs)

  return Response.json(cards)
}

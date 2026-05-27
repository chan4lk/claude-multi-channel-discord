import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

type ChangePhase = 'propose' | 'plan' | 'build' | 'verify' | 'pr'
type ChangeStatus = 'active' | 'failed'

interface ChangeRow {
  name: string
  phase: ChangePhase
  tasksDone: number
  tasksTotal: number
  status: ChangeStatus
}

interface ProjectSpecclaw {
  slug: string
  changes: ChangeRow[]
}

// Map emoji to phase
function emojiToPhase(emoji: string): ChangePhase {
  if (emoji === '📝') return 'propose'
  if (emoji === '📋') return 'plan'
  if (emoji === '🔨') return 'build'
  if (emoji === '🔍') return 'verify'
  if (emoji === '🔀') return 'pr'
  return 'build'
}

function parseStatusMd(content: string): ChangeRow[] {
  const rows: ChangeRow[] = []
  // Match lines like: - 🔨 **change-name** — 4/10 tasks (40%) | 0 failed
  const lineRe = /^- (✅|🔨|📋|📝|🔍|🔀|❌)\s+\*\*(.+?)\*\*/
  const countRe = /(\d+)\/(\d+)\s+tasks/
  const failRe = /(\d+)\s+failed/

  for (const line of content.split('\n')) {
    const m = line.match(lineRe)
    if (!m) continue
    const emoji = m[1]
    const name = m[2]

    // Skip completed
    if (emoji === '✅') continue

    const countM = line.match(countRe)
    const tasksDone = countM ? parseInt(countM[1], 10) : 0
    const tasksTotal = countM ? parseInt(countM[2], 10) : 0

    const failM = line.match(failRe)
    const failed = failM ? parseInt(failM[1], 10) : 0

    rows.push({
      name,
      phase: emojiToPhase(emoji),
      tasksDone,
      tasksTotal,
      status: failed > 0 ? 'failed' : 'active',
    })
  }
  return rows
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json([])

  const projectsDir = path.join(mcdDir, 'projects')
  let slugs: string[]
  try {
    slugs = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return Response.json([])
  }

  const result: ProjectSpecclaw[] = []

  for (const slug of slugs) {
    const statusPath = path.join(projectsDir, slug, '.specclaw', 'STATUS.md')
    try {
      const content = fs.readFileSync(statusPath, 'utf-8')
      const changes = parseStatusMd(content)
      if (changes.length > 0) {
        result.push({ slug, changes })
      }
    } catch {
      // No STATUS.md or unreadable — skip
    }
  }

  return Response.json(result)
}

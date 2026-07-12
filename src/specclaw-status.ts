import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface SpecclawStatus {
  present: boolean
  activeChange?: string
  phase?: string
  tasksDone?: number
  tasksTotal?: number
  failedTasks?: number
  pendingProposals?: number
}

export function readSpecclawStatus(projectCwd: string): SpecclawStatus {
  const dashboardPath = join(projectCwd, '.specclaw', 'STATUS.md')
  let content: string
  try {
    content = readFileSync(dashboardPath, 'utf8')
  } catch {
    return { present: false }
  }

  const lines = content.split('\n')

  let activeChange: string | undefined
  let tasksDone: number | undefined
  let tasksTotal: number | undefined
  let failedTasks: number | undefined
  let pendingProposals: number | undefined

  // Find Active Changes section and parse 🔨 entries
  let inActiveChanges = false
  let inPendingProposals = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('## ')) {
      inActiveChanges = trimmed === '## Active Changes'
      inPendingProposals = trimmed === '## Pending Proposals'
      continue
    }

    if (inActiveChanges && trimmed.startsWith('- 🔨') && activeChange === undefined) {
      // - 🔨 **name** — 3/8 tasks (38%) | 1 failed
      const nameMatch = trimmed.match(/\*\*([^*]+)\*\*/)
      if (nameMatch) {
        activeChange = nameMatch[1]
        const countsMatch = trimmed.match(/(\d+)\/(\d+)\s+tasks/)
        if (countsMatch) {
          tasksDone = parseInt(countsMatch[1], 10)
          tasksTotal = parseInt(countsMatch[2], 10)
        }
        const failedMatch = trimmed.match(/\|\s*(\d+)\s+failed/)
        if (failedMatch) {
          failedTasks = parseInt(failedMatch[1], 10)
        }
      }
    }

    if (inPendingProposals && trimmed.startsWith('- 📋')) {
      pendingProposals = (pendingProposals ?? 0) + 1
    }
  }

  const result: SpecclawStatus = { present: true }
  if (activeChange !== undefined) result.activeChange = activeChange
  if (tasksDone !== undefined) result.tasksDone = tasksDone
  if (tasksTotal !== undefined) result.tasksTotal = tasksTotal
  if (failedTasks !== undefined) result.failedTasks = failedTasks
  if (pendingProposals !== undefined) result.pendingProposals = pendingProposals

  // FR3: resolve phase from change's status.md
  if (activeChange !== undefined) {
    const changePath = join(projectCwd, '.specclaw', 'changes', activeChange, 'status.md')
    let changeContent: string
    try {
      changeContent = readFileSync(changePath, 'utf8')
    } catch {
      return result
    }

    const changeLines = changeContent.split('\n')
    const progressIdx = changeLines.findIndex(l => l.trim() === '## Progress')
    if (progressIdx !== -1) {
      for (let i = progressIdx + 1; i < changeLines.length; i++) {
        const cl = changeLines[i].trim()
        if (!cl) continue
        if (!cl.startsWith('|')) break

        const cols = cl.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
        if (cols.length < 2) continue

        const phase = cols[0]
        const status = cols[1]

        if (!phase || phase.startsWith('-') || phase.toLowerCase() === 'phase') continue
        if (phase.toLowerCase() === 'proposal') continue

        if (!status.includes('🟢') && !status.includes('✅')) {
          result.phase = phase.toLowerCase()
          break
        }
      }
    }
  }

  return result
}

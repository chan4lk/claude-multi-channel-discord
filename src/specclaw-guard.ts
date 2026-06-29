import * as fs from 'fs'
import * as path from 'path'

export interface GuardResult {
  ok: boolean
  blockedBy: string[]
}

export function checkPipelineGreen(projectCwd: string): GuardResult {
  const statusFile = path.join(projectCwd, '.specclaw', 'STATUS.md')

  if (!fs.existsSync(statusFile)) {
    return { ok: true, blockedBy: [] }
  }

  const content = fs.readFileSync(statusFile, 'utf8')
  const lines = content.split('\n')

  const progressIdx = lines.findIndex(l => l.trim() === '## Progress')
  if (progressIdx === -1) {
    return { ok: true, blockedBy: [] }
  }

  const blockedBy: string[] = []

  for (let i = progressIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    if (!line.startsWith('|')) break

    const cols = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
    if (cols.length < 2) continue

    const phase = cols[0]
    const status = cols[1]

    if (!phase || phase.startsWith('-') || phase.toLowerCase() === 'phase') continue
    if (phase.toLowerCase() === 'proposal') continue

    if (!status.includes('🟢')) {
      blockedBy.push(phase)
    }
  }

  return { ok: blockedBy.length === 0, blockedBy }
}

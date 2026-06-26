import * as fs from 'node:fs'
import * as path from 'node:path'
import { evaluateClarity } from './spec-clarity.ts'

export interface ClarityWarningRecord {
  slug: string
  proposalName: string
  warnedAt: string    // ISO timestamp
  gaps: string[]
  score: number
}

/**
 * Scan a project's GOALS.md for new `[ ]` pending proposals.
 * For each pending proposal that hasn't been warned yet:
 *   - Evaluate clarity
 *   - If large && score < 60: return a warning record
 * Returns warnings that should be posted to Discord.
 * Persists warning state in `.specclaw/changes/<name>/clarity-pending.json`.
 */
export function scanGoalsForClarityWarnings(
  projectCwd: string,
  goalsPath: string,
): ClarityWarningRecord[] {
  const warnings: ClarityWarningRecord[] = []

  let goalsText = ''
  try { goalsText = fs.readFileSync(goalsPath, 'utf-8') } catch { return [] }

  // Extract pending proposal names from ## Proposals section
  const proposalsSection = goalsText.split('## Proposals')[1] ?? ''
  const pendingLines = proposalsSection.split('\n').filter((l) => l.startsWith('- [ ]'))

  for (const line of pendingLines) {
    // Extract name: "- [ ] some-proposal-name"
    const nameMatch = line.match(/^- \[ \]\s+(.+)$/)
    if (!nameMatch) continue
    const proposalName = nameMatch[1]!.trim()

    // Check for existing warning sidecar
    const warningFile = path.join(projectCwd, '.specclaw', 'changes', proposalName, 'clarity-pending.json')
    if (fs.existsSync(warningFile)) {
      // Check if 24h has passed → auto-proceed (just remove the sidecar)
      try {
        const record = JSON.parse(fs.readFileSync(warningFile, 'utf-8')) as ClarityWarningRecord
        const age = Date.now() - Date.parse(record.warnedAt)
        if (age > 24 * 60 * 60 * 1000) {
          fs.rmSync(warningFile, { force: true })
          // Auto-proceed: no warning returned, change can continue
        }
      } catch { /* skip malformed */ }
      continue  // already warned this proposal
    }

    // Try to read proposal.md for the change
    const proposalFile = path.join(projectCwd, '.specclaw', 'changes', proposalName, 'proposal.md')
    let proposalText = ''
    try { proposalText = fs.readFileSync(proposalFile, 'utf-8') } catch { continue }

    const result = evaluateClarity(proposalText)
    if (!result.isLarge || result.score >= 60) continue

    // Write warning sidecar
    const record: ClarityWarningRecord = {
      slug: path.basename(projectCwd),
      proposalName,
      warnedAt: new Date().toISOString(),
      gaps: result.gaps,
      score: result.score,
    }
    try {
      fs.mkdirSync(path.join(projectCwd, '.specclaw', 'changes', proposalName), { recursive: true })
      fs.writeFileSync(warningFile, JSON.stringify(record, null, 2))
    } catch { /* non-fatal */ }

    warnings.push(record)
  }

  return warnings
}

/**
 * Format a clarity warning for Discord display.
 */
export function formatClarityWarning(record: ClarityWarningRecord): string {
  return [
    `⚠️ **Spec clarity warning: \`${record.proposalName}\`** (${record.slug})`,
    `Score: ${record.score}/100 — large proposal needs clearer spec.`,
    `Gaps: ${record.gaps.map((g) => `\`${g}\``).join(', ')}`,
    `Reply here to start \`specclaw:spec-author\` interactively, or wait 24h to auto-proceed.`,
  ].join('\n')
}

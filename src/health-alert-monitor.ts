/**
 * Evaluates project health scores on a periodic interval and posts alerts to
 * the master channel when a project's score drops below its configured
 * threshold for two consecutive ticks. Hysteresis: no repeat until the score
 * recovers above threshold + 5.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { loadConfig } from './channels-config.ts'

function mcdDir(): string {
  return process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
}

function getRealProjectPath(mcdDir: string, slug: string): string | null {
  try { return fs.realpathSync(path.join(mcdDir, 'projects', slug)) } catch { return null }
}

function getTranscriptDir(realPath: string): string {
  const encoded = realPath.replace(/[^a-zA-Z0-9]/g, '-')
  return path.join(os.homedir(), '.claude', 'projects', encoded)
}

function countMemoryFiles(realPath: string): number {
  const memDir = path.join(realPath, 'memory')
  try {
    return fs.readdirSync(memDir).filter((f) => f.endsWith('.md') && !f.startsWith('MEMORY')).length
  } catch { return 0 }
}

function getSessionData(transcriptDir: string): { sessions: number; lastActiveMsAgo: number | null } {
  let sessions = 0
  let lastModifiedMs: number | null = null
  try {
    const files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
    sessions = files.length
    for (const f of files) {
      try {
        const stat = fs.statSync(path.join(transcriptDir, f))
        if (lastModifiedMs === null || stat.mtimeMs > lastModifiedMs) lastModifiedMs = stat.mtimeMs
      } catch { /* skip */ }
    }
  } catch { /* dir missing */ }
  return { sessions, lastActiveMsAgo: lastModifiedMs !== null ? Date.now() - lastModifiedMs : null }
}

function countRecentKills(dir: string, slug: string, windowMs: number): number {
  const logPath = path.join(dir, 'projects', slug, 'watchdog-kills.jsonl')
  let raw = ''
  try { raw = fs.readFileSync(logPath, 'utf-8') } catch { return 0 }
  const cutoff = Date.now() - windowMs
  let count = 0
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line) as { ts?: string }
      if (ev.ts && new Date(ev.ts).getTime() >= cutoff) count++
    } catch { /* skip */ }
  }
  return count
}

function countOpenProposals(realPath: string): number {
  const specclaw = path.join(realPath, '.specclaw', 'changes')
  let open = 0
  try {
    const changes = fs.readdirSync(specclaw)
    for (const ch of changes) {
      const proposalMd = path.join(specclaw, ch, 'proposal.md')
      const verifyReport = path.join(specclaw, ch, 'verify-report.md')
      if (fs.existsSync(proposalMd) && !fs.existsSync(verifyReport)) open++
    }
  } catch { /* no .specclaw */ }
  return open
}

interface ScoreBreakdown {
  memoryScore: number
  activityScore: number
  recencyScore: number
  stabilityScore: number
  proposalScore: number
}

function computeScore(
  memoryFiles: number,
  sessions: number,
  lastActiveDaysAgo: number | null,
  recentKills: number,
  openProposals: number,
): { score: number; breakdown: ScoreBreakdown } {
  const memoryScore = Math.round(Math.min(memoryFiles / 20, 1) * 25)
  const activityScore = sessions === 0 ? 0 : Math.round(10 + Math.min((sessions - 1) / 49, 1) * 15)
  let recencyScore = 0
  if (lastActiveDaysAgo !== null) {
    if (lastActiveDaysAgo <= 1) recencyScore = 20
    else if (lastActiveDaysAgo <= 7) recencyScore = 15
    else if (lastActiveDaysAgo <= 30) recencyScore = 8
    else if (lastActiveDaysAgo <= 90) recencyScore = 3
  }
  const stabilityScore = Math.max(0, 20 - recentKills * 5)
  const proposalScore = openProposals === 0 ? 5
    : openProposals <= 3 ? 10
    : openProposals <= 6 ? 8
    : 6
  const score = memoryScore + activityScore + recencyScore + stabilityScore + proposalScore
  return { score, breakdown: { memoryScore, activityScore, recencyScore, stabilityScore, proposalScore } }
}

interface AlertState {
  consecutiveBelowCount: number
  alertFired: boolean
  lastScore: number
  lastEvalAt: string
}

export interface AlertRule {
  slug: string
  threshold: number
  lastScore: number | null
  consecutiveBelowCount: number
  alertFired: boolean
  lastEvalAt: string | null
}

export type SendToMasterFn = (text: string) => Promise<void>

export class HealthAlertMonitor {
  private timer: ReturnType<typeof setInterval> | null = null
  private state: Map<string, AlertState> = new Map()
  private stateFile: string
  private log: (msg: string) => void

  constructor(
    private readonly sendToMaster: SendToMasterFn,
    opts?: { intervalMs?: number; log?: (msg: string) => void },
  ) {
    this.stateFile = path.join(mcdDir(), 'health-alert-state.json')
    this.log = opts?.log ?? ((m) => process.stderr.write(`[health-alert] ${m}\n`))
    this.loadState()
  }

  start(intervalMs = 5 * 60_000): void {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), intervalMs)
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  async tick(): Promise<void> {
    try {
      const cfg = loadConfig()
      const dir = mcdDir()
      const killWindow = 7 * 24 * 3_600_000

      for (const [chatId, project] of Object.entries(cfg.projects ?? {})) {
        const threshold = project.healthScoreThreshold
        if (typeof threshold !== 'number') continue

        const { slug } = project
        const realPath = getRealProjectPath(dir, slug)
        if (!realPath) continue

        const transcriptDir = getTranscriptDir(realPath)
        const memoryFiles = countMemoryFiles(realPath)
        const { sessions, lastActiveMsAgo } = getSessionData(transcriptDir)
        const recentKills = countRecentKills(dir, slug, killWindow)
        const openProposals = countOpenProposals(realPath)
        const lastActiveDaysAgo = lastActiveMsAgo !== null ? lastActiveMsAgo / (24 * 3_600_000) : null

        const { score, breakdown } = computeScore(memoryFiles, sessions, lastActiveDaysAgo, recentKills, openProposals)
        const state = this.state.get(chatId) ?? { consecutiveBelowCount: 0, alertFired: false, lastScore: score, lastEvalAt: '' }

        state.lastScore = score
        state.lastEvalAt = new Date().toISOString()

        if (score < threshold) {
          state.consecutiveBelowCount++
          // Fire alert after 2 consecutive below-threshold ticks if not already fired
          if (state.consecutiveBelowCount >= 2 && !state.alertFired) {
            const factors = [
              `memory ${breakdown.memoryScore}/25`,
              `activity ${breakdown.activityScore}/25`,
              `recency ${breakdown.recencyScore}/20`,
              `stability ${breakdown.stabilityScore}/20`,
              `proposals ${breakdown.proposalScore}/10`,
            ].sort((a, b) => {
              const valA = parseInt(a.split(' ')[1] ?? '0')
              const valB = parseInt(b.split(' ')[1] ?? '0')
              return valA - valB
            }).slice(0, 3)

            const msg = `⚠️ [${slug}] health score dropped to ${score}/${threshold} — top factors: ${factors.join(', ')}`
            this.log(`alert: ${msg}`)
            try {
              await this.sendToMaster(msg)
              state.alertFired = true
            } catch (err) {
              this.log(`send failed: ${String(err)}`)
            }
          }
        } else {
          // Recovery: clear fired state once score > threshold + 5 (hysteresis)
          if (score >= threshold + 5) {
            if (state.alertFired) {
              this.log(`${slug} recovered to ${score}, clearing alert state`)
            }
            state.consecutiveBelowCount = 0
            state.alertFired = false
          }
        }

        this.state.set(chatId, state)
      }

      this.saveState()
    } catch (err) {
      this.log(`tick error: ${String(err)}`)
    }
  }

  getRules(): AlertRule[] {
    try {
      const cfg = loadConfig()
      const dir = mcdDir()
      const killWindow = 7 * 24 * 3_600_000
      const rules: AlertRule[] = []

      for (const [chatId, project] of Object.entries(cfg.projects ?? {})) {
        const threshold = project.healthScoreThreshold
        if (typeof threshold !== 'number') continue

        const state = this.state.get(chatId)

        // Compute current score on-demand
        let lastScore: number | null = state?.lastScore ?? null
        if (lastScore === null) {
          const realPath = getRealProjectPath(dir, project.slug)
          if (realPath) {
            const transcriptDir = getTranscriptDir(realPath)
            const memoryFiles = countMemoryFiles(realPath)
            const { sessions, lastActiveMsAgo } = getSessionData(transcriptDir)
            const recentKills = countRecentKills(dir, project.slug, killWindow)
            const openProposals = countOpenProposals(realPath)
            const lastActiveDaysAgo = lastActiveMsAgo !== null ? lastActiveMsAgo / (24 * 3_600_000) : null
            const { score } = computeScore(memoryFiles, sessions, lastActiveDaysAgo, recentKills, openProposals)
            lastScore = score
          }
        }

        rules.push({
          slug: project.slug,
          threshold,
          lastScore,
          consecutiveBelowCount: state?.consecutiveBelowCount ?? 0,
          alertFired: state?.alertFired ?? false,
          lastEvalAt: state?.lastEvalAt ?? null,
        })
      }

      return rules
    } catch { return [] }
  }

  private loadState(): void {
    try {
      const raw = fs.readFileSync(this.stateFile, 'utf-8')
      const data = JSON.parse(raw) as Record<string, AlertState>
      for (const [k, v] of Object.entries(data)) this.state.set(k, v)
    } catch { /* fresh start */ }
  }

  private saveState(): void {
    try {
      const data: Record<string, AlertState> = {}
      for (const [k, v] of this.state.entries()) data[k] = v
      const tmp = this.stateFile + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
      fs.renameSync(tmp, this.stateFile)
    } catch { /* non-fatal */ }
  }
}

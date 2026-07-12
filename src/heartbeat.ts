import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ChannelsConfig } from './channels-config.ts'
import { projectDir } from './paths.ts'

export type ChannelState = {
  slug: string
  state: 'idle' | 'stalled'
  reason: 'active' | 'no-transcript' | 'question-unanswered' | 'tool-incomplete' | 'schedule-wakeup-loop' | 'ok'
  snippet: string
  ageMins: number
  detail: string
}

export type ScanReport = {
  idle: string[]       // slugs that are idle/ok
  stalled: ChannelState[]
}

export type AttentionSeverity = 'blocked' | 'review' | 'info'
export type AttentionItem = {
  slug: string
  chatId: string
  severity: AttentionSeverity
  kind: 'question-unanswered' | 'tool-incomplete' | 'schedule-wakeup-loop' | 'circuit-open' | 'schedule-noop-loop' | 'specclaw-idle'
  summary: string
  action?: string
  detail?: string
}

export type AttentionDeps = {
  getCircuitStates?: () => Map<string, { circuitOpen: boolean; backoffUntil?: number }>
  loadSchedules?: () => { schedules: Array<{ id: string; chatId: string; enabled: boolean; runCount: number }> }
  readSpecclawStatus?: (projectCwd: string) => { present: boolean; activeChange?: string; phase?: string; tasksDone?: number; tasksTotal?: number }
}

function encodeProjectCwd(cwd: string): string {
  let real = cwd
  try {
    real = realpathSync(cwd)
  } catch {}
  return real.replace(/[^a-zA-Z0-9]/g, '-')
}

export function inWindow(window: string): boolean {
  const [start, end] = window.split('-')
  const now = new Date()
  const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes()
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const startMins = sh * 60 + sm
  const endMins = eh * 60 + em
  return startMins <= endMins
    ? nowMins >= startMins && nowMins < endMins
    : nowMins >= startMins || nowMins < endMins
}

function fmtAge(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export function scanOne(slug: string, config: ChannelsConfig): { state: ChannelState; trailingSchedulerMsgs: number } {
  // Find project entry by slug
  const projectEntry = Object.values(config.projects).find(p => p.slug === slug)

  // Get project cwd
  let cwd = projectDir(slug)
  try {
    cwd = realpathSync(cwd)
  } catch {}

  // Find transcript dir
  const transcriptDir = join(homedir(), '.claude', 'projects', encodeProjectCwd(cwd))

  // List .jsonl files
  let jsonlFiles: string[]
  try {
    jsonlFiles = readdirSync(transcriptDir).filter(f => f.endsWith('.jsonl'))
  } catch {
    jsonlFiles = []
  }

  if (jsonlFiles.length === 0) {
    return { state: { slug, state: 'idle', reason: 'no-transcript', snippet: '', ageMins: 0, detail: '' }, trailingSchedulerMsgs: 0 }
  }

  // Pick latest by mtime
  let latestFile = jsonlFiles[0]
  let latestMtime = 0
  for (const file of jsonlFiles) {
    const mtime = statSync(join(transcriptDir, file)).mtimeMs
    if (mtime > latestMtime) {
      latestMtime = mtime
      latestFile = file
    }
  }

  // Check if active (written within last 30s)
  if (Date.now() - latestMtime < 30_000) {
    return { state: { slug, state: 'idle', reason: 'active', snippet: '', ageMins: 0, detail: '' }, trailingSchedulerMsgs: 0 }
  }

  const staleAfterMinutes = projectEntry?.heartbeat?.staleAfterMinutes ?? 60
  const ageMins = Math.floor((Date.now() - latestMtime) / 60_000)

  // Read last 200 lines
  const filePath = join(transcriptDir, latestFile)
  let lines: string[]
  try {
    lines = readFileSync(filePath, 'utf8').split('\n')
  } catch {
    return { state: { slug, state: 'idle', reason: 'ok', snippet: '', ageMins, detail: '' }, trailingSchedulerMsgs: 0 }
  }

  const last200 = lines.filter(l => l.trim() !== '').slice(-200)

  // Parse entries
  type Entry = Record<string, unknown>
  const entries: Entry[] = []
  for (const line of last200) {
    try {
      entries.push(JSON.parse(line) as Entry)
    } catch {
      // skip unparseable lines
    }
  }

  // Helper to get role/content from an entry (both flat and nested shapes)
  function getRole(entry: Entry): string | undefined {
    const msg = entry.message as Entry | undefined
    if (msg && typeof msg.role === 'string') return msg.role
    if (typeof entry.role === 'string') return entry.role
    return undefined
  }
  function getContent(entry: Entry): unknown[] {
    const msg = entry.message as Entry | undefined
    if (msg && Array.isArray(msg.content)) return msg.content as unknown[]
    if (Array.isArray(entry.content)) return entry.content as unknown[]
    return []
  }

  // Extract text from user entry content (plain string OR array of blocks)
  function getUserText(entry: Entry): string {
    const msg = entry.message as Entry | undefined
    const rawContent = (msg?.content ?? entry.content)
    if (typeof rawContent === 'string') return rawContent
    if (Array.isArray(rawContent)) {
      let text = ''
      for (const item of rawContent as unknown[]) {
        if (typeof item === 'string') {
          text += item
        } else if (typeof item === 'object' && item !== null) {
          const block = item as Record<string, unknown>
          if (block.type === 'text' && typeof block.text === 'string') {
            text += block.text
          }
        }
      }
      return text
    }
    return ''
  }

  // Count trailing scheduler-originated user entries
  let trailingSchedulerMsgs = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    const role = getRole(entries[i])
    if (role !== 'user') continue
    const text = getUserText(entries[i])
    const isScheduler = text.includes('user_id="__mcd_scheduler__"') || text.includes('message_id="sched-')
    if (isScheduler) {
      trailingSchedulerMsgs++
    } else {
      // Non-scheduler user entry resets/terminates the count
      break
    }
  }

  // Check tool-incomplete
  const toolUseIds = new Map<string, string>() // tool_use_id → tool name
  const toolResultIds = new Set<string>()

  for (const entry of entries) {
    const content = getContent(entry)
    for (const item of content) {
      if (typeof item !== 'object' || item === null) continue
      const block = item as Record<string, unknown>
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        const name = typeof block.name === 'string' ? block.name : ''
        toolUseIds.set(block.id, name)
      }
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        toolResultIds.add(block.tool_use_id)
      }
    }
  }

  let stalledReason: ChannelState['reason'] | null = null
  let snippet = ''
  let detail = ''

  for (const [id, name] of toolUseIds.entries()) {
    if (!toolResultIds.has(id)) {
      stalledReason = 'tool-incomplete'
      snippet = `${name} ${id}`.slice(0, 40)
      break
    }
  }

  // Check schedule-wakeup-loop: last 3+ tool_use entries all ScheduleWakeup with no mcp__mcd__reply between them
  if (stalledReason === null) {
    const toolNames: string[] = []
    for (const entry of entries) {
      const content = getContent(entry)
      for (const item of content) {
        if (typeof item !== 'object' || item === null) continue
        const block = item as Record<string, unknown>
        if (block.type === 'tool_use' && typeof block.name === 'string') {
          toolNames.push(block.name)
        }
      }
    }
    // Walk tool names in reverse, count consecutive ScheduleWakeup with no mcp__mcd__reply between
    let wakeupCount = 0
    for (let i = toolNames.length - 1; i >= 0; i--) {
      const name = toolNames[i]
      if (name === 'ScheduleWakeup') {
        wakeupCount++
      } else if (name === 'mcp__mcd__reply') {
        break
      } else {
        wakeupCount = 0
        break
      }
    }
    if (wakeupCount >= 3 && ageMins >= 120) {
      stalledReason = 'schedule-wakeup-loop'
      snippet = `${wakeupCount} consecutive ScheduleWakeup calls`
    }
  }

  // Check question-unanswered (only if not already stalled)
  if (stalledReason === null) {
    let lastAssistantIdx = -1
    let lastAssistantHasQuestion = false
    let lastAssistantSnippet = ''
    let lastAssistantDetail = ''

    for (let i = 0; i < entries.length; i++) {
      const role = getRole(entries[i])
      if (role === 'assistant') {
        const content = getContent(entries[i])
        let text = ''
        for (const item of content) {
          if (typeof item === 'string') {
            text += item
          } else if (typeof item === 'object' && item !== null) {
            const block = item as Record<string, unknown>
            if (block.type === 'text' && typeof block.text === 'string') {
              text += block.text
            }
          }
        }
        if (text.includes('?')) {
          lastAssistantIdx = i
          lastAssistantHasQuestion = true
          lastAssistantSnippet = text.slice(0, 80)
          lastAssistantDetail = text.replace(/\n+/g, ' ').slice(0, 300)
        }
      }
    }

    if (lastAssistantHasQuestion && lastAssistantIdx >= 0) {
      // Check if any user entry follows
      let hasSubsequentUser = false
      for (let i = lastAssistantIdx + 1; i < entries.length; i++) {
        if (getRole(entries[i]) === 'user') {
          hasSubsequentUser = true
          break
        }
      }
      if (!hasSubsequentUser) {
        stalledReason = 'question-unanswered'
        snippet = lastAssistantSnippet
        detail = lastAssistantDetail
      }
    }
  }

  if (ageMins >= staleAfterMinutes && stalledReason !== null) {
    return { state: { slug, state: 'stalled', reason: stalledReason, snippet, ageMins, detail }, trailingSchedulerMsgs }
  }

  return { state: { slug, state: 'idle', reason: 'ok', snippet: '', ageMins, detail: '' }, trailingSchedulerMsgs }
}

export function classifyChannel(slug: string, config: ChannelsConfig): ChannelState {
  return scanOne(slug, config).state
}

export function buildAttentionReport(config: ChannelsConfig, deps: AttentionDeps = {}): AttentionItem[] {
  const items: AttentionItem[] = []

  // Load circuit states once (optional dep)
  const circuitStates = deps.getCircuitStates ? deps.getCircuitStates() : null

  // Load schedules once (optional dep)
  let schedules: Array<{ id: string; chatId: string; enabled: boolean; runCount: number }> | null = null
  if (deps.loadSchedules) {
    try {
      schedules = deps.loadSchedules().schedules
    } catch {
      // degrade silently
    }
  }

  for (const [chatId, project] of Object.entries(config.projects)) {
    const { slug } = project
    try {
      const { state, trailingSchedulerMsgs } = scanOne(slug, config)

      // Map stall reasons to attention items
      if (state.state === 'stalled') {
        const age = fmtAge(state.ageMins)
        if (state.reason === 'question-unanswered') {
          items.push({
            slug,
            chatId,
            severity: 'blocked',
            kind: 'question-unanswered',
            summary: `unanswered question, idle ${age}`,
            action: `reply in <#${chatId}>`,
            detail: state.detail || undefined,
          })
        } else if (state.reason === 'tool-incomplete') {
          items.push({
            slug,
            chatId,
            severity: 'review',
            kind: 'tool-incomplete',
            summary: `tool call incomplete (${state.snippet}), idle ${age}`,
            action: `!project stop ${slug}`,
          })
        } else if (state.reason === 'schedule-wakeup-loop') {
          items.push({
            slug,
            chatId,
            severity: 'review',
            kind: 'schedule-wakeup-loop',
            summary: `${state.snippet}, idle ${age}`,
            action: `!project stop ${slug}`,
          })
        }
      }

      // circuit-open detector
      if (circuitStates) {
        const cs = circuitStates.get(chatId)
        if (cs?.circuitOpen) {
          items.push({
            slug,
            chatId,
            severity: 'blocked',
            kind: 'circuit-open',
            summary: 'circuit breaker open — messages are being dropped',
            action: `!project stop ${slug} then send a message to respawn`,
          })
        }
      }

      // schedule-noop-loop detector
      if (schedules) {
        const projectSchedules = schedules.filter(s => s.chatId === chatId && s.enabled)
        for (const sched of projectSchedules) {
          if (trailingSchedulerMsgs >= 5) {
            items.push({
              slug,
              chatId,
              severity: 'review',
              kind: 'schedule-noop-loop',
              summary: `schedule ${sched.id} keeps firing with no operator activity (${sched.runCount} runs)`,
              action: `!project schedule pause ${sched.id} (or re-add with --stop-on-reply)`,
            })
          }
        }
      }

      // specclaw-idle detector
      if (deps.readSpecclawStatus) {
        try {
          const cwd = projectDir(slug)
          const ss = deps.readSpecclawStatus(cwd)
          const staleAfterMinutes = project.heartbeat?.staleAfterMinutes ?? 60
          if (
            ss.present &&
            ss.activeChange &&
            state.ageMins >= staleAfterMinutes &&
            state.reason !== 'active' &&
            state.reason !== 'no-transcript'
          ) {
            const age = fmtAge(state.ageMins)
            const phase = ss.phase ?? 'unknown'
            const tasksDone = ss.tasksDone ?? 0
            const tasksTotal = ss.tasksTotal ?? 0
            items.push({
              slug,
              chatId,
              severity: 'info',
              kind: 'specclaw-idle',
              summary: `specclaw change ${ss.activeChange} (${phase}, ${tasksDone}/${tasksTotal}) idle ${age}`,
            })
          }
        } catch {
          // degrade silently
        }
      }
    } catch {
      // per-channel try/catch: one bad channel never aborts the scan
    }
  }

  // Sort: blocked first, then review, then info; stable alphabetical by slug within severity
  const severityOrder: Record<AttentionSeverity, number> = { blocked: 0, review: 1, info: 2 }
  items.sort((a, b) => {
    const sd = severityOrder[a.severity] - severityOrder[b.severity]
    if (sd !== 0) return sd
    return a.slug.localeCompare(b.slug)
  })

  return items
}

export function scanChannels(config: ChannelsConfig): ScanReport {
  const idle: string[] = []
  const stalled: ChannelState[] = []
  for (const slug of Object.values(config.projects).map(p => p.slug)) {
    try {
      const cs = classifyChannel(slug, config)
      if (cs.state === 'stalled') stalled.push(cs)
      else idle.push(slug)
    } catch {
      idle.push(slug)  // don't crash the whole scan on one bad project
    }
  }
  return { idle, stalled }
}

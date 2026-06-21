import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export interface SpotlightTranscriptEntry {
  role: string
  content: string
}

export interface SpotlightMemory {
  id: number
  type: string
  content: string
}

export interface SpotlightSchedule {
  id: string
  at: string
  prompt: string
  enabled: boolean
  lastRunAt: string | null
}

export interface SpotlightGit {
  branch: string | null
  lastCommitSha: string | null
  lastCommitMessage: string | null
  lastCommitDate: string | null
}

export interface SpotlightSpecclaw {
  changeName: string
  phase: string
  tasksDone: number
  tasksTotal: number
}

export interface SpotlightResponse {
  slug: string
  state: string
  goalText: string | null
  transcriptEntries: SpotlightTranscriptEntry[]
  memoryCount: number
  memories: SpotlightMemory[]
  git: SpotlightGit
  specclaw: SpotlightSpecclaw | null
  schedules: SpotlightSchedule[]
  checkedAt: string
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findLatestJsonl(slug: string, mcdDir: string): string | null {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return null }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  let files: string[] = []
  try { files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl')) } catch { return null }
  if (!files.length) return null
  let latest = '', mtime = 0
  for (const f of files) {
    try {
      const m = fs.statSync(path.join(transcriptDir, f)).mtimeMs
      if (m > mtime) { mtime = m; latest = path.join(transcriptDir, f) }
    } catch {}
  }
  return latest || null
}

function getTranscriptSnippets(slug: string, mcdDir: string): SpotlightTranscriptEntry[] {
  const file = findLatestJsonl(slug, mcdDir)
  if (!file) return []
  let content = ''
  try { content = fs.readFileSync(file, 'utf-8') } catch { return [] }
  const lines = content.trim().split('\n').filter(Boolean).reverse()
  const entries: SpotlightTranscriptEntry[] = []
  for (const line of lines) {
    if (entries.length >= 3) break
    try {
      const rec = JSON.parse(line) as Record<string, unknown>
      if (rec.type !== 'message') continue
      const msg = rec as { type: string; message?: { role?: string; content?: unknown } }
      const role = msg.message?.role ?? 'unknown'
      if (role !== 'assistant' && role !== 'user') continue
      const contentVal = msg.message?.content
      let text = ''
      if (typeof contentVal === 'string') {
        text = contentVal.trim()
      } else if (Array.isArray(contentVal)) {
        for (const block of contentVal) {
          if (typeof block === 'object' && block !== null) {
            const b = block as { type?: string; text?: string }
            if (b.type === 'text' && b.text) { text = b.text.trim(); break }
          }
        }
      }
      if (!text) continue
      entries.push({ role: String(role), content: text.slice(0, 200) })
    } catch {}
  }
  return entries
}

function getMemories(slug: string, mcdDir: string): { count: number; top: SpotlightMemory[] } {
  // Try memory.db via MEMORY.md markdown file approach
  const memFile = path.join(mcdDir, 'projects', slug, 'memory', 'MEMORY.md')
  if (fs.existsSync(memFile)) {
    try {
      const content = fs.readFileSync(memFile, 'utf-8')
      const lines = content.split('\n').filter((l) => l.startsWith('- ['))
      const top = lines.slice(0, 3).map((l, i) => ({
        id: i,
        type: 'user',
        content: l.replace(/^- \[/, '').replace(/\].*$/, ''),
      }))
      return { count: lines.length, top }
    } catch {}
  }
  // Fallback: memory dir files
  const memDir = path.join(mcdDir, 'projects', slug, 'memory')
  if (fs.existsSync(memDir)) {
    try {
      const files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')
      const top = files.slice(0, 3).map((f, i) => ({
        id: i,
        type: 'file',
        content: f.replace('.md', '').replace(/-/g, ' '),
      }))
      return { count: files.length, top }
    } catch {}
  }
  return { count: 0, top: [] }
}

function run(cmd: string, cwd: string): string {
  try { return execSync(cmd, { cwd, timeout: 3000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' }
}

function getGitInfo(slug: string, mcdDir: string): SpotlightGit {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch {}
  const gitDir = path.join(realPath, '.git')
  if (!fs.existsSync(gitDir)) return { branch: null, lastCommitSha: null, lastCommitMessage: null, lastCommitDate: null }
  const branch = run('git rev-parse --abbrev-ref HEAD', realPath) || null
  const sha = run('git log -1 --format=%h', realPath) || null
  const msg = run('git log -1 --format=%s', realPath) || null
  const date = run('git log -1 --format=%ci', realPath) || null
  return { branch, lastCommitSha: sha, lastCommitMessage: msg, lastCommitDate: date }
}

function getSpecclaw(slug: string, mcdDir: string): SpotlightSpecclaw | null {
  const statusFile = path.join(mcdDir, 'projects', slug, '.specclaw', 'STATUS.md')
  if (!fs.existsSync(statusFile)) return null
  try {
    const content = fs.readFileSync(statusFile, 'utf-8')
    const lineRe = /^- (🔨|📋|📝|🔍|🔀)\s+\*\*(.+?)\*\*/
    const phaseMap: Record<string, string> = {
      '📝': 'propose', '📋': 'plan', '🔨': 'build', '🔍': 'verify', '🔀': 'pr',
    }
    const countRe = /(\d+)\/(\d+)\s+tasks/
    for (const line of content.split('\n')) {
      const m = line.match(lineRe)
      if (!m) continue
      const countM = line.match(countRe)
      return {
        changeName: m[2],
        phase: phaseMap[m[1]] ?? 'build',
        tasksDone: countM ? parseInt(countM[1], 10) : 0,
        tasksTotal: countM ? parseInt(countM[2], 10) : 0,
      }
    }
    return null
  } catch { return null }
}

function getSchedules(slug: string, mcdDir: string): SpotlightSchedule[] {
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(path.join(mcdDir, 'channels.json'))
  if (!channels?.projects) return []
  const chatId = Object.entries(channels.projects).find(([, v]) => v.slug === slug)?.[0]
  if (!chatId) return []
  const data = readJson<{ schedules?: Array<Record<string, unknown>> }>(path.join(mcdDir, 'schedules.json'))
  if (!data?.schedules) return []
  return data.schedules
    .filter((s) => s.chatId === chatId || (s.slug as string) === slug)
    .slice(0, 3)
    .map((s) => ({
      id: String(s.id ?? ''),
      at: String(s.at ?? ''),
      prompt: String(s.prompt ?? '').slice(0, 80),
      enabled: Boolean(s.enabled ?? true),
      lastRunAt: s.lastRunAt ? String(s.lastRunAt) : null,
    }))
}

function getState(slug: string, mcdDir: string): string {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return 'idle' }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  let latestMtime = 0
  try {
    const files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
    for (const f of files) {
      try {
        const m = fs.statSync(path.join(transcriptDir, f)).mtimeMs
        if (m > latestMtime) latestMtime = m
      } catch {}
    }
  } catch {}
  const ageMins = latestMtime ? (Date.now() - latestMtime) / 60000 : Infinity
  if (ageMins < 2) return 'active'
  if (ageMins < 30) return 'idle'
  return 'idle'
}

function getGoal(slug: string, mcdDir: string): string | null {
  const goalFile = path.join(mcdDir, 'projects', slug, '.goal')
  if (fs.existsSync(goalFile)) {
    try { return fs.readFileSync(goalFile, 'utf-8').trim().slice(0, 200) } catch {}
  }
  return null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const transcriptEntries = getTranscriptSnippets(slug, mcdDir)
  const { count: memoryCount, top: memories } = getMemories(slug, mcdDir)
  const git = getGitInfo(slug, mcdDir)
  const specclaw = getSpecclaw(slug, mcdDir)
  const schedules = getSchedules(slug, mcdDir)
  const state = getState(slug, mcdDir)
  const goalText = getGoal(slug, mcdDir)

  const result: SpotlightResponse = {
    slug,
    state,
    goalText,
    transcriptEntries,
    memoryCount,
    memories,
    git,
    specclaw,
    schedules,
    checkedAt: new Date().toISOString(),
  }
  return Response.json(result)
}

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { upsertGoalAdvancement, getGoalAdvancementHistory } from '../../../src/db'

export const dynamic = 'force-dynamic'

export interface GoalRadarProject {
  slug: string
  goalText: string
  score: number // 0–100
  topKeywords: string[]
  history: Array<{ date: string; score: number }>
}

export interface GoalRadarResponse {
  projects: GoalRadarProject[]
  avgScore: number
  computedAt: string
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'that', 'this', 'it', 'its', 'they', 'we',
  'you', 'i', 'me', 'my', 'not', 'no', 'so', 'all', 'any', 'new', 'use',
  'when', 'which', 'what', 'there', 'here', 'now', 'just', 'also', 'some',
  'each', 'more', 'most', 'such', 'project', 'claude', 'file', 'code',
])

function extractKeywords(text: string): Map<string, number> {
  const freq = new Map<string, number>()
  for (const word of text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (word.length < 4 || STOP_WORDS.has(word)) continue
    freq.set(word, (freq.get(word) ?? 0) + 1)
  }
  return freq
}

function computeOverlap(goalKeywords: Map<string, number>, replyKeywords: Map<string, number>): {
  score: number
  topKeywords: string[]
} {
  if (goalKeywords.size === 0) return { score: 0, topKeywords: [] }

  let matched = 0
  const matchedKws: Array<{ word: string; freq: number }> = []

  for (const [word, goalFreq] of goalKeywords.entries()) {
    if (replyKeywords.has(word)) {
      matched += Math.min(goalFreq, replyKeywords.get(word)!)
      matchedKws.push({ word, freq: replyKeywords.get(word)! })
    }
  }

  const totalGoal = Array.from(goalKeywords.values()).reduce((a, b) => a + b, 0)
  const score = totalGoal > 0 ? Math.min(100, Math.round((matched / totalGoal) * 200)) : 0
  const topKeywords = matchedKws
    .sort((a, b) => b.freq - a.freq)
    .slice(0, 5)
    .map((k) => k.word)

  return { score, topKeywords }
}

function findLatestJsonl(slug: string, mcdDir: string): string | null {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return null }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    const files = fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    return files[0] ?? null
  } catch { return null }
}

function getLastNReplies(jsonlPath: string, n: number): string {
  let raw = ''
  try { raw = fs.readFileSync(jsonlPath, 'utf-8') } catch { return '' }

  const replies: string[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let entry: Record<string, unknown>
    try { entry = JSON.parse(line) } catch { continue }

    const role = entry.role ?? (entry.message as Record<string, unknown> | undefined)?.role
    if (role !== 'assistant') continue

    const content = (entry.message as Record<string, unknown> | undefined)?.content ?? entry.content
    let text = ''
    if (typeof content === 'string') text = content
    else if (Array.isArray(content)) {
      text = content
        .map((c: unknown) => (typeof c === 'object' && c !== null && 'text' in c ? (c as { text: string }).text : ''))
        .join(' ')
    }
    if (text) replies.push(text)
  }

  return replies.slice(-n).join(' ')
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channelsPath = path.join(mcdDir, 'channels.json')
  const today = new Date().toISOString().slice(0, 10)

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(channelsPath)
  const slugs: string[] = []
  if (channels?.projects) {
    for (const proj of Object.values(channels.projects)) {
      if (proj.slug && proj.slug !== 'master') slugs.push(proj.slug)
    }
  }

  // Also check projects dir
  const projectsDir = path.join(mcdDir, 'projects')
  try {
    for (const entry of fs.readdirSync(projectsDir)) {
      if (entry === 'master' || entry.startsWith('.')) continue
      if (!slugs.includes(entry)) slugs.push(entry)
    }
  } catch { /* ignore */ }

  const projects: GoalRadarProject[] = []

  for (const slug of slugs) {
    const goalPath = path.join(mcdDir, 'projects', slug, 'GOAL.md')
    let goalText = ''
    try { goalText = fs.readFileSync(goalPath, 'utf-8').trim() } catch { /* no goal file */ }

    if (!goalText) {
      projects.push({
        slug,
        goalText: '',
        score: 0,
        topKeywords: [],
        history: getGoalAdvancementHistory(slug, 7).map((r) => ({ date: r.date, score: r.score })),
      })
      continue
    }

    const goalKeywords = extractKeywords(goalText)

    const jsonlPath = findLatestJsonl(slug, mcdDir)
    let score = 0
    let topKeywords: string[] = []

    if (jsonlPath) {
      const replyText = getLastNReplies(jsonlPath, 20)
      const replyKeywords = extractKeywords(replyText)
      const result = computeOverlap(goalKeywords, replyKeywords)
      score = result.score
      topKeywords = result.topKeywords
    }

    upsertGoalAdvancement(slug, today, score)

    const history = getGoalAdvancementHistory(slug, 7).map((r) => ({ date: r.date, score: r.score }))

    projects.push({
      slug,
      goalText: goalText.slice(0, 300),
      score,
      topKeywords,
      history,
    })
  }

  const avgScore = projects.length > 0
    ? Math.round(projects.reduce((s, p) => s + p.score, 0) / projects.length)
    : 0

  return Response.json({
    projects,
    avgScore,
    computedAt: new Date().toISOString(),
  } satisfies GoalRadarResponse)
}

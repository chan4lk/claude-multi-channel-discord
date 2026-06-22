import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface BurnRateResponse {
  tokensPerMin: number
  activeProjects: number
  windowMs: number
  computedAt: string
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function findAllJsonl(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
      .sort()
  } catch { return [] }
}

function countTokensInWindow(slug: string, mcdDir: string, windowMs: number): number {
  const files = findAllJsonl(slug, mcdDir)
  const cutoff = Date.now() - windowMs
  let total = 0

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: { type?: string; timestamp?: string; message?: { usage?: { input_tokens?: number; output_tokens?: number } } }
      try { rec = JSON.parse(line) } catch { continue }
      if (!rec.timestamp) continue
      const tsMs = new Date(rec.timestamp).getTime()
      if (isNaN(tsMs) || tsMs < cutoff) continue
      const usage = rec.message?.usage
      if (!usage) continue
      total += (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
    }
  }

  return total
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({
      tokensPerMin: 0,
      activeProjects: 0,
      windowMs: 300000,
      computedAt: new Date().toISOString(),
    } satisfies BurnRateResponse)
  }

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const WINDOW_MS = 300_000 // 5 minutes
  let totalTokens = 0
  let activeProjects = 0

  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (!proj.slug) continue
      const tokens = countTokensInWindow(proj.slug, mcdDir, WINDOW_MS)
      if (tokens > 0) {
        activeProjects++
        totalTokens += tokens
      }
    }
  }

  const tokensPerMin = Math.round((totalTokens / WINDOW_MS) * 60_000)

  return Response.json({
    tokensPerMin,
    activeProjects,
    windowMs: WINDOW_MS,
    computedAt: new Date().toISOString(),
  } satisfies BurnRateResponse)
}

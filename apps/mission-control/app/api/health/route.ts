import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NextResponse } from 'next/server'
import { computeHealth, type HealthScore } from './[slug]/route'

export const dynamic = 'force-dynamic'

export interface HealthAggregateResponse {
  projects: HealthScore[]
  checkedAt: string
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function computeFleetMedianTpt(slugs: string[], mcdDir: string): number {
  const tpts: number[] = []
  for (const slug of slugs) {
    const projectPath = path.join(mcdDir, 'projects', slug)
    let realPath = projectPath
    try { realPath = fs.realpathSync(projectPath) } catch { continue }
    const encoded = encodeProjectCwd(realPath)
    const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
    let files: string[] = []
    try {
      files = fs.readdirSync(transcriptDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => path.join(transcriptDir, f))
    } catch { continue }

    let totalTokens = 0
    let totalTurns = 0
    for (const file of files) {
      let raw = ''
      try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
      for (const line of raw.trim().split('\n').filter(Boolean)) {
        let rec: Record<string, unknown>
        try { rec = JSON.parse(line) } catch { continue }
        if (rec.type !== 'assistant') continue
        totalTurns++
        const usage = (rec as { message?: { usage?: { input_tokens?: number; output_tokens?: number } } }).message?.usage
        totalTokens += (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)
      }
    }
    if (totalTurns > 0) tpts.push(totalTokens / totalTurns)
  }
  if (tpts.length === 0) return 0
  tpts.sort((a, b) => a - b)
  const mid = Math.floor(tpts.length / 2)
  return tpts.length % 2 === 0 ? (tpts[mid - 1] + tpts[mid]) / 2 : tpts[mid]
}

export async function GET() {
  const mcdDir = process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const channels = readJson<{
    projects?: Record<string, { slug: string }>
  }>(path.join(mcdDir, 'channels.json'))

  const projects = channels?.projects ?? {}
  const slugs = Object.values(projects).map((p) => p.slug).filter(Boolean)

  const fleetMedianTpt = computeFleetMedianTpt(slugs, mcdDir)

  const results: HealthScore[] = slugs.map((slug) =>
    computeHealth(slug, mcdDir, fleetMedianTpt)
  )

  return NextResponse.json({
    projects: results,
    checkedAt: new Date().toISOString(),
  } satisfies HealthAggregateResponse)
}

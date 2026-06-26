import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface TopBurner {
  slug: string
  model: string
  rate: number
}

export interface TokenTickerSnapshot {
  tokensPerMin: number
  topBurners: TopBurner[]
  projectedMonthly: number
  budgetPct: number
  generatedAt: string
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findJsonlFiles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return [] }
}

interface JsonlUsageLine {
  timestamp?: string
  message?: {
    role?: string
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
}

function countTokensInWindow(slug: string, mcdDir: string, windowMs: number): { tokens: number; model: string } {
  const files = findJsonlFiles(slug, mcdDir)
  const cutoff = Date.now() - windowMs
  let total = 0
  let model = 'unknown'
  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: JsonlUsageLine
      try { rec = JSON.parse(line) } catch { continue }
      if (!rec.timestamp || rec.message?.role !== 'assistant') continue
      const tsMs = new Date(rec.timestamp).getTime()
      if (isNaN(tsMs) || tsMs < cutoff) continue
      const u = rec.message?.usage
      if (!u) continue
      const t = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      if (t > 0) {
        total += t
        if (rec.message.model) model = rec.message.model
      }
    }
  }
  return { tokens: total, model }
}

function computeProjectedMonthly(slugs: string[], mcdDir: string): number {
  const SEVEN_DAYS_MS = 7 * 24 * 3_600_000
  let total7d = 0
  for (const slug of slugs) {
    const { tokens } = countTokensInWindow(slug, mcdDir, SEVEN_DAYS_MS)
    total7d += tokens
  }
  return Math.round((total7d / 7) * 30)
}

function buildSnapshot(mcdDir: string): TokenTickerSnapshot {
  const channels = readJson<{ projects?: Record<string, { slug?: string; model?: string }>; defaults?: { monthlyTokenBudget?: number } }>(
    path.join(mcdDir, 'channels.json')
  )

  const MONTHLY_BUDGET = channels?.defaults?.monthlyTokenBudget ?? 50_000_000

  const allSlugs: string[] = []
  const slugModelMap: Record<string, string> = {}
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug) {
        allSlugs.push(proj.slug)
        if (proj.model) slugModelMap[proj.slug] = proj.model
      }
    }
  }

  const WINDOW_MS = 60_000
  let fleetTokens = 0
  const burners: TopBurner[] = []

  for (const slug of allSlugs) {
    const { tokens, model } = countTokensInWindow(slug, mcdDir, WINDOW_MS)
    if (tokens > 0) {
      fleetTokens += tokens
      burners.push({
        slug,
        model: slugModelMap[slug] ?? model,
        rate: Math.round((tokens / WINDOW_MS) * 60_000),
      })
    }
  }

  burners.sort((a, b) => b.rate - a.rate)
  const topBurners = burners.slice(0, 3)
  const tokensPerMin = Math.round((fleetTokens / WINDOW_MS) * 60_000)
  const projectedMonthly = computeProjectedMonthly(allSlugs, mcdDir)
  const budgetPct = MONTHLY_BUDGET > 0 ? Math.min(100, Math.round((projectedMonthly / MONTHLY_BUDGET) * 100)) : 0

  return {
    tokensPerMin,
    topBurners,
    projectedMonthly,
    budgetPct,
    generatedAt: new Date().toISOString(),
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  if (url.searchParams.get('stream') === '1') {
    const encoder = new TextEncoder()
    let closed = false

    const stream = new ReadableStream({
      async start(controller) {
        function emit() {
          if (closed) return
          try {
            const snap = buildSnapshot(mcdDir)
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(snap)}\n\n`))
          } catch { /* continue */ }
        }

        emit()
        const interval = setInterval(emit, 5000)

        req.signal.addEventListener('abort', () => {
          closed = true
          clearInterval(interval)
          try { controller.close() } catch { /* already closed */ }
        })
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  return Response.json(buildSnapshot(mcdDir))
}

import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export interface ThemeBucket {
  theme: string
  total: number
  done: number
  pending: number
}

export interface ThemeProposal {
  number: number
  title: string
  status: 'done' | 'pending'
  theme: string
}

export interface ThemesResponse {
  themes: ThemeBucket[]
  proposals: ThemeProposal[]
  generatedAt: string
}

// Theme classification: ordered keyword rules. First match wins; falls back to 'other'.
const THEME_RULES: Array<{ theme: string; re: RegExp }> = [
  { theme: 'graph', re: /\b(graph|map|treemap|sankey|radar|constellation|galaxy|nexus|node|topology|flame)\b/i },
  { theme: 'memory', re: /\bmemor(y|ies)\b/i },
  { theme: 'scheduler', re: /\b(schedul|cron|calendar|tick|daily)\b/i },
  { theme: 'metrics', re: /\b(metric|burn|forecast|velocity|momentum|burndown|cost|token|score|trend)\b/i },
  { theme: 'alerts', re: /\b(alert|stall|stuck|anomal|watchdog|warn|notif)\b/i },
  { theme: 'git', re: /\b(git|branch|commit|pull|remote|pr|clone)\b/i },
  { theme: 'whatsapp', re: /\b(whatsapp|baileys|teams|platform)\b/i },
  { theme: 'ui', re: /\b(dashboard|panel|page|view|hud|nav|spotlight|drawer|tooltip|ux|theme)\b/i },
]

function classifyTheme(text: string): string {
  for (const rule of THEME_RULES) {
    if (rule.re.test(text)) return rule.theme
  }
  return 'other'
}

interface ParsedProposal {
  number: number
  title: string
  status: 'done' | 'pending'
  body: string
}

function parseBacklog(content: string): ParsedProposal[] {
  const proposals: ParsedProposal[] = []
  const headers = [...content.matchAll(/^## P(\d+)\s+—\s+(.+)$/gm)]
  const statusRe = /\*\*Status:\*\*\s+`\[([x ])\]\s+(done|pending)`/

  for (const match of headers) {
    const num = parseInt(match[1], 10)
    const title = match[2].trim()
    const idx = match.index!
    const nextIdx = content.indexOf('\n## P', idx + 1)
    const chunk = nextIdx > -1 ? content.slice(idx, nextIdx) : content.slice(idx)
    const statusMatch = statusRe.exec(chunk)
    const status: 'done' | 'pending' = statusMatch?.[1] === 'x' ? 'done' : 'pending'
    proposals.push({ number: num, title, status, body: chunk })
  }
  return proposals
}

export async function GET(): Promise<Response> {
  const repoRoot = path.join(process.cwd(), '..', '..')
  const backlogPath = path.join(repoRoot, 'BACKLOG.md')

  let content = ''
  try { content = fs.readFileSync(backlogPath, 'utf-8') } catch {
    return Response.json({ error: 'BACKLOG.md not found' }, { status: 404 })
  }

  const parsed = parseBacklog(content)
  const proposals: ThemeProposal[] = parsed.map((p) => ({
    number: p.number,
    title: p.title,
    status: p.status,
    // Classify on title + solution text for stronger signal than title alone.
    theme: classifyTheme(`${p.title} ${p.body}`),
  }))

  const byTheme = new Map<string, ThemeBucket>()
  for (const p of proposals) {
    let b = byTheme.get(p.theme)
    if (!b) { b = { theme: p.theme, total: 0, done: 0, pending: 0 }; byTheme.set(p.theme, b) }
    b.total += 1
    if (p.status === 'done') b.done += 1
    else b.pending += 1
  }

  const themes = [...byTheme.values()].sort((a, b) => b.total - a.total)

  return Response.json({
    themes,
    proposals: proposals.sort((a, b) => b.number - a.number),
    generatedAt: new Date().toISOString(),
  } satisfies ThemesResponse)
}

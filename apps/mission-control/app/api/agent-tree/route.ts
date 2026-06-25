import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface AgentNode {
  id: string
  toolName: string
  label: string          // Agent description or prompt snippet
  promptSnippet: string  // first 120 chars of prompt
  durationMs: number | null
  depth: number
  children: AgentNode[]
}

export interface TurnWithAgents {
  turnIndex: number
  ts: string
  userSnippet: string
  agentCalls: AgentNode[]
  totalAgents: number
  maxDepth: number
  estimatedTokens: number | null
}

export interface AgentTreeResponse {
  turns: TurnWithAgents[]
  slug: string
  slugs: string[]
  selectedTurn: number | null
  totalTurns: number
  generatedAt: string
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function findJsonlFiles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = realPath.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
      .sort()
  } catch { return [] }
}

interface ContentBlock {
  type: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: unknown
}

interface JsonlLine {
  role?: string
  content?: ContentBlock[] | string
  timestamp?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

function snippet(text: string, maxLen = 120): string {
  const s = text.replace(/\s+/g, ' ').trim()
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s
}

function extractAgentNodes(
  assistantBlocks: ContentBlock[],
  resultsByToolId: Map<string, string>,
  depth: number,
  parentId: string,
): AgentNode[] {
  const nodes: AgentNode[] = []

  for (const block of assistantBlocks) {
    if (block.type !== 'tool_use') continue
    if (block.name !== 'Agent' && block.name !== 'Task') continue

    const id = `${parentId}-${block.id ?? nodes.length}`
    const input = block.input ?? {}
    const promptText = (input.prompt as string | undefined) ?? ''
    const description = (input.description as string | undefined) ?? ''
    const label = description || snippet(promptText, 60)
    const resultText = block.id ? (resultsByToolId.get(block.id) ?? '') : ''

    // Try to extract nested agent calls from the result text (best-effort pattern matching)
    const children = parseNestedAgents(resultText, depth + 1, id)

    nodes.push({
      id,
      toolName: block.name ?? 'Agent',
      label,
      promptSnippet: snippet(promptText),
      durationMs: null,
      depth,
      children,
    })
  }

  return nodes
}

function parseNestedAgents(resultText: string, depth: number, parentId: string): AgentNode[] {
  if (depth > 3) return []
  // Look for patterns like "Agent called with description: X" or "subagent: X" in result
  const nodes: AgentNode[] = []
  const agentPatterns = [
    /spawned subagent[:\s]+["']?([^"'\n]{5,80})/gi,
    /Agent\(\s*\{[^}]*description[:\s]+["']([^"']{5,80})/gi,
  ]
  for (const pattern of agentPatterns) {
    let m: RegExpExecArray | null
    while ((m = pattern.exec(resultText)) !== null) {
      const label = m[1]?.trim() ?? ''
      if (!label) continue
      nodes.push({
        id: `${parentId}-nested-${nodes.length}`,
        toolName: 'Agent',
        label,
        promptSnippet: label,
        durationMs: null,
        depth,
        children: [],
      })
    }
  }
  return nodes
}

function maxDepth(nodes: AgentNode[]): number {
  if (nodes.length === 0) return 0
  return 1 + Math.max(...nodes.map((n) => maxDepth(n.children)))
}

function countAgents(nodes: AgentNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + countAgents(n.children), 0)
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const requestedSlug = url.searchParams.get('slug')
  const requestedTurn = url.searchParams.get('turn') ? parseInt(url.searchParams.get('turn')!, 10) : null

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(path.join(mcdDir, 'channels.json'))

  const allSlugs: string[] = []
  if (channels?.projects) {
    for (const proj of Object.values(channels.projects)) {
      if (proj.slug) allSlugs.push(proj.slug)
    }
  }

  const slug = requestedSlug ?? (allSlugs.includes('claude-mcd') ? 'claude-mcd' : allSlugs[0] ?? 'claude-mcd')
  const files = findJsonlFiles(slug, mcdDir)

  // Build turns: group assistant+tool_result pairs
  interface RawTurn {
    index: number
    ts: string
    userContent: string
    assistantBlocks: ContentBlock[]
    resultsByToolId: Map<string, string>
    estimatedTokens: number | null
  }

  const rawTurns: RawTurn[] = []
  let turnIndex = 0
  let pendingAssistant: { blocks: ContentBlock[]; ts: string; tokens: number | null } | null = null
  const pendingResults = new Map<string, string>()
  let currentUserSnippet = ''

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let msg: JsonlLine
      try { msg = JSON.parse(line) as JsonlLine } catch { continue }

      if (msg.role === 'user') {
        // Flush pending assistant turn
        if (pendingAssistant && pendingAssistant.blocks.some((b) => b.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task'))) {
          rawTurns.push({
            index: turnIndex++,
            ts: pendingAssistant.ts,
            userContent: currentUserSnippet,
            assistantBlocks: pendingAssistant.blocks,
            resultsByToolId: new Map(pendingResults),
            estimatedTokens: pendingAssistant.tokens,
          })
          pendingResults.clear()
        }
        pendingAssistant = null

        // Extract user text
        const content = msg.content
        if (typeof content === 'string') {
          currentUserSnippet = snippet(content, 80)
        } else if (Array.isArray(content)) {
          const text = content.find((b) => b.type === 'text' || (b.type === 'tool_result' && typeof b.content === 'string'))
          if (text) {
            currentUserSnippet = snippet(
              typeof text.content === 'string' ? text.content : '',
              80,
            )
          }
        }
      } else if (msg.role === 'assistant') {
        const blocks = Array.isArray(msg.content) ? msg.content : []
        const tokens = msg.usage
          ? (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0)
          : null
        if (pendingAssistant) {
          // Extend with more blocks (multi-step)
          pendingAssistant.blocks.push(...blocks)
          if (tokens !== null) {
            pendingAssistant.tokens = (pendingAssistant.tokens ?? 0) + tokens
          }
        } else {
          pendingAssistant = { blocks, ts: msg.timestamp ?? '', tokens }
        }
      } else if (msg.role === 'tool') {
        const content = Array.isArray(msg.content) ? msg.content : []
        for (const block of content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const resultContent = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content ?? '')
            pendingResults.set(block.tool_use_id, resultContent)
          }
        }
      }
    }
  }

  // Flush last pending
  if (pendingAssistant && pendingAssistant.blocks.some((b) => b.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task'))) {
    rawTurns.push({
      index: turnIndex++,
      ts: pendingAssistant.ts,
      userContent: currentUserSnippet,
      assistantBlocks: pendingAssistant.blocks,
      resultsByToolId: new Map(pendingResults),
      estimatedTokens: pendingAssistant.tokens,
    })
  }

  const allTurns: TurnWithAgents[] = rawTurns.map((rt) => {
    const agentCalls = extractAgentNodes(rt.assistantBlocks, rt.resultsByToolId, 0, `t${rt.index}`)
    return {
      turnIndex: rt.index,
      ts: rt.ts,
      userSnippet: rt.userContent,
      agentCalls,
      totalAgents: countAgents(agentCalls),
      maxDepth: maxDepth(agentCalls),
      estimatedTokens: rt.estimatedTokens,
    }
  })

  // Filter/paginate
  const filtered = requestedTurn !== null
    ? allTurns.filter((t) => t.turnIndex === requestedTurn)
    : allTurns.slice(-20)   // last 20 turns with agents

  return Response.json({
    turns: filtered,
    slug,
    slugs: allSlugs,
    selectedTurn: requestedTurn,
    totalTurns: allTurns.length,
    generatedAt: new Date().toISOString(),
  } satisfies AgentTreeResponse)
}

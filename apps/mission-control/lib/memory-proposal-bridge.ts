// P215 — Memory ⇄ Proposal Theme Bridge.
// Pure term-overlap logic shared by /api/memory-proposal-bridge and its test.
// Computes weighted links between memory descriptions and proposal titles/
// problem statements: the connection that was previously invisible between
// "what we learned" (memories) and "what we plan" (proposals).

// Short, common, or structural words that carry no theme signal.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'then',
  'each', 'have', 'has', 'are', 'was', 'were', 'will', 'would', 'should', 'could',
  'project', 'projects', 'proposal', 'proposals', 'memory', 'memories', 'add',
  'adds', 'added', 'show', 'shows', 'view', 'views', 'page', 'pages', 'fleet',
  'dashboard', 'operator', 'operators', 'every', 'over', 'their', 'they', 'them',
  'which', 'what', 'where', 'while', 'about', 'there', 'here', 'than', 'these',
  'those', 'some', 'such', 'only', 'also', 'each', 'per', 'via', 'one', 'two',
])

/**
 * Normalise free text into a set of comparable theme tokens: lowercase, split on
 * non-alphanumerics, drop stopwords and tokens shorter than 4 chars, and strip a
 * single trailing 's' so "schedules" ↔ "schedule" match.
 */
export function themeTokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4) continue
    const t = raw.endsWith('s') && raw.length > 4 ? raw.slice(0, -1) : raw
    if (STOPWORDS.has(t) || STOPWORDS.has(raw)) continue
    out.add(t)
  }
  return out
}

export interface BridgeMemory {
  id: string
  slug: string
  text: string // description / first line of memory content
  type?: string | null
}

export interface BridgeProposal {
  id: string
  slug: string
  title: string
  text: string // title + problem statement
}

export interface BridgeNode {
  id: string
  label: string
  slug: string
  side: 'memory' | 'proposal'
}

export interface BridgeEdge {
  source: string // memory node id
  target: string // proposal node id
  weight: number // count of shared theme terms
  terms: string[] // the matched terms driving the link
}

export interface BridgeGraph {
  memories: BridgeNode[]
  proposals: BridgeNode[]
  edges: BridgeEdge[]
  threshold: number
}

function truncate(s: string, max = 64): string {
  const t = s.trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

/**
 * Build the bipartite bridge graph. An edge is kept only when a memory and a
 * proposal share at least `minShared` theme terms (default 2). Nodes with no
 * surviving edge are dropped — the canvas shows only genuine overlaps.
 */
export function computeBridge(
  memories: BridgeMemory[],
  proposals: BridgeProposal[],
  minShared = 2,
): BridgeGraph {
  const threshold = Math.max(1, Math.floor(minShared))
  const memTokens = memories.map((m) => ({ m, tok: themeTokens(m.text) }))
  const propTokens = proposals.map((p) => ({ p, tok: themeTokens(p.text) }))

  const edges: BridgeEdge[] = []
  const usedMem = new Set<string>()
  const usedProp = new Set<string>()

  for (const { m, tok: mt } of memTokens) {
    if (mt.size === 0) continue
    for (const { p, tok: pt } of propTokens) {
      if (pt.size === 0) continue
      const shared: string[] = []
      for (const t of mt) if (pt.has(t)) shared.push(t)
      if (shared.length < threshold) continue
      shared.sort()
      edges.push({ source: m.id, target: p.id, weight: shared.length, terms: shared })
      usedMem.add(m.id)
      usedProp.add(p.id)
    }
  }

  edges.sort((a, b) => b.weight - a.weight)

  const memNodes: BridgeNode[] = memories
    .filter((m) => usedMem.has(m.id))
    .map((m) => ({ id: m.id, label: truncate(m.text), slug: m.slug, side: 'memory' }))
  const propNodes: BridgeNode[] = proposals
    .filter((p) => usedProp.has(p.id))
    .map((p) => ({ id: p.id, label: truncate(p.title), slug: p.slug, side: 'proposal' }))

  return { memories: memNodes, proposals: propNodes, edges, threshold }
}

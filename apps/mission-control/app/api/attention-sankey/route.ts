import { computeFindings } from '../../../lib/attention-findings'

export const dynamic = 'force-dynamic'

// P212 — Fleet Attention Sankey.
// Three-layer flow over the live attention engine: project → signal → severity.
// Link width = finding count. Healthy/`ok` findings are excluded so the diagram
// only shows attention-worthy flow.

export type SankeyNodeKind = 'project' | 'signal' | 'severity'

export interface SankeyNode {
  id: string // `${kind}:${name}`
  name: string
  kind: SankeyNodeKind
}

export interface SankeyLink {
  source: string // node id
  target: string // node id
  value: number // finding count
}

export interface AttentionSankeyResponse {
  nodes: SankeyNode[]
  links: SankeyLink[]
  findingCount: number
  projectCount: number
}

const isAttention = (signal: string, severity: string) => signal !== 'healthy' && severity !== 'ok'

export async function GET(): Promise<Response> {
  const empty: AttentionSankeyResponse = { nodes: [], links: [], findingCount: 0, projectCount: 0 }
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json(empty)

  const findings = (await computeFindings(mcdDir)).filter((f) => isAttention(f.signal, f.severity))
  if (findings.length === 0) return Response.json(empty)

  // Aggregate counts for both legs of the flow.
  const projSignal = new Map<string, number>() // `proj|signal`
  const signalSev = new Map<string, number>() // `signal|severity`
  const projects = new Set<string>()
  const signals = new Set<string>()
  const severities = new Set<string>()

  for (const f of findings) {
    projects.add(f.slug)
    signals.add(f.signal)
    severities.add(f.severity)
    const ps = `${f.slug}|${f.signal}`
    projSignal.set(ps, (projSignal.get(ps) ?? 0) + 1)
    const ss = `${f.signal}|${f.severity}`
    signalSev.set(ss, (signalSev.get(ss) ?? 0) + 1)
  }

  const nodes: SankeyNode[] = []
  for (const p of Array.from(projects).sort()) nodes.push({ id: `project:${p}`, name: p, kind: 'project' })
  for (const s of Array.from(signals).sort()) nodes.push({ id: `signal:${s}`, name: s, kind: 'signal' })
  // Severity ordered worst→least for a stable right column.
  const sevOrder = ['critical', 'warn', 'info']
  for (const s of sevOrder.filter((s) => severities.has(s))) nodes.push({ id: `severity:${s}`, name: s, kind: 'severity' })

  const links: SankeyLink[] = []
  for (const [key, value] of projSignal) {
    const [proj, signal] = key.split('|')
    links.push({ source: `project:${proj}`, target: `signal:${signal}`, value })
  }
  for (const [key, value] of signalSev) {
    const [signal, sev] = key.split('|')
    links.push({ source: `signal:${signal}`, target: `severity:${sev}`, value })
  }

  return Response.json({
    nodes,
    links,
    findingCount: findings.length,
    projectCount: projects.size,
  } satisfies AttentionSankeyResponse)
}

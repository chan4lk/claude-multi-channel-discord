import { getAlertFlow } from '../../../src/db'

export const dynamic = 'force-dynamic'

const DAYS_BACK = 30

export interface AlertFlowLink {
  slug: string
  alert_type: string
  count: number
}

export interface AlertFlowNode {
  id: string
  total: number
}

export interface AlertFlowResponse {
  // slug→type links, sorted by count desc
  links: AlertFlowLink[]
  // left column: one per project slug
  projects: AlertFlowNode[]
  // right column: one per alert type
  types: AlertFlowNode[]
  total: number
  dominant: { slug: string; alert_type: string; count: number } | null
}

export async function GET(): Promise<Response> {
  const sinceTs = Math.floor(Date.now() / 1000) - DAYS_BACK * 86400
  // Exclude acknowledged alerts so the flow reflects only active/handled-noise-free signal (P196).
  const rows = getAlertFlow(sinceTs, false)

  const projectTotals = new Map<string, number>()
  const typeTotals = new Map<string, number>()
  let total = 0
  let dominant: { slug: string; alert_type: string; count: number } | null = null

  for (const r of rows) {
    projectTotals.set(r.slug, (projectTotals.get(r.slug) ?? 0) + r.count)
    typeTotals.set(r.alert_type, (typeTotals.get(r.alert_type) ?? 0) + r.count)
    total += r.count
    if (dominant == null || r.count > dominant.count) {
      dominant = { slug: r.slug, alert_type: r.alert_type, count: r.count }
    }
  }

  const projects: AlertFlowNode[] = [...projectTotals.entries()]
    .map(([id, t]) => ({ id, total: t }))
    .sort((a, b) => b.total - a.total)
  const types: AlertFlowNode[] = [...typeTotals.entries()]
    .map(([id, t]) => ({ id, total: t }))
    .sort((a, b) => b.total - a.total)

  return Response.json({
    links: rows,
    projects,
    types,
    total,
    dominant,
  } satisfies AlertFlowResponse)
}

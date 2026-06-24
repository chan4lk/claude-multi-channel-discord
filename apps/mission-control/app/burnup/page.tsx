'use client'

import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import SubPageHeader from '../../components/SubPageHeader'
import FreshnessBadge from '../../components/FreshnessBadge'
import { useFreshness } from '../../lib/useFreshness'
import type { BurnupResponse, BurnupPoint } from '../api/burnup/route'

function BurnupChart({ series }: { series: BurnupPoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || series.length === 0) return

    const W = svg.clientWidth || 760
    const H = 300
    const margin = { top: 16, right: 16, bottom: 36, left: 36 }
    const iW = W - margin.left - margin.right
    const iH = H - margin.top - margin.bottom

    d3.select(svg).selectAll('*').remove()
    d3.select(svg).attr('width', W).attr('height', H)
    const root = d3.select(svg).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const parse = (d: string) => new Date(d + 'T00:00:00Z')
    const x = d3.scaleTime()
      .domain([parse(series[0].date), parse(series[series.length - 1].date)])
      .range([0, iW])
    const maxVal = Math.max(...series.map((p) => p.created), 1)
    const y = d3.scaleLinear().domain([0, maxVal]).range([iH, 0]).nice()

    // Y grid
    root.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => String(v)))
      .call((g) => {
        g.select('.domain').remove()
        g.selectAll('.tick line').attr('stroke', 'rgba(255,255,255,0.05)').attr('x2', iW)
        g.selectAll('.tick text').attr('fill', '#475569').attr('font-size', '0.6rem').attr('font-family', 'monospace')
      })

    // X axis
    root.append('g')
      .attr('transform', `translate(0,${iH})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat((d) => d3.timeFormat('%m-%d')(d as Date)))
      .call((g) => {
        g.select('.domain').remove()
        g.selectAll('.tick line').remove()
        g.selectAll('.tick text').attr('fill', '#475569').attr('font-size', '0.55rem').attr('font-family', 'monospace')
      })

    // Open-backlog gap = area between the completed line (bottom) and created line (top).
    const gap = d3.area<BurnupPoint>()
      .x((p) => x(parse(p.date)))
      .y0((p) => y(p.completed))
      .y1((p) => y(p.created))
      .curve(d3.curveStepAfter)
    root.append('path').datum(series).attr('fill', '#F59E0B').attr('opacity', 0.12).attr('d', gap)

    // Shipped area (green) under the completed line
    const shipped = d3.area<BurnupPoint>()
      .x((p) => x(parse(p.date)))
      .y0(iH)
      .y1((p) => y(p.completed))
      .curve(d3.curveStepAfter)
    root.append('path').datum(series).attr('fill', '#10B981').attr('opacity', 0.14).attr('d', shipped)

    // Total scope line (cyan)
    const scopeLine = d3.line<BurnupPoint>()
      .x((p) => x(parse(p.date))).y((p) => y(p.created)).curve(d3.curveStepAfter)
    root.append('path').datum(series).attr('fill', 'none')
      .attr('stroke', '#22D3EE').attr('stroke-width', 2).attr('d', scopeLine)

    // Shipped line (green)
    const shippedLine = d3.line<BurnupPoint>()
      .x((p) => x(parse(p.date))).y((p) => y(p.completed)).curve(d3.curveStepAfter)
    root.append('path').datum(series).attr('fill', 'none')
      .attr('stroke', '#10B981').attr('stroke-width', 2).attr('d', shippedLine)
  }, [series])

  return <svg ref={svgRef} className="w-full overflow-visible" />
}

export default function BurnupPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<BurnupResponse>('/api/burnup', 60_000)
  const loading = data === null && lastError === null

  const t = data?.totals
  const r = data?.rate14d
  const trend = r ? (r.created > r.shipped ? '↑ scope' : r.shipped > r.created ? '↓ closing' : '↔ flat') : '—'
  const trendColor = r ? (r.created > r.shipped ? '#F59E0B' : r.shipped > r.created ? '#10B981' : '#94A3B8') : '#94A3B8'

  const kpis = [
    { label: 'Total Scope', value: t?.scope ?? 0, color: '#22D3EE' },
    { label: 'Shipped', value: t?.shipped ?? 0, color: '#10B981' },
    { label: 'Open', value: t?.open ?? 0, color: '#F59E0B' },
    { label: '14d Created · Shipped', value: r ? `${r.created} · ${r.shipped}` : '—', color: trendColor },
  ]

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Proposal Burnup">
        <span className="text-[0.6rem] font-mono text-slate-500">Scope vs Shipped · {trend}</span>
        <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
      </SubPageHeader>

      {loading && <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>}

      {!loading && data && (
        <div className="max-w-5xl mx-auto space-y-6 mt-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="rounded-lg border border-white/5 p-4 text-center"
                style={{ background: 'rgba(255,255,255,0.02)' }}>
                <div className="text-xl sm:text-2xl font-mono font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
                <div className="text-[0.55rem] font-mono text-slate-500 mt-1 uppercase tracking-wider">{kpi.label}</div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-white/5 p-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[0.65rem] font-mono text-slate-400 uppercase tracking-wider">
                Proposal Burnup — Full History
              </div>
              <div className="flex items-center gap-3 text-[0.55rem] font-mono">
                <span style={{ color: '#22D3EE' }}>━ scope</span>
                <span style={{ color: '#10B981' }}>━ shipped</span>
                <span style={{ color: '#F59E0B' }}>▰ open gap</span>
              </div>
            </div>
            {data.series.length === 0 ? (
              <div className="text-[0.65rem] font-mono text-slate-600 py-10 text-center">No backlog data</div>
            ) : (
              <BurnupChart series={data.series} />
            )}
          </div>

          <p className="text-[0.6rem] font-mono text-slate-600 leading-relaxed">
            The gap between the scope and shipped lines is the open backlog. A widening gap means new
            proposals are being added faster than existing ones ship; a narrowing gap means delivery is
            outpacing scope growth.
          </p>
        </div>
      )}
    </div>
  )
}

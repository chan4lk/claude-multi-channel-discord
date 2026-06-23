'use client'

import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import SubPageHeader from '../../components/SubPageHeader'
import FreshnessBadge from '../../components/FreshnessBadge'
import { useFreshness } from '../../lib/useFreshness'
import type { BurndownResponse, BurndownPoint } from '../api/metrics/burndown/route'

function BurndownChart({ series }: { series: BurndownPoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || series.length === 0) return

    const W = svg.clientWidth || 760
    const H = 280
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
    const maxVal = Math.max(...series.map((p) => p.total), 1)
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

    // Completed area (green)
    const area = d3.area<BurndownPoint>()
      .x((p) => x(parse(p.date)))
      .y0(iH)
      .y1((p) => y(p.done))
      .curve(d3.curveStepAfter)
    root.append('path').datum(series).attr('fill', '#10B981').attr('opacity', 0.14).attr('d', area)

    // Ideal guide (dashed): from first-day remaining to 0 at the end
    const firstRem = series[0].remaining
    root.append('line')
      .attr('x1', x(parse(series[0].date))).attr('y1', y(firstRem))
      .attr('x2', iW).attr('y2', y(0))
      .attr('stroke', '#64748B').attr('stroke-width', 1).attr('stroke-dasharray', '4 4').attr('opacity', 0.5)

    // Total scope step line (grey)
    const totalLine = d3.line<BurndownPoint>()
      .x((p) => x(parse(p.date))).y((p) => y(p.total)).curve(d3.curveStepAfter)
    root.append('path').datum(series).attr('fill', 'none')
      .attr('stroke', '#94A3B8').attr('stroke-width', 1.25).attr('opacity', 0.6).attr('d', totalLine)

    // Remaining line (red)
    const remLine = d3.line<BurndownPoint>()
      .x((p) => x(parse(p.date))).y((p) => y(p.remaining)).curve(d3.curveStepAfter)
    root.append('path').datum(series).attr('fill', 'none')
      .attr('stroke', '#EF4444').attr('stroke-width', 2).attr('d', remLine)
  }, [series])

  return <svg ref={svgRef} className="w-full overflow-visible" />
}

export default function BurndownPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<BurndownResponse>('/api/metrics/burndown', 60_000)
  const loading = data === null && lastError === null

  const t = data?.totals
  const kpis = [
    { label: 'Total Scope', value: t?.total ?? 0, color: '#94A3B8' },
    { label: 'Completed', value: t?.done ?? 0, color: '#10B981' },
    { label: 'Remaining', value: t?.remaining ?? 0, color: '#EF4444' },
    { label: 'Projected Done', value: data?.projectedDone ?? '—', color: '#22D3EE' },
  ]

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Backlog Burndown">
        <span className="text-[0.6rem] font-mono text-slate-500">Scope · Completed · Remaining</span>
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
                Backlog Burndown — Full History
              </div>
              <div className="flex items-center gap-3 text-[0.55rem] font-mono">
                <span style={{ color: '#94A3B8' }}>━ total</span>
                <span style={{ color: '#10B981' }}>▰ done</span>
                <span style={{ color: '#EF4444' }}>━ remaining</span>
                <span style={{ color: '#64748B' }}>┄ ideal</span>
              </div>
            </div>
            {data.series.length === 0 ? (
              <div className="text-[0.65rem] font-mono text-slate-600 py-10 text-center">No backlog data</div>
            ) : (
              <BurndownChart series={data.series} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

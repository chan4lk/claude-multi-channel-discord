'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'
import type { ProposalVelocityResponse, DayBucket, ProjectVelocity } from '../api/proposal-velocity/route'

function TrendArrow({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up') return <span style={{ color: '#22D3EE' }}>↑</span>
  if (trend === 'down') return <span style={{ color: '#EF4444' }}>↓</span>
  return <span style={{ color: '#6B7280' }}>→</span>
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-slate-700 text-[0.5rem]">—</span>
  const W = 56, H = 18
  const max = Math.max(...values, 1)
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * W},${H - (v / max) * H}`)
    .join(' ')
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline points={pts} fill="none" stroke="#22D3EE" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StackedAreaChart({ buckets }: { buckets: DayBucket[] }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || buckets.length === 0) return

    const W = svg.clientWidth || 700
    const H = 200
    const margin = { top: 16, right: 16, bottom: 40, left: 40 }
    const iW = W - margin.left - margin.right
    const iH = H - margin.top - margin.bottom

    d3.select(svg).selectAll('*').remove()
    d3.select(svg).attr('width', W).attr('height', H)

    const root = d3.select(svg).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const dates = buckets.map((b) => b.date)
    const x = d3.scaleBand().domain(dates).range([0, iW]).padding(0.2)
    const maxVal = Math.max(...buckets.map((b) => b.opened + b.closed), 1)
    const y = d3.scaleLinear().domain([0, maxVal]).range([iH, 0]).nice()

    // Grid
    root.append('g')
      .call(d3.axisLeft(y).ticks(4).tickFormat((v) => String(v)))
      .call((g) => {
        g.select('.domain').remove()
        g.selectAll('.tick line').attr('stroke', 'rgba(255,255,255,0.05)').attr('x2', iW)
        g.selectAll('.tick text').attr('fill', '#475569').attr('font-size', '0.6rem').attr('font-family', 'monospace')
      })

    // X axis — show every 5th date
    root.append('g')
      .attr('transform', `translate(0,${iH})`)
      .call(
        d3.axisBottom(x)
          .tickValues(dates.filter((_, i) => i % 5 === 0))
          .tickFormat((d) => (d as string).slice(5))
      )
      .call((g) => {
        g.select('.domain').remove()
        g.selectAll('.tick line').remove()
        g.selectAll('.tick text').attr('fill', '#475569').attr('font-size', '0.55rem').attr('font-family', 'monospace')
      })

    // Bars stacked: opened (amber), closed (cyan)
    root.selectAll('.bar-closed')
      .data(buckets)
      .enter()
      .append('rect')
      .attr('x', (d) => x(d.date) ?? 0)
      .attr('y', (d) => y(d.closed))
      .attr('width', x.bandwidth())
      .attr('height', (d) => iH - y(d.closed))
      .attr('fill', '#22D3EE')
      .attr('opacity', 0.8)

    root.selectAll('.bar-opened')
      .data(buckets)
      .enter()
      .append('rect')
      .attr('x', (d) => x(d.date) ?? 0)
      .attr('y', (d) => y(d.opened + d.closed))
      .attr('width', x.bandwidth())
      .attr('height', (d) => iH - y(d.opened))
      .attr('fill', '#F59E0B')
      .attr('opacity', 0.6)

  }, [buckets])

  return (
    <div className="w-full">
      <div className="flex items-center gap-4 mb-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 rounded-sm" style={{ background: '#22D3EE', opacity: 0.8 }} />
          <span className="text-[0.6rem] font-mono text-slate-400">Closed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2 rounded-sm" style={{ background: '#F59E0B', opacity: 0.6 }} />
          <span className="text-[0.6rem] font-mono text-slate-400">Opened</span>
        </div>
      </div>
      <svg ref={svgRef} className="w-full" />
    </div>
  )
}

function ProjectBar({ project }: { project: ProjectVelocity }) {
  const total = project.pending + project.inProgress + project.done
  return (
    <Link
      href={`/backlog?project=${project.slug}`}
      className="block rounded-lg border border-white/5 p-3 hover:border-cyber-cyan/20 transition-colors"
      style={{ background: 'rgba(255,255,255,0.02)' }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[0.7rem] font-mono text-cyber-cyan">{project.slug}</span>
        <span className="text-[0.6rem] font-mono text-slate-500">{total} total</span>
      </div>
      <div className="flex h-3 rounded overflow-hidden gap-0.5">
        {project.done > 0 && (
          <div
            className="h-full"
            style={{ width: `${(project.done / Math.max(total, 1)) * 100}%`, background: '#22D3EE' }}
            title={`Done: ${project.done}`}
          />
        )}
        {project.inProgress > 0 && (
          <div
            className="h-full"
            style={{ width: `${(project.inProgress / Math.max(total, 1)) * 100}%`, background: '#A78BFA' }}
            title={`In Progress: ${project.inProgress}`}
          />
        )}
        {project.pending > 0 && (
          <div
            className="h-full"
            style={{ width: `${(project.pending / Math.max(total, 1)) * 100}%`, background: '#F59E0B', opacity: 0.5 }}
            title={`Pending: ${project.pending}`}
          />
        )}
      </div>
      <div className="flex gap-3 mt-1.5">
        <span className="text-[0.55rem] font-mono" style={{ color: '#22D3EE' }}>{project.done} done</span>
        {project.inProgress > 0 && (
          <span className="text-[0.55rem] font-mono" style={{ color: '#A78BFA' }}>{project.inProgress} wip</span>
        )}
        <span className="text-[0.55rem] font-mono text-amber-400">{project.pending} pending</span>
      </div>
    </Link>
  )
}

export default function ProposalVelocityPage() {
  const [data, setData] = useState<ProposalVelocityResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    fetch('/api/proposal-velocity')
      .then((r) => r.json())
      .then((d: ProposalVelocityResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const totalClosed = data?.dailyBuckets.reduce((s, b) => s + b.closed, 0) ?? 0
  const totalOpened = data?.dailyBuckets.reduce((s, b) => s + b.opened, 0) ?? 0

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Proposal Velocity">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Throughput · Closure Rate · Trends
        </span>
      </SubPageHeader>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}

      {!loading && data && (
        <div className="max-w-5xl mx-auto space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Opened (30d)', value: totalOpened, color: '#F59E0B' },
              { label: 'Closed (30d)', value: totalClosed, color: '#22D3EE' },
              { label: 'Close Rate', value: totalOpened > 0 ? `${Math.round((totalClosed / totalOpened) * 100)}%` : '—', color: '#A78BFA' },
            ].map((kpi) => (
              <div
                key={kpi.label}
                className="rounded-lg border border-white/5 p-4 text-center"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="text-2xl font-mono font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
                <div className="text-[0.6rem] font-mono text-slate-500 mt-1 uppercase tracking-wider">{kpi.label}</div>
              </div>
            ))}
          </div>

          {/* Stacked area / bar chart */}
          <div
            className="rounded-lg border border-white/5 p-4"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            <div className="text-[0.65rem] font-mono text-slate-400 uppercase tracking-wider mb-3">
              Proposals Opened vs Closed — Last 30 Days
            </div>
            <StackedAreaChart buckets={data.dailyBuckets} />
          </div>

          {/* Per-project bars */}
          <div
            className="rounded-lg border border-white/5 p-4"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            <div className="text-[0.65rem] font-mono text-slate-400 uppercase tracking-wider mb-3">
              Proposal Breakdown by Project
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.projects.map((p) => (
                <ProjectBar key={p.slug} project={p} />
              ))}
            </div>
          </div>

          {/* Velocity leaderboard */}
          <div
            className="rounded-lg border border-white/5 p-4"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            <div className="text-[0.65rem] font-mono text-slate-400 uppercase tracking-wider mb-3">
              Velocity Leaderboard — Completions Last 7 Days
            </div>
            <div className="space-y-2">
              {data.leaderboard.length === 0 && (
                <div className="text-[0.65rem] font-mono text-slate-600 py-4 text-center">No completions in last 7 days</div>
              )}
              {data.leaderboard.map((entry, idx) => (
                <div
                  key={entry.slug}
                  className="flex items-center gap-4 px-3 py-2 rounded border border-white/5"
                  style={{ background: 'rgba(255,255,255,0.015)' }}
                >
                  <span className="text-[0.6rem] font-mono text-slate-600 w-5">#{idx + 1}</span>
                  <span className="text-[0.7rem] font-mono text-cyber-cyan flex-1">{entry.slug}</span>
                  <Sparkline values={entry.sparkline} />
                  <span className="text-[0.7rem] font-mono text-slate-300 w-8 text-right">{entry.completions7d}</span>
                  <span className="text-[0.8rem] w-4"><TrendArrow trend={entry.trend} /></span>
                </div>
              ))}
            </div>
          </div>

          <div className="text-[0.55rem] font-mono text-slate-700 text-right">
            Generated {new Date(data.generatedAt).toLocaleString()} · 1h cache
          </div>
        </div>
      )}
    </div>
  )
}

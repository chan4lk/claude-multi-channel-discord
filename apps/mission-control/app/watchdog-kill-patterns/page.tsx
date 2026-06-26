'use client'

import { useCallback, useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import SubPageHeader from '../../components/SubPageHeader'
import type { WatchdogKillPatternsResponse, HeatmapCell, PrecedingTool, ContextPressurePoint } from '../api/watchdog-kill-patterns/route'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function heatColor(count: number, max: number): string {
  if (count === 0) return 'rgba(30,58,95,0.3)'
  const intensity = Math.min(1, count / Math.max(max, 1))
  // Low = amber, high = red
  const r = Math.round(239 * intensity + 245 * (1 - intensity) * 0.6)
  const g = Math.round(68 * intensity + 158 * (1 - intensity))
  const b = Math.round(68 * intensity + 11 * (1 - intensity) * 0.05)
  return `rgba(${r},${g},${b},${0.3 + 0.7 * intensity})`
}

function HeatmapGrid({ cells }: { cells: HeatmapCell[] }) {
  const maxCount = Math.max(...cells.map((c) => c.count), 1)
  const [tooltip, setTooltip] = useState<{ hour: number; day: number; count: number; x: number; y: number } | null>(null)

  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const c of cells) {
    grid[c.day][c.hour] = c.count
  }

  const CELL_W = 18
  const CELL_H = 20
  const LEFT = 32
  const TOP = 20
  const svgW = LEFT + 24 * CELL_W + 4
  const svgH = TOP + 7 * CELL_H + 4

  return (
    <div className="relative">
      <svg width={svgW} height={svgH}>
        {/* Hour labels */}
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
          <text key={h} x={LEFT + h * CELL_W + CELL_W / 2} y={12} textAnchor="middle" fill="#475569" fontSize={7} fontFamily="monospace">
            {h.toString().padStart(2, '0')}
          </text>
        ))}
        {/* Day rows */}
        {DAY_LABELS.map((label, day) => (
          <g key={day}>
            <text x={LEFT - 4} y={TOP + day * CELL_H + CELL_H / 2 + 3} textAnchor="end" fill="#475569" fontSize={7} fontFamily="monospace">
              {label}
            </text>
            {grid[day].map((count, hour) => (
              <rect
                key={hour}
                x={LEFT + hour * CELL_W + 1}
                y={TOP + day * CELL_H + 1}
                width={CELL_W - 2}
                height={CELL_H - 2}
                rx={2}
                fill={heatColor(count, maxCount)}
                style={{ cursor: count > 0 ? 'pointer' : 'default' }}
                onMouseEnter={(e) => {
                  const rect = (e.target as SVGRectElement).getBoundingClientRect()
                  setTooltip({ hour, day, count, x: rect.left + rect.width / 2, y: rect.top })
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            ))}
          </g>
        ))}
        {/* Color scale */}
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <rect
            key={i}
            x={LEFT + 24 * CELL_W - 40 + i * 10}
            y={svgH - 8}
            width={10}
            height={5}
            fill={heatColor(Math.round(t * maxCount), maxCount)}
            rx={1}
          />
        ))}
        <text x={LEFT + 24 * CELL_W - 42} y={svgH - 9} fill="#334155" fontSize={6} fontFamily="monospace">low</text>
        <text x={LEFT + 24 * CELL_W - 2} y={svgH - 9} fill="#334155" fontSize={6} fontFamily="monospace">high</text>
      </svg>

      {tooltip && tooltip.count > 0 && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1 rounded text-[0.6rem] font-mono"
          style={{ left: tooltip.x, top: tooltip.y - 32, transform: 'translateX(-50%)', background: 'rgba(4,10,20,0.95)', border: '1px solid #1e3a5f', color: '#94a3b8' }}
        >
          {DAY_LABELS[tooltip.day]} {tooltip.hour.toString().padStart(2, '0')}:00 — <span style={{ color: '#EF4444' }}>{tooltip.count} kill{tooltip.count > 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  )
}

function PrecedingToolsChart({ tools }: { tools: PrecedingTool[] }) {
  if (tools.length === 0) return <div className="text-slate-600 text-xs font-mono py-4">No data</div>
  const max = tools[0].count
  return (
    <div className="flex flex-col gap-1.5">
      {tools.map(({ tool, count }) => {
        const pct = max > 0 ? (count / max) * 100 : 0
        const shortTool = tool.replace('mcp__mcd__', 'mcd:').replace('mcp__', '')
        return (
          <div key={tool} className="flex items-center gap-2">
            <span className="text-[0.55rem] font-mono text-slate-500 w-32 truncate text-right" title={tool}>{shortTool}</span>
            <div className="flex-1 h-4 rounded" style={{ background: 'rgba(30,58,95,0.4)', position: 'relative' }}>
              <div
                className="h-full rounded"
                style={{ width: `${pct}%`, background: 'rgba(239,68,68,0.6)' }}
              />
            </div>
            <span className="text-[0.55rem] font-mono w-5 text-right" style={{ color: '#EF4444' }}>{count}</span>
          </div>
        )
      })}
    </div>
  )
}

function ContextPressureScatter({ points }: { points: ContextPressurePoint[] }) {
  if (points.length === 0) return <div className="text-slate-600 text-xs font-mono py-4">No data</div>
  const W = 320, H = 160
  const PAD = { l: 36, r: 12, t: 8, b: 24 }
  const maxKills = Math.max(...points.map((p) => p.killCount), 1)

  return (
    <svg width={W} height={H}>
      {/* Axes */}
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="#1e3a5f" strokeWidth={1} />
      <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="#1e3a5f" strokeWidth={1} />

      {/* Y labels (context %) */}
      {[0, 25, 50, 75, 100].map((v) => {
        const y = PAD.t + (H - PAD.t - PAD.b) * (1 - v / 100)
        return (
          <g key={v}>
            <line x1={PAD.l - 3} y1={y} x2={PAD.l} y2={y} stroke="#1e3a5f" strokeWidth={1} />
            <text x={PAD.l - 5} y={y + 3} textAnchor="end" fill="#334155" fontSize={7} fontFamily="monospace">{v}%</text>
          </g>
        )
      })}

      {/* 80% threshold line */}
      <line
        x1={PAD.l}
        y1={PAD.t + (H - PAD.t - PAD.b) * 0.2}
        x2={W - PAD.r}
        y2={PAD.t + (H - PAD.t - PAD.b) * 0.2}
        stroke="#EF444440"
        strokeDasharray="3 2"
        strokeWidth={1}
      />
      <text x={W - PAD.r - 2} y={PAD.t + (H - PAD.t - PAD.b) * 0.2 - 2} textAnchor="end" fill="#EF444460" fontSize={6} fontFamily="monospace">80%</text>

      {/* Points */}
      {points.map((p, i) => {
        const innerW = W - PAD.l - PAD.r
        const x = PAD.l + (innerW / Math.max(points.length - 1, 1)) * i
        const y = PAD.t + (H - PAD.t - PAD.b) * (1 - p.contextPct / 100)
        const r = 3 + (p.killCount / maxKills) * 8
        const isHigh = p.contextPct >= 80
        const color = isHigh ? '#EF4444' : '#F59E0B'
        return (
          <g key={p.slug}>
            <circle cx={x} cy={y} r={r} fill={`${color}60`} stroke={color} strokeWidth={isHigh ? 2 : 1} />
            <text x={x} y={y - r - 2} textAnchor="middle" fill={color} fontSize={6} fontFamily="monospace">{p.slug.slice(0, 8)}</text>
          </g>
        )
      })}

      <text x={PAD.l + (W - PAD.l - PAD.r) / 2} y={H - 2} textAnchor="middle" fill="#334155" fontSize={7} fontFamily="monospace">projects (size = kill count)</text>
    </svg>
  )
}

function WatchdogKillPatternsInner() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [data, setData] = useState<WatchdogKillPatternsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [slug, setSlug] = useState(searchParams.get('slug') ?? '')
  const [since, setSince] = useState(searchParams.get('since') ?? '')
  const [until, setUntil] = useState(searchParams.get('until') ?? '')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (slug) params.set('slug', slug)
      if (since) params.set('since', since)
      if (until) params.set('until', until)
      const res = await fetch(`/api/watchdog-kill-patterns?${params}`)
      if (res.ok) setData(await res.json() as WatchdogKillPatternsResponse)
    } catch { /* skip */ } finally {
      setLoading(false)
    }
  }, [slug, since, until])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    const params = new URLSearchParams()
    if (slug) params.set('slug', slug)
    if (since) params.set('since', since)
    if (until) params.set('until', until)
    router.replace(`/watchdog-kill-patterns${params.toString() ? '?' + params.toString() : ''}`, { scroll: false })
  }, [slug, since, until, router])

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#020811', fontFamily: 'JetBrains Mono, monospace' }}>
      <SubPageHeader title="WATCHDOG KILL PATTERNS" />

      {/* Filters + stats */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-2 border-b border-white/5" style={{ background: '#060d1a' }}>
        <div className="flex items-center gap-2">
          <span className="text-[0.6rem] font-mono text-slate-500 uppercase">Project</span>
          <select
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="text-xs font-mono bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-300 focus:outline-none"
          >
            <option value="">All</option>
            {(data?.slugOptions ?? []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[0.6rem] font-mono text-slate-500 uppercase">Since</span>
          <input
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="text-xs font-mono bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-300 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[0.6rem] font-mono text-slate-500 uppercase">Until</span>
          <input
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="text-xs font-mono bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-300 focus:outline-none"
          />
        </div>

        <div className="flex-1" />

        {data && (
          <div className="flex items-center gap-4">
            <div className="text-[0.6rem] font-mono">
              <span className="text-slate-500">Total kills:</span>{' '}
              <span style={{ color: '#EF4444' }}>{data.totalKills}</span>
            </div>
            <div
              className="text-[0.6rem] font-mono px-2 py-0.5 rounded"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444' }}
            >
              {data.killRatePer7d} kills/day (7d avg)
            </div>
          </div>
        )}
      </div>

      {loading && <div className="p-8 text-slate-500 text-xs font-mono">Loading…</div>}

      {data && data.totalKills === 0 && (
        <div className="p-8 text-slate-600 text-xs font-mono">No watchdog kills recorded yet.</div>
      )}

      {data && data.totalKills > 0 && (
        <div className="p-4 grid grid-cols-1 gap-6" style={{ maxWidth: 960 }}>
          {/* Panel 1: Heatmap */}
          <div className="rounded border p-4" style={{ background: '#060d1a', borderColor: '#1e3a5f' }}>
            <div className="text-[0.6rem] font-mono text-slate-400 uppercase tracking-widest mb-3">Kill Frequency — Hour × Day of Week</div>
            <HeatmapGrid cells={data.heatmap} />
          </div>

          {/* Panel 2 + 3: Tools + Scatter */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded border p-4" style={{ background: '#060d1a', borderColor: '#1e3a5f' }}>
              <div className="text-[0.6rem] font-mono text-slate-400 uppercase tracking-widest mb-3">Top Preceding Tool Calls</div>
              <PrecedingToolsChart tools={data.precedingTools} />
            </div>

            <div className="rounded border p-4" style={{ background: '#060d1a', borderColor: '#1e3a5f' }}>
              <div className="text-[0.6rem] font-mono text-slate-400 uppercase tracking-widest mb-2">Context Pressure at Kill Time</div>
              <div className="text-[0.5rem] font-mono text-slate-600 mb-3">Red = last kill &gt;80% ctx pressure</div>
              <ContextPressureScatter points={data.contextPressure} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function WatchdogKillPatternsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500 font-mono text-sm">Loading…</div>}>
      <WatchdogKillPatternsInner />
    </Suspense>
  )
}

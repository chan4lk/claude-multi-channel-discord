'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { MemoryTimelineResponse, MemoryFileSeries, MemoryCommit } from '../api/memory-timeline/route'

const MEMORY_TYPES = ['all', 'user', 'feedback', 'project', 'reference', 'unknown']

const TYPE_COLOR: Record<string, string> = {
  user: '#22D3EE',
  feedback: '#F59E0B',
  project: '#A78BFA',
  reference: '#34D399',
  index: '#6B7280',
  unknown: '#475569',
}

const WINDOW_DAYS = 30

function dayX(ts: string, nowMs: number, chartW: number): number {
  const ms = Date.parse(ts)
  if (isNaN(ms)) return -1
  const daysAgo = (nowMs - ms) / 86_400_000
  if (daysAgo < 0 || daysAgo > WINDOW_DAYS) return -1
  return Math.round(chartW * (1 - daysAgo / WINDOW_DAYS))
}

function fmtDate(ts: string): string {
  return ts.slice(0, 10)
}

export default function MemoryTimelinePage() {
  const [data, setData] = useState<MemoryTimelineResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [slugs, setSlugs] = useState<string[]>([])
  const [selectedSlug, setSelectedSlug] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [tooltip, setTooltip] = useState<{ x: number; y: number; commit: MemoryCommit; file: string } | null>(null)
  const chartRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    fetch('/api/fleet')
      .then(r => r.json())
      .then((f: { projects?: Array<{ slug: string }> }) => {
        const ss = (f.projects ?? []).map(p => p.slug)
        setSlugs(ss)
        if (ss.length > 0) setSelectedSlug(ss[0])
      })
      .catch(() => {})
  }, [])

  const load = useCallback((slug: string, type: string) => {
    if (!slug) return
    setLoading(true)
    const params = new URLSearchParams({ slug, days: String(WINDOW_DAYS) })
    if (type !== 'all') params.set('type', type)
    fetch(`/api/memory-timeline?${params}`)
      .then(r => r.json())
      .then((d: MemoryTimelineResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load(selectedSlug, typeFilter) }, [load, selectedSlug, typeFilter])

  const series = data?.series ?? []
  const ROW_H = 32
  const LABEL_W = 160
  const CHART_W = 600
  const DOT_R = 4
  const svgH = Math.max(60, series.length * ROW_H + 40)
  const nowMs = Date.now()

  // x-axis tick labels
  const ticks: { x: number; label: string }[] = []
  for (let d = 0; d <= WINDOW_DAYS; d += 7) {
    const t = new Date(nowMs - d * 86_400_000)
    ticks.push({ x: Math.round(CHART_W * (1 - d / WINDOW_DAYS)), label: t.toISOString().slice(5, 10) })
  }

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Session Memory Timeline">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Per-file memory write history · git commit dots · last 30 days
        </span>
      </SubPageHeader>

      {/* Controls */}
      <div className="max-w-5xl mx-auto mb-5 flex flex-wrap gap-3 items-center">
        <select
          value={selectedSlug}
          onChange={e => { setSelectedSlug(e.target.value); setData(null) }}
          className="text-[0.65rem] font-mono px-2 py-1 rounded border border-white/10"
          style={{ background: '#0d1b2e', color: '#E2E8F0' }}
        >
          {slugs.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="text-[0.65rem] font-mono px-2 py-1 rounded border border-white/10"
          style={{ background: '#0d1b2e', color: '#E2E8F0' }}
        >
          {MEMORY_TYPES.map(t => <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>)}
        </select>

        {/* Legend */}
        <div className="flex gap-3 ml-auto flex-wrap">
          {Object.entries(TYPE_COLOR).filter(([t]) => t !== 'index').map(([t, c]) => (
            <div key={t} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ background: c }} />
              <span className="text-[0.5rem] font-mono text-slate-500">{t}</span>
            </div>
          ))}
        </div>
      </div>

      {loading && <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>}

      {!loading && series.length === 0 && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">
          No memory files found
          <div className="text-[0.5rem] mt-2 text-slate-700">
            {selectedSlug ? `Project "${selectedSlug}" has no memory/ directory or no git history` : 'Select a project'}
          </div>
        </div>
      )}

      {!loading && series.length > 0 && (
        <div className="max-w-5xl mx-auto overflow-x-auto">
          <div className="relative" style={{ minWidth: LABEL_W + CHART_W + 20 }}>
            <svg
              ref={chartRef}
              width={LABEL_W + CHART_W + 20}
              height={svgH}
              onMouseLeave={() => setTooltip(null)}
            >
              {/* Grid lines */}
              {ticks.map(({ x }) => (
                <line
                  key={x}
                  x1={LABEL_W + x}
                  y1={0}
                  x2={LABEL_W + x}
                  y2={svgH - 20}
                  stroke="rgba(255,255,255,0.04)"
                  strokeWidth={1}
                />
              ))}

              {/* Rows */}
              {series.map((s: MemoryFileSeries, i) => {
                const y = i * ROW_H + ROW_H / 2
                const color = TYPE_COLOR[s.type] ?? '#475569'
                return (
                  <g key={s.file}>
                    {/* Row BG on hover (CSS hover) */}
                    <rect x={0} y={i * ROW_H} width={LABEL_W + CHART_W + 20} height={ROW_H}
                      fill="transparent" />

                    {/* Label */}
                    <text
                      x={LABEL_W - 8}
                      y={y + 4}
                      textAnchor="end"
                      fontSize={9}
                      fontFamily="monospace"
                      fill="#94A3B8"
                    >
                      {s.file.replace('.md', '').slice(0, 22)}
                    </text>

                    {/* Baseline */}
                    <line
                      x1={LABEL_W}
                      y1={y}
                      x2={LABEL_W + CHART_W}
                      y2={y}
                      stroke="rgba(255,255,255,0.05)"
                      strokeWidth={1}
                    />

                    {/* Type dot label */}
                    <circle cx={LABEL_W - 28} cy={y} r={3} fill={color} />

                    {/* Commit dots */}
                    {s.commits.map((c: MemoryCommit, ci) => {
                      const cx = LABEL_W + dayX(c.ts, nowMs, CHART_W)
                      if (cx < LABEL_W) return null
                      return (
                        <circle
                          key={ci}
                          cx={cx}
                          cy={y}
                          r={DOT_R}
                          fill={color}
                          opacity={0.85}
                          style={{ cursor: 'pointer' }}
                          onMouseEnter={(e) => {
                            const rect = chartRef.current?.getBoundingClientRect()
                            if (!rect) return
                            setTooltip({
                              x: e.clientX - rect.left,
                              y: e.clientY - rect.top,
                              commit: c,
                              file: s.file,
                            })
                          }}
                        />
                      )
                    })}

                    {/* Count label */}
                    {s.commits.length > 0 && (
                      <text
                        x={LABEL_W + CHART_W + 6}
                        y={y + 4}
                        fontSize={8}
                        fontFamily="monospace"
                        fill="#475569"
                      >
                        {s.commits.length}
                      </text>
                    )}
                  </g>
                )
              })}

              {/* X-axis ticks */}
              {ticks.map(({ x, label }) => (
                <text
                  key={x}
                  x={LABEL_W + x}
                  y={svgH - 4}
                  textAnchor="middle"
                  fontSize={8}
                  fontFamily="monospace"
                  fill="#475569"
                >
                  {label}
                </text>
              ))}
            </svg>

            {/* Tooltip */}
            {tooltip && (
              <div
                className="absolute pointer-events-none rounded border border-white/10 px-3 py-2 text-[0.6rem] font-mono"
                style={{
                  background: '#0d1b2e',
                  left: Math.min(tooltip.x + 12, LABEL_W + CHART_W - 180),
                  top: Math.max(0, tooltip.y - 60),
                  zIndex: 10,
                  maxWidth: 220,
                }}
              >
                <div className="text-slate-300">{tooltip.file}</div>
                <div className="text-slate-500">{fmtDate(tooltip.commit.ts)}</div>
                <div className="text-cyan-400/80 font-mono">{tooltip.commit.sha}</div>
                <div className="text-slate-400 truncate">{tooltip.commit.message}</div>
              </div>
            )}
          </div>

          <div className="text-[0.5rem] font-mono text-slate-700 text-right mt-4">
            {series.length} memory files · {series.reduce((a, s) => a + s.commits.length, 0)} commits · last 30 days
          </div>
        </div>
      )}
    </div>
  )
}

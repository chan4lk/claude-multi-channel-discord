'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import * as d3 from 'd3'
import type { MomentumResponse } from '../api/metrics/momentum/route'

const PROJECT_COLORS = [
  '#00F5FF', '#A855F7', '#4ADE80', '#F59E0B', '#EF4444',
  '#38BDF8', '#FB7185', '#34D399', '#FBBF24', '#C084FC',
  '#22D3EE', '#F472B6', '#A3E635', '#FB923C', '#818CF8',
]

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(Math.round(n))
}

interface HoverInfo {
  x: number
  y: number
  day: string
  slug: string
  value: number
}

export default function MomentumPage() {
  const [data, setData] = useState<MomentumResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)

  useEffect(() => {
    function load() {
      fetch('/api/metrics/momentum')
        .then((r) => r.json() as Promise<MomentumResponse>)
        .then((d) => { setData(d); setLoading(false) })
        .catch(() => setLoading(false))
    }
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    function onResize() {
      if (wrapRef.current) setWidth(wrapRef.current.clientWidth)
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [data])

  const colorFor = useMemo(() => {
    const map = new Map<string, string>()
    ;(data?.series ?? []).forEach((s, i) => map.set(s.slug, PROJECT_COLORS[i % PROJECT_COLORS.length]))
    return (slug: string) => map.get(slug) ?? '#64748b'
  }, [data])

  const H = 420
  const M = { top: 16, right: 16, bottom: 28, left: 16 }
  const innerW = Math.max(width - M.left - M.right, 100)
  const innerH = H - M.top - M.bottom

  const layout = useMemo(() => {
    if (!data || data.series.length === 0) return null
    const visible = data.series.filter((s) => !hidden.has(s.slug))
    if (visible.length === 0) return null
    const days = data.days
    const n = days.length

    // build row-per-day matrix for d3.stack
    const rows = days.map((_, di) => {
      const row: Record<string, number> = {}
      for (const s of visible) row[s.slug] = s.values[di] ?? 0
      return row
    })
    const keys = visible.map((s) => s.slug)
    const stackGen = d3.stack<Record<string, number>>()
      .keys(keys)
      .offset(d3.stackOffsetWiggle)
      .order(d3.stackOrderInsideOut)
    const stacked = stackGen(rows)

    const yMin = d3.min(stacked, (layer) => d3.min(layer, (d) => d[0])) ?? 0
    const yMax = d3.max(stacked, (layer) => d3.max(layer, (d) => d[1])) ?? 1
    const x = d3.scaleLinear().domain([0, n - 1]).range([0, innerW])
    const y = d3.scaleLinear().domain([yMin, yMax]).range([innerH, 0])
    const area = d3.area<d3.SeriesPoint<Record<string, number>>>()
      .x((_, i) => x(i))
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(d3.curveBasis)

    const bands = stacked.map((layer) => ({
      slug: layer.key,
      path: area(layer) ?? '',
      color: colorFor(layer.key),
    }))
    return { bands, x, days, n }
  }, [data, hidden, innerW, innerH, colorFor])

  function toggle(slug: string) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    if (!data || !layout) return
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect()
    const px = e.clientX - rect.left
    const di = Math.round(layout.x.invert(px))
    const day = data.days[di]
    if (day == null) { setHover(null); return }
    // strongest contributor that day among visible
    let best: { slug: string; value: number } | null = null
    for (const s of data.series) {
      if (hidden.has(s.slug)) continue
      const v = s.values[di] ?? 0
      if (v > 0 && (!best || v > best.value)) best = { slug: s.slug, value: v }
    }
    if (!best) { setHover(null); return }
    setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, day, slug: best.slug, value: best.value })
  }

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading momentum river…</div>
      </div>
    )
  }

  const series = data?.series ?? []
  const fleetTotal = series.reduce((s, v) => s + v.total, 0)

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Fleet Momentum River
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">14-day token flow</span>
          <div className="flex-1" />
          <Link href="/burn-rate" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded">Burn Rate →</Link>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <div ref={wrapRef} className="relative rounded-lg border border-cyber-cyan/12 overflow-hidden" style={{ background: 'rgba(0,245,255,0.02)' }}>
          {!layout ? (
            <div className="h-[420px] flex items-center justify-center text-slate-600 text-xs font-mono">
              {series.length === 0 ? 'No token activity in the last 14 days.' : 'All bands hidden — re-enable from the legend.'}
            </div>
          ) : (
            <svg width={width} height={H} style={{ display: 'block' }}>
              <g transform={`translate(${M.left},${M.top})`}>
                {layout.bands.map((b) => (
                  <path
                    key={b.slug}
                    d={b.path}
                    fill={b.color}
                    opacity={hover && hover.slug !== b.slug ? 0.35 : 0.78}
                    stroke={b.color}
                    strokeWidth={0.5}
                    style={{ transition: 'opacity 0.15s' }}
                  >
                    <title>{b.slug}</title>
                  </path>
                ))}
                {/* day axis ticks */}
                {layout.days.map((d, i) => (
                  i % 2 === 0 ? (
                    <text key={d} x={layout.x(i)} y={innerH + 18} fill="#475569" fontSize={8} fontFamily="JetBrains Mono, monospace" textAnchor="middle">
                      {d.slice(5)}
                    </text>
                  ) : null
                ))}
                <rect x={0} y={0} width={innerW} height={innerH} fill="transparent"
                  onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
              </g>
            </svg>
          )}

          {hover && (
            <div
              className="pointer-events-none absolute z-20 rounded border border-cyber-cyan/30 px-2 py-1 text-[0.6rem] font-mono"
              style={{ left: Math.min(hover.x + 12, width - 150), top: hover.y + 12, background: '#0a1426', color: '#cbd5e1' }}
            >
              <div className="text-slate-500">{hover.day}</div>
              <div style={{ color: colorFor(hover.slug) }}>{hover.slug}</div>
              <div className="text-cyber-cyan">{fmtTokens(hover.value)} tokens</div>
            </div>
          )}
        </div>

        {/* legend */}
        <div className="mt-4 flex flex-wrap gap-2">
          {series.map((s) => {
            const off = hidden.has(s.slug)
            return (
              <button
                key={s.slug}
                onClick={() => toggle(s.slug)}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-[0.6rem] font-mono border transition-colors"
                style={{
                  borderColor: off ? '#1e293b' : `${colorFor(s.slug)}55`,
                  background: off ? 'transparent' : `${colorFor(s.slug)}12`,
                  color: off ? '#475569' : '#cbd5e1',
                }}
                title={off ? 'Show band' : 'Hide band'}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: off ? '#334155' : colorFor(s.slug), display: 'inline-block' }} />
                {s.slug}
                <span className="text-slate-600">{fmtTokens(s.total)}</span>
              </button>
            )
          })}
        </div>

        <p className="text-[0.5rem] font-mono text-slate-700 mt-3">
          Streamgraph (wiggle offset). Band thickness = that project&apos;s daily token total. Fleet 14-day total: {fmtTokens(fleetTotal)} tokens across {series.length} projects.
          Click a legend chip to toggle its band. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { MemoryGrowthResponse, ProjectGrowth } from '../api/memory/growth/route'

// Deterministic neon colour per slug.
const PALETTE = ['#22D3EE', '#A78BFA', '#4ADE80', '#F59E0B', '#F472B6', '#60A5FA', '#34D399', '#FB923C', '#E879F9', '#2DD4BF']
function colorFor(slug: string, i: number): string {
  return PALETTE[i % PALETTE.length]
}

export default function MemoryStreamPage() {
  const [data, setData] = useState<MemoryGrowthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [hoverDay, setHoverDay] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    function load() {
      fetch('/api/memory/growth')
        .then((r) => r.json() as Promise<MemoryGrowthResponse>)
        .then((d) => { setData(d); setLoading(false) })
        .catch(() => setLoading(false))
    }
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  const W = 920, H = 420, padL = 8, padR = 8, padT = 20, padB = 28
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const days = data?.days ?? []
  const projects = useMemo(() => data?.projects ?? [], [data])

  // Build a centered (silhouette) streamgraph: at each day, total height = sum of counts.
  const { bands, maxTotal } = useMemo(() => {
    const n = days.length
    if (n === 0 || projects.length === 0) return { bands: [] as { slug: string; color: string; pts: { x: number; y0: number; y1: number }[] }[], maxTotal: 0 }

    // total per day
    const totals = days.map((_, di) => projects.reduce((s, p) => s + (p.daily[di]?.count ?? 0), 0))
    const maxTotal = Math.max(1, ...totals)

    const x = (di: number) => padL + (n === 1 ? innerW / 2 : (di / (n - 1)) * innerW)
    const scaleY = (v: number) => (v / maxTotal) * innerH

    // stacking order: largest total at bottom (already sorted desc)
    const bands = projects.map((p, pi) => {
      const pts = days.map((_, di) => {
        // cumulative below this band
        let below = 0
        for (let k = pi + 1; k < projects.length; k++) below += projects[k].daily[di]?.count ?? 0
        const val = p.daily[di]?.count ?? 0
        const dayTotal = totals[di]
        const offset = (maxTotal - dayTotal) / 2 // silhouette centering
        const y0 = padT + innerH - scaleY(below) - scaleY(offset)
        const y1 = padT + innerH - scaleY(below + val) - scaleY(offset)
        return { x: x(di), y0, y1 }
      })
      return { slug: p.slug, color: colorFor(p.slug, pi), pts }
    })
    return { bands, maxTotal }
  }, [days, projects, innerW, innerH])

  function areaPath(pts: { x: number; y0: number; y1: number }[]): string {
    if (pts.length === 0) return ''
    const top = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y1.toFixed(1)}`).join(' ')
    const bottom = [...pts].reverse().map((p) => `L ${p.x.toFixed(1)} ${p.y0.toFixed(1)}`).join(' ')
    return `${top} ${bottom} Z`
  }

  function onMove(e: React.MouseEvent) {
    const svg = svgRef.current
    if (!svg || days.length === 0) return
    const rect = svg.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const frac = Math.max(0, Math.min(1, (px - padL) / innerW))
    setHoverDay(Math.round(frac * (days.length - 1)))
  }

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Tracing memory growth…</div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Memory Growth Stream
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">per-project memory · last {days.length}d</span>
          <div className="flex-1" />
          <Link href="/memory-health" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded">Memory Health →</Link>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {bands.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No memory entries across the fleet yet.</div>
        ) : (
          <>
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-cyber-cyan/10"
              style={{ background: 'rgba(0,245,255,0.015)' }}
              onMouseMove={onMove} onMouseLeave={() => setHoverDay(null)}>
              {bands.map((b) => (
                <path key={b.slug} d={areaPath(b.pts)} fill={`${b.color}66`} stroke={b.color} strokeWidth={0.75} strokeOpacity={0.6}>
                  <title>{b.slug}</title>
                </path>
              ))}
              {hoverDay !== null && bands[0]?.pts[hoverDay] && (
                <line x1={bands[0].pts[hoverDay].x} y1={padT} x2={bands[0].pts[hoverDay].x} y2={padT + innerH}
                  stroke="#22D3EE" strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.6} />
              )}
              {/* x-axis date ticks: first, mid, last */}
              {[0, Math.floor(days.length / 2), days.length - 1].map((di) => (
                days[di] ? (
                  <text key={di} x={padL + (days.length === 1 ? innerW / 2 : (di / (days.length - 1)) * innerW)} y={H - 8}
                    textAnchor={di === 0 ? 'start' : di === days.length - 1 ? 'end' : 'middle'}
                    fontSize={8} fill="#475569" fontFamily="JetBrains Mono, monospace">{days[di].slice(5)}</text>
                ) : null
              ))}
            </svg>

            {/* legend + hover readout */}
            <div className="mt-4 flex flex-wrap gap-2">
              {projects.map((p, i) => (
                <span key={p.slug} className="flex items-center gap-1.5 px-2 py-1 rounded text-[0.6rem] font-mono"
                  style={{ border: `1px solid ${colorFor(p.slug, i)}33`, color: '#cbd5e1' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: colorFor(p.slug, i), display: 'inline-block' }} />
                  {p.slug}
                  <span className="text-slate-600">
                    {hoverDay !== null ? (p.daily[hoverDay]?.count ?? 0) : p.total}
                  </span>
                </span>
              ))}
            </div>
            {hoverDay !== null && days[hoverDay] && (
              <div className="mt-2 text-[0.6rem] font-mono text-cyber-cyan">📅 {days[hoverDay]} — per-project memory entries shown in legend</div>
            )}
          </>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Stacked silhouette stream of cumulative memory entries per project over the last {days.length} days.
          Entry dates derived from memory-file mtime, bucketed daily. Band thickness = that project&apos;s memory count; entries predating the window seed the baseline. Hover to read per-project counts at a day. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}

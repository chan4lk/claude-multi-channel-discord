'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

interface Tile { slug: string; bytes: number }
interface Rect { x: number; y: number; w: number; h: number; tile: Tile }

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

// Heat gradient cyan (cold/small) → amber → red (hot/large) by size fraction.
function heatColor(frac: number): string {
  const f = Math.max(0, Math.min(1, frac))
  // three-stop interpolation
  const stops = [
    { t: 0, c: [34, 211, 238] }, // cyan
    { t: 0.5, c: [245, 158, 11] }, // amber
    { t: 1, c: [239, 68, 68] }, // red
  ]
  let lo = stops[0], hi = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (f >= stops[i].t && f <= stops[i + 1].t) { lo = stops[i]; hi = stops[i + 1]; break }
  }
  const span = hi.t - lo.t || 1
  const k = (f - lo.t) / span
  const ch = (a: number, b: number) => Math.round(a + (b - a) * k)
  return `rgb(${ch(lo.c[0], hi.c[0])}, ${ch(lo.c[1], hi.c[1])}, ${ch(lo.c[2], hi.c[2])})`
}

// Squarified treemap (Bruls/Huizing/van Wijk). Same technique as /themes.
function squarify(tiles: Tile[], x: number, y: number, w: number, h: number): Rect[] {
  const total = tiles.reduce((s, t) => s + t.bytes, 0)
  if (total === 0 || tiles.length === 0) return []
  const area = w * h
  const items = tiles.map((t) => ({ tile: t, area: (t.bytes / total) * area }))
  const out: Rect[] = []

  let cx = x, cy = y, cw = w, ch = h
  let row: typeof items = []

  function worst(r: typeof items, side: number): number {
    const sum = r.reduce((s, it) => s + it.area, 0)
    const max = Math.max(...r.map((it) => it.area))
    const min = Math.min(...r.map((it) => it.area))
    const s2 = sum * sum
    const side2 = side * side
    return Math.max((side2 * max) / s2, s2 / (side2 * min))
  }

  function layoutRow(r: typeof items, horizontal: boolean) {
    const sum = r.reduce((s, it) => s + it.area, 0)
    if (horizontal) {
      const rowH = sum / cw
      let ox = cx
      for (const it of r) {
        const tw = it.area / rowH
        out.push({ x: ox, y: cy, w: tw, h: rowH, tile: it.tile })
        ox += tw
      }
      cy += rowH; ch -= rowH
    } else {
      const rowW = sum / ch
      let oy = cy
      for (const it of r) {
        const th = it.area / rowW
        out.push({ x: cx, y: oy, w: rowW, h: th, tile: it.tile })
        oy += th
      }
      cx += rowW; cw -= rowW
    }
  }

  let i = 0
  while (i < items.length) {
    const side = Math.min(cw, ch)
    const next = items[i]
    if (row.length === 0) { row.push(next); i++; continue }
    const withNext = [...row, next]
    if (worst(row, side) >= worst(withNext, side)) {
      row = withNext; i++
    } else {
      layoutRow(row, cw >= ch)
      row = []
    }
  }
  if (row.length > 0) layoutRow(row, cw >= ch)
  return out
}

export default function MemoryFootprintPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null

  const W = 900, H = 460

  const tiles: Tile[] = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    return projects
      .filter((p) => p.memoryStatus?.exists && (p.memoryStatus?.sizeBytes ?? 0) > 0)
      .map((p) => ({ slug: p.slug, bytes: p.memoryStatus!.sizeBytes }))
      .sort((a, b) => b.bytes - a.bytes)
  }, [data])

  const maxBytes = tiles.length > 0 ? tiles[0].bytes : 0
  const totalBytes = useMemo(() => tiles.reduce((s, t) => s + t.bytes, 0), [tiles])
  const heaviest = tiles[0] ?? null

  const rects = useMemo(() => squarify(tiles, 0, 0, W, H), [tiles])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Measuring memory footprint…</div>
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
            Memory Footprint Treemap
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">memory bloat by project</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <Link href="/memory-audit" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded">Memory Audit →</Link>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {tiles.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No project memory files found.</div>
        ) : (
          <>
            {/* summary */}
            <div className="mb-4 flex flex-wrap gap-3 text-[0.65rem] font-mono">
              <div className="rounded-lg border border-cyber-cyan/15 px-3 py-2" style={{ background: 'rgba(0,245,255,0.03)' }}>
                <div className="text-slate-500 text-[0.55rem] uppercase tracking-wider">Total fleet memory</div>
                <div className="text-cyber-cyan text-sm font-bold">{humanBytes(totalBytes)}</div>
              </div>
              <div className="rounded-lg border border-rose-500/20 px-3 py-2" style={{ background: 'rgba(239,68,68,0.04)' }}>
                <div className="text-slate-500 text-[0.55rem] uppercase tracking-wider">Heaviest project</div>
                <div className="text-sm font-bold" style={{ color: heatColor(1) }}>
                  {heaviest ? `${heaviest.slug} · ${humanBytes(heaviest.bytes)}` : '—'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-700/40 px-3 py-2" style={{ background: 'rgba(255,255,255,0.015)' }}>
                <div className="text-slate-500 text-[0.55rem] uppercase tracking-wider">Projects with memory</div>
                <div className="text-slate-200 text-sm font-bold">{tiles.length}</div>
              </div>
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-cyber-cyan/10" style={{ background: 'rgba(0,245,255,0.015)' }}>
              {rects.map((r) => {
                const frac = maxBytes > 0 ? r.tile.bytes / maxBytes : 0
                const c = heatColor(frac)
                const pad = 1.5
                const innerW = Math.max(0, r.w - pad * 2)
                const innerH = Math.max(0, r.h - pad * 2)
                const showLabel = innerW > 54 && innerH > 26
                return (
                  <Link key={r.tile.slug} href={`/memory-audit?slug=${encodeURIComponent(r.tile.slug)}`}>
                    <g style={{ cursor: 'pointer' }}>
                      <rect x={r.x + pad} y={r.y + pad} width={innerW} height={innerH} rx={3}
                        fill={`${c}33`} stroke={`${c}99`} strokeWidth={1} />
                      {showLabel && (
                        <>
                          <text x={r.x + pad + 6} y={r.y + pad + 16} fontSize={12} fontWeight={800} fill={c}
                            fontFamily="Orbitron, monospace">{r.tile.slug}</text>
                          <text x={r.x + pad + 6} y={r.y + pad + 30} fontSize={9} fill="#cbd5e1"
                            fontFamily="JetBrains Mono, monospace">{humanBytes(r.tile.bytes)}</text>
                        </>
                      )}
                      <title>{`${r.tile.slug}: ${humanBytes(r.tile.bytes)} (${maxBytes > 0 ? Math.round(frac * 100) : 0}% of heaviest)`}</title>
                    </g>
                  </Link>
                )
              })}
            </svg>

            {/* heat legend */}
            <div className="mt-4 flex items-center gap-2 text-[0.55rem] font-mono text-slate-500">
              <span>smaller</span>
              <div className="h-2 w-40 rounded" style={{ background: `linear-gradient(to right, ${heatColor(0)}, ${heatColor(0.5)}, ${heatColor(1)})` }} />
              <span>larger</span>
            </div>
          </>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Tile area ∝ each project&apos;s <code>MEMORY.md</code> size in bytes (from <code>/api/fleet</code>). Fill color heats with size.
          Click a tile to open that project&apos;s Memory Audit. Projects without a memory file are omitted. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { ThemesResponse, ThemeBucket, ThemeProposal } from '../api/metrics/themes/route'

const THEME_COLORS: Record<string, string> = {
  graph: '#22D3EE',
  memory: '#A78BFA',
  scheduler: '#F59E0B',
  metrics: '#4ADE80',
  alerts: '#EF4444',
  git: '#60A5FA',
  whatsapp: '#34D399',
  ui: '#F472B6',
  other: '#64748B',
}

function themeColor(theme: string): string {
  return THEME_COLORS[theme] ?? '#64748B'
}

interface Rect { x: number; y: number; w: number; h: number; bucket: ThemeBucket }

// Squarified treemap (Bruls/Huizing/van Wijk). Lays buckets into rect; tiles aim for aspect≈1.
function squarify(buckets: ThemeBucket[], x: number, y: number, w: number, h: number): Rect[] {
  const total = buckets.reduce((s, b) => s + b.total, 0)
  if (total === 0 || buckets.length === 0) return []
  const area = w * h
  // Map each bucket to its target pixel area.
  const items = buckets.map((b) => ({ bucket: b, area: (b.total / total) * area }))
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
        out.push({ x: ox, y: cy, w: tw, h: rowH, bucket: it.bucket })
        ox += tw
      }
      cy += rowH; ch -= rowH
    } else {
      const rowW = sum / ch
      let oy = cy
      for (const it of r) {
        const th = it.area / rowW
        out.push({ x: cx, y: oy, w: rowW, h: th, bucket: it.bucket })
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

export default function ThemesPage() {
  const [data, setData] = useState<ThemesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    function load() {
      fetch('/api/metrics/themes')
        .then((r) => r.json() as Promise<ThemesResponse>)
        .then((d) => { setData(d); setLoading(false) })
        .catch(() => setLoading(false))
    }
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  const W = 900, H = 460
  const rects = useMemo(() => squarify(data?.themes ?? [], 0, 0, W, H), [data])

  const selectedProposals: ThemeProposal[] = useMemo(() => {
    if (!data || !selected) return []
    return data.proposals.filter((p) => p.theme === selected)
  }, [data, selected])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Classifying proposals…</div>
      </div>
    )
  }

  const themes = data?.themes ?? []

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Proposal Theme Treemap
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">effort distribution by theme</span>
          <div className="flex-1" />
          <Link href="/burndown" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded">Burndown →</Link>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {themes.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No proposals found.</div>
        ) : (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-cyber-cyan/10" style={{ background: 'rgba(0,245,255,0.015)' }}>
              {rects.map((r) => {
                const c = themeColor(r.bucket.theme)
                const doneFrac = r.bucket.total > 0 ? r.bucket.done / r.bucket.total : 0
                const isSel = selected === r.bucket.theme
                const pad = 1.5
                const innerW = Math.max(0, r.w - pad * 2)
                const innerH = Math.max(0, r.h - pad * 2)
                const showLabel = innerW > 54 && innerH > 28
                return (
                  <g key={r.bucket.theme}
                    onClick={() => setSelected(isSel ? null : r.bucket.theme)}
                    style={{ cursor: 'pointer' }}>
                    {/* base tile (pending portion) */}
                    <rect x={r.x + pad} y={r.y + pad} width={innerW} height={innerH} rx={3}
                      fill={`${c}1c`} stroke={isSel ? c : `${c}55`} strokeWidth={isSel ? 2 : 1} />
                    {/* done fill bar from bottom */}
                    <rect x={r.x + pad} y={r.y + pad + innerH * (1 - doneFrac)} width={innerW} height={innerH * doneFrac} rx={3}
                      fill={`${c}4d`} />
                    {showLabel && (
                      <>
                        <text x={r.x + pad + 6} y={r.y + pad + 16} fontSize={12} fontWeight={800} fill={c}
                          fontFamily="Orbitron, monospace">{r.bucket.theme}</text>
                        <text x={r.x + pad + 6} y={r.y + pad + 30} fontSize={9} fill="#cbd5e1"
                          fontFamily="JetBrains Mono, monospace">{r.bucket.total} props · {r.bucket.done}✓ {r.bucket.pending}◌</text>
                        <text x={r.x + pad + 6} y={r.y + pad + 42} fontSize={8} fill="#64748b"
                          fontFamily="JetBrains Mono, monospace">{Math.round(doneFrac * 100)}% done</text>
                      </>
                    )}
                    <title>{`${r.bucket.theme}: ${r.bucket.total} proposals, ${r.bucket.done} done, ${r.bucket.pending} pending`}</title>
                  </g>
                )
              })}
            </svg>

            {/* legend */}
            <div className="mt-4 flex flex-wrap gap-2">
              {themes.map((t) => {
                const c = themeColor(t.theme)
                const isSel = selected === t.theme
                return (
                  <button key={t.theme} onClick={() => setSelected(isSel ? null : t.theme)}
                    className="flex items-center gap-1.5 px-2 py-1 rounded text-[0.6rem] font-mono transition-colors"
                    style={{ border: `1px solid ${isSel ? c : `${c}33`}`, background: isSel ? `${c}14` : 'transparent', color: isSel ? c : '#94a3b8' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: 'inline-block' }} />
                    {t.theme} <span className="text-slate-600">{t.total}</span>
                  </button>
                )
              })}
            </div>

            {selected && (
              <div className="mt-4 rounded-lg border border-cyber-cyan/10 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
                <div className="text-[0.7rem] font-mono mb-2" style={{ color: themeColor(selected) }}>
                  {selected} — {selectedProposals.length} proposals
                </div>
                <div className="space-y-1">
                  {selectedProposals.map((p) => (
                    <div key={p.number} className="flex items-center gap-2 text-[0.65rem] font-mono">
                      <span className="text-slate-600 w-10">P{p.number}</span>
                      <span className="px-1.5 py-0.5 rounded text-[0.5rem] font-bold uppercase"
                        style={{
                          color: p.status === 'done' ? '#4ADE80' : '#F59E0B',
                          border: `1px solid ${p.status === 'done' ? '#4ADE8040' : '#F59E0B40'}`,
                          background: p.status === 'done' ? '#4ADE8012' : '#F59E0B12',
                        }}>{p.status}</span>
                      <span className="text-slate-300 truncate">{p.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Tile area ∝ proposal count per theme. Fill bar (bottom-up) shows the done proportion. Themes inferred by keyword from each proposal&apos;s title and solution.
          Click a tile or legend chip to list its proposals. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}

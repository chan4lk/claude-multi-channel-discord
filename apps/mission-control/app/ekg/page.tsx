'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { EkgResponse, EkgSourceKey } from '../api/ekg/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

const SOURCE_COLOR: Record<EkgSourceKey, string> = {
  alerts: '#ef4444',
  injects: '#22d3ee',
  memory: '#a78bfa',
  digests: '#f59e0b',
  broadcasts: '#34d399',
}

function hourLabel(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  return d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function EkgPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<EkgResponse>('/api/ekg', 60_000)
  const [hovered, setHovered] = useState<number | null>(null)
  const loading = data === null && lastError === null

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading fleet EKG…</div>
      </div>
    )
  }

  const sources = data?.sources ?? []
  const bins = data?.bins ?? []
  const total = data?.total ?? 0
  const busiest = data?.busiestHour ?? null
  const hoveredBin = hovered != null ? bins[hovered] : null

  // Per-source peak for independent lane scaling.
  const laneMax: Record<string, number> = {}
  for (const s of sources) {
    laneMax[s.key] = Math.max(1, ...bins.map((b) => b.counts[s.key]))
  }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Fleet Activity EKG
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">{data?.windowHours ?? 48}h · hourly</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">events</span>
              <span className="text-lg font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{total}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">busiest</span>
              <span className="text-xs font-mono tabular-nums text-slate-300">{busiest ? hourLabel(busiest.hourStart) : '—'}</span>
              {busiest && <span className="text-[0.6rem] font-mono text-slate-500">({busiest.total})</span>}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 w-full">
        {total === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No fleet activity in the last {data?.windowHours ?? 48} hours.</div>
        ) : (
          <div className="rounded-lg border border-cyber-cyan/10 bg-[#0a1424]/30 p-4 max-w-5xl">
            <div className="flex flex-col gap-3" onMouseLeave={() => setHovered(null)}>
              {sources.map((s) => {
                const color = SOURCE_COLOR[s.key]
                const max = laneMax[s.key]
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <div className="w-24 shrink-0 flex flex-col items-end">
                      <span className="text-[0.65rem] font-bold" style={{ color }}>{s.label}</span>
                      <span className="text-[0.55rem] font-mono tabular-nums text-slate-500">{s.total}</span>
                    </div>
                    <div className="flex-1 flex items-end gap-px h-10">
                      {bins.map((b, i) => {
                        const n = b.counts[s.key]
                        const h = n === 0 ? 2 : Math.max(3, Math.round((n / max) * 40))
                        const active = hovered === i
                        return (
                          <div
                            key={i}
                            className="flex-1 rounded-sm transition-opacity"
                            style={{
                              height: `${h}px`,
                              background: n === 0 ? '#1e293b' : color,
                              opacity: hovered == null || active ? 1 : 0.3,
                            }}
                            onMouseEnter={() => setHovered(i)}
                            title={`${hourLabel(b.hourStart)} · ${s.label}: ${n}`}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Shared time axis */}
            <div className="flex items-center gap-3 mt-2">
              <div className="w-24 shrink-0" />
              <div className="flex-1 flex justify-between text-[0.5rem] font-mono text-slate-600">
                <span>{bins[0] ? hourLabel(bins[0].hourStart) : ''}</span>
                <span>now</span>
              </div>
            </div>

            {/* Hover detail strip */}
            <div className="mt-4 min-h-[2.5rem] border-t border-slate-800/60 pt-3">
              {hoveredBin ? (
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-[0.65rem] font-mono text-slate-300">{hourLabel(hoveredBin.hourStart)}</span>
                  {sources.map((s) => (
                    <span key={s.key} className="inline-flex items-center gap-1.5 text-[0.6rem] font-mono tabular-nums">
                      <span className="w-2 h-2 rounded-sm" style={{ background: SOURCE_COLOR[s.key] }} />
                      <span className="text-slate-500">{s.label}</span>
                      <span style={{ color: SOURCE_COLOR[s.key] }}>{hoveredBin.counts[s.key]}</span>
                    </span>
                  ))}
                  <span className="text-[0.6rem] font-mono text-slate-400">total {hoveredBin.total}</span>
                </div>
              ) : (
                <span className="text-[0.55rem] font-mono text-slate-600">Hover a column for per-source hourly counts.</span>
              )}
            </div>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-6 max-w-3xl">
          Cross-source fleet rhythm over the last {data?.windowHours ?? 48} hours. Activity from five sources —
          alerts, injects, memory diffs, digests, and broadcasts — bucketed into hourly bins, one stacked lane per
          source on a shared time axis so spikes line up vertically. Lanes scale independently; hovering a column
          reveals per-source counts for that hour. Reuses <code>/api/ekg</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}

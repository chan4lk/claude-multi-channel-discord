'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject, GoalStatus } from '../api/fleet/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

interface Pt {
  slug: string
  bytes: number
  logBytes: number // log10(bytes)
  conv: number // convergenceScore 0..1
  goalStatus: GoalStatus | 'none'
  goalText: string
}

function goalColor(s: GoalStatus | 'none'): string {
  switch (s) {
    case 'active': return '#22d3ee'
    case 'completed': return '#34d399'
    case 'paused': return '#f59e0b'
    default: return '#64748b'
  }
}

function fmtBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}MB`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}kB`
  return `${n}B`
}

const W = 520
const H = 420
const PAD = 44

export default function MemoryConvergencePage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<FleetResponse>('/api/fleet', 60_000)
  const loading = data === null && lastError === null
  const [hover, setHover] = useState<string | null>(null)

  const pts: Pt[] = useMemo(() => {
    const projects = (data?.projects ?? []) as FleetProject[]
    return projects
      .filter((p) => p.memoryStatus?.exists && (p.memoryStatus.sizeBytes ?? 0) > 0 && p.convergenceScore != null)
      .map((p) => ({
        slug: p.slug,
        bytes: p.memoryStatus!.sizeBytes,
        logBytes: Math.log10(Math.max(1, p.memoryStatus!.sizeBytes)),
        conv: Math.max(0, Math.min(1, p.convergenceScore!)),
        goalStatus: p.goalStatus ?? 'none',
        goalText: p.goalText ?? '',
      }))
  }, [data])

  // x-domain from log bytes (pad ±0.3 decade); split at the midpoint for the quadrant guide.
  const { xMin, xMax, xMid } = useMemo(() => {
    if (pts.length === 0) return { xMin: 0, xMax: 1, xMid: 0.5 }
    const lo = Math.min(...pts.map((p) => p.logBytes))
    const hi = Math.max(...pts.map((p) => p.logBytes))
    const xMin = lo - 0.3
    const xMax = hi + 0.3
    return { xMin, xMax, xMid: (xMin + xMax) / 2 }
  }, [pts])

  // Prune candidates: heavy memory (right of midpoint) + low convergence (<0.5).
  const pruneCandidates = pts.filter((p) => p.logBytes > xMid && p.conv < 0.5)

  // Coarse correlation hint (Pearson on logBytes vs conv).
  const corrHint = useMemo(() => {
    const n = pts.length
    if (n < 3) return 'n/a'
    const mx = pts.reduce((s, p) => s + p.logBytes, 0) / n
    const my = pts.reduce((s, p) => s + p.conv, 0) / n
    let num = 0, dx = 0, dy = 0
    for (const p of pts) {
      num += (p.logBytes - mx) * (p.conv - my)
      dx += (p.logBytes - mx) ** 2
      dy += (p.conv - my) ** 2
    }
    if (dx === 0 || dy === 0) return 'none'
    const r = num / Math.sqrt(dx * dy)
    if (r > 0.3) return `positive (${r.toFixed(2)})`
    if (r < -0.3) return `negative (${r.toFixed(2)})`
    return `weak/none (${r.toFixed(2)})`
  }, [pts])

  const plotW = W - PAD * 2
  const plotH = H - PAD * 2
  const sx = (lb: number) => PAD + ((lb - xMin) / (xMax - xMin || 1)) * plotW
  const sy = (c: number) => PAD + (1 - c) * plotH

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Correlating memory vs convergence…</div>
      </div>
    )
  }

  const hp = pts.find((p) => p.slug === hover)

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Memory vs Convergence
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">does memory footprint buy goal progress?</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">corr</span>
              <span className="text-[0.65rem] font-black tabular-nums text-cyber-cyan" style={{ fontFamily: 'Orbitron, monospace' }}>{corrHint}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">prune</span>
              <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: pruneCandidates.length > 0 ? '#ef4444' : '#475569' }}>{pruneCandidates.length}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-3xl mx-auto w-full">
        {pts.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects with both a memory footprint and a convergence score.</div>
        ) : (
          <div className="rounded-xl border border-cyber-cyan/12 p-4 relative" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet">
              {/* quadrant guides */}
              <line x1={sx(xMid)} x2={sx(xMid)} y1={PAD} y2={H - PAD} stroke="#334155" strokeWidth={0.6} strokeDasharray="3 3" />
              <line x1={PAD} x2={W - PAD} y1={sy(0.5)} y2={sy(0.5)} stroke="#334155" strokeWidth={0.6} strokeDasharray="3 3" />
              <rect x={PAD} y={PAD} width={plotW} height={plotH} fill="none" stroke="#1e293b" strokeWidth={0.8} />
              {/* quadrant labels */}
              <text x={PAD + 4} y={sy(0.97)} fontSize={8} fill="#34d399" fontFamily="monospace">lean &amp; converging</text>
              <text x={W - PAD - 4} y={sy(0.97)} fontSize={8} fill="#22d3ee" textAnchor="end" fontFamily="monospace">heavy &amp; converging</text>
              <text x={PAD + 4} y={sy(0.04)} fontSize={8} fill="#64748b" fontFamily="monospace">lean &amp; stalled</text>
              <text x={W - PAD - 4} y={sy(0.04)} fontSize={8} fill="#ef4444" textAnchor="end" fontFamily="monospace">heavy &amp; stalled — prune</text>
              {/* axis labels */}
              <text x={PAD + plotW / 2} y={H - 12} textAnchor="middle" fontSize={8} fill="#64748b" fontFamily="monospace">memory size (log) →</text>
              <text x={14} y={PAD + plotH / 2} textAnchor="middle" fontSize={8} fill="#64748b" fontFamily="monospace" transform={`rotate(-90 14 ${PAD + plotH / 2})`}>convergence →</text>
              {/* points */}
              {pts.map((p) => {
                const active = hover === p.slug
                return (
                  <circle
                    key={p.slug}
                    cx={sx(p.logBytes)} cy={sy(p.conv)} r={active ? 7 : 5}
                    fill={goalColor(p.goalStatus)}
                    fillOpacity={active ? 0.95 : 0.6}
                    stroke={active ? '#fff' : goalColor(p.goalStatus)}
                    strokeWidth={active ? 1.2 : 0.5}
                    onMouseEnter={() => setHover(p.slug)}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: 'pointer' }}
                  />
                )
              })}
            </svg>

            {hp && (
              <div className="absolute top-6 right-6 max-w-[12rem] bg-[#0a1424] border border-cyber-cyan/30 rounded px-2.5 py-1.5 text-[0.55rem] font-mono pointer-events-none">
                <div className="font-bold text-slate-100" style={{ fontFamily: 'Orbitron, monospace' }}>{hp.slug}</div>
                <div className="text-slate-400">memory {fmtBytes(hp.bytes)} · conv {Math.round(hp.conv * 100)}%</div>
                {hp.goalText && <div className="text-slate-500 truncate">{hp.goalText}</div>}
              </div>
            )}

            <div className="mt-3 flex items-center gap-3 text-[0.55rem] font-mono text-slate-500 flex-wrap border-t border-slate-800 pt-2">
              {(['active', 'completed', 'paused', 'none'] as const).map((s) => (
                <span key={s} className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: goalColor(s) }} />{s}</span>
              ))}
              <span className="text-slate-600">· color = goal status</span>
            </div>
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Bubble per project with both a memory footprint and a <code>convergenceScore</code>.
          x = log-scaled <code>memoryStatus.sizeBytes</code>, y = convergence, color by goal status.
          Quadrant guides cross at the memory midpoint / 50% convergence; the bottom-right quadrant
          (heavy memory, stalled) lists prune candidates counted in the header, alongside a coarse
          memory↔convergence correlation hint. Reuses <code>/api/fleet</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}

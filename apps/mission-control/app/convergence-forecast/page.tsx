'use client'

import Link from 'next/link'
import type { ConvergenceForecastResponse, ForecastProject, ForecastStatus } from '../api/convergence-forecast/route'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'

// Sparkline geometry (per-row).
const SW = 180
const SH = 36
const FORECAST = 40 // px reserved on the right for the dashed forecast segment

function statusColor(s: ForecastStatus): string {
  switch (s) {
    case 'reached': return '#22d3ee'
    case 'rising': return '#34d399'
    case 'declining': return '#ef4444'
    default: return '#eab308' // stalled
  }
}

function statusLabel(p: ForecastProject): string {
  switch (p.status) {
    case 'reached': return '✓ reached'
    case 'rising': return p.etaDays != null ? `~${p.etaDays}d` : 'rising'
    case 'declining': return 'declining'
    default: return 'stalled'
  }
}

function slopeArrow(slope: number): string {
  if (slope > 0.05) return '↗'
  if (slope < -0.05) return '↘'
  return '→'
}

function Row({ p, target }: { p: ForecastProject; target: number }) {
  const color = statusColor(p.status)
  const scores = p.points.map((pt) => pt.score)
  const lo = Math.min(target, ...scores)
  const hi = Math.max(target, ...scores)
  const span = Math.max(1, hi - lo)
  const plotW = SW - FORECAST
  const x = (i: number) => (p.points.length <= 1 ? 0 : (i / (p.points.length - 1)) * plotW)
  const y = (s: number) => SH - ((s - lo) / span) * SH
  const path = p.points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pt.score).toFixed(1)}`).join(' ')

  // Dashed forecast extension from the last point to the target line (only when an ETA exists).
  const lastX = x(p.points.length - 1)
  const lastY = y(p.points[p.points.length - 1].score)
  const targetY = y(target)

  return (
    <Link
      href={`/focus/${encodeURIComponent(p.slug)}`}
      className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-800 hover:border-cyber-cyan/40 transition-colors"
      style={{ background: 'rgba(255,255,255,0.01)' }}
    >
      <span className="text-[0.7rem] font-mono text-slate-200 flex-1 truncate min-w-0">{p.slug}</span>

      <svg viewBox={`0 0 ${SW} ${SH}`} width={SW} height={SH} className="shrink-0" preserveAspectRatio="none">
        {/* target line */}
        <line x1={0} x2={SW} y1={targetY} y2={targetY} stroke="#334155" strokeWidth={0.6} strokeDasharray="2 3" />
        {/* historical */}
        <path d={path} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
        {/* forecast extension to target */}
        {p.etaDays != null && (
          <line x1={lastX} y1={lastY} x2={SW} y2={targetY} stroke={color} strokeWidth={1} strokeDasharray="3 2" opacity={0.7} />
        )}
        {/* latest dot */}
        <circle cx={lastX} cy={lastY} r={2} fill={color} />
      </svg>

      <span className="text-[0.55rem] font-mono text-slate-500 tabular-nums w-7 text-right" title="slope/day">{slopeArrow(p.slope)}</span>
      <span className="text-[0.7rem] font-black tabular-nums w-10 text-right text-slate-200" style={{ fontFamily: 'Orbitron, monospace' }}>{p.current}</span>
      <span className="text-[0.6rem] font-mono font-bold tabular-nums w-16 text-right" style={{ color }}>{statusLabel(p)}</span>
    </Link>
  )
}

export default function ConvergenceForecastPage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<ConvergenceForecastResponse>('/api/convergence-forecast', 60_000)
  const loading = data === null && lastError === null

  const projects = data?.projects ?? []
  const target = data?.target ?? 90

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Forecasting convergence trajectories…</div>
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
            Convergence Forecast
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">who reaches {target} first — and who&apos;s sliding back?</span>
          <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">reaching ≤{data?.windowDays ?? 30}d</span>
            <span className="text-lg font-black tabular-nums" style={{ fontFamily: 'Orbitron, monospace', color: (data?.reachingWithinWindow ?? 0) > 0 ? '#34d399' : '#475569' }}>{data?.reachingWithinWindow ?? 0}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-2xl mx-auto w-full">
        {projects.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects with ≥3 convergence points over the last {data?.windowDays ?? 30} days.</div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              {projects.map((p) => <Row key={p.slug} p={p} target={target} />)}
            </div>

            <div className="mt-4 flex items-center gap-3 text-[0.55rem] font-mono text-slate-500 flex-wrap border-t border-slate-800 pt-2">
              {(['rising', 'stalled', 'declining', 'reached'] as const).map((s) => (
                <span key={s} className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: statusColor(s) }} />{s}</span>
              ))}
              <span className="text-slate-600">· dashed = forecast to target</span>
            </div>
          </>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          One row per project with ≥3 <code>convergence_history</code> points over the last {data?.windowDays ?? 30} days, sorted
          by soonest time-to-target. A least-squares trend is fit over each project&apos;s window; the dashed segment projects
          that slope forward to the {target} target line and the ETA (e.g. <code>~6d</code>) is days to cross it. Rising slopes
          show a green sparkline and an ETA; flat slopes are stalled; negative slopes are declining (no ETA); projects already
          at ≥{target} read <code>✓ reached</code>. The header counts projects forecast to reach target within the window.
          Pure client-side fit over <code>/api/convergence-forecast</code>. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}

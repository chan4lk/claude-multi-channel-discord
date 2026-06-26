'use client'

import { useEffect, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { SessionLengthResponse, SessionRecord } from '../api/session-length/route'

const PALETTE = [
  '#22D3EE','#A78BFA','#F59E0B','#34D399','#F87171',
  '#60A5FA','#FB923C','#A3E635','#E879F9','#2DD4BF',
  '#FBBF24','#818CF8','#4ADE80','#F472B6','#38BDF8',
  '#C084FC','#FCD34D','#6EE7B7','#FCA5A5','#93C5FD',
]

interface TooltipState { session: SessionRecord; x: number; y: number }

function ScatterPlot({ sessions, slugIndex }: { sessions: SessionRecord[]; slugIndex: Map<string, number> }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const W = 600, H = 300
  const PAD_L = 48, PAD_R = 16, PAD_T = 12, PAD_B = 36
  const cW = W - PAD_L - PAD_R
  const cH = H - PAD_T - PAD_B

  const maxTurns = Math.max(1, ...sessions.map((s) => s.turns))
  const maxDur = Math.max(1, ...sessions.map((s) => s.durationMinutes))

  function xOf(turns: number) { return PAD_L + (turns / maxTurns) * cW }
  function yOf(dur: number) { return PAD_T + cH - (dur / maxDur) * cH }

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * maxTurns))
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * maxDur))

  return (
    <div className="relative">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ maxWidth: W }}>
        {/* Grid */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD_L} y1={yOf(v)} x2={W - PAD_R} y2={yOf(v)} stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
            <text x={PAD_L - 4} y={yOf(v) + 3} textAnchor="end" fill="#334155" fontSize="0.38rem" fontFamily="monospace">{v}m</text>
          </g>
        ))}
        {xTicks.map((v) => (
          <g key={v}>
            <line x1={xOf(v)} y1={PAD_T} x2={xOf(v)} y2={H - PAD_B} stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
            <text x={xOf(v)} y={H - PAD_B + 12} textAnchor="middle" fill="#334155" fontSize="0.38rem" fontFamily="monospace">{v}</text>
          </g>
        ))}

        {/* Axis labels */}
        <text x={W / 2} y={H - 2} textAnchor="middle" fill="#475569" fontSize="0.42rem" fontFamily="monospace">turns</text>
        <text x={10} y={H / 2} textAnchor="middle" fill="#475569" fontSize="0.42rem" fontFamily="monospace"
          transform={`rotate(-90, 10, ${H / 2})`}>duration (min)</text>

        {/* Dots */}
        {sessions.map((s, i) => {
          const idx = slugIndex.get(s.slug) ?? 0
          const color = PALETTE[idx % PALETTE.length]!
          return (
            <circle
              key={i}
              cx={xOf(s.turns)} cy={yOf(s.durationMinutes)}
              r={4} fill={color} opacity={0.7}
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => {
                const r = (e.target as SVGCircleElement).getBoundingClientRect()
                setTooltip({ session: s, x: r.left + 4, y: r.top })
              }}
              onMouseLeave={() => setTooltip(null)}
            />
          )
        })}
      </svg>

      {tooltip && (
        <div className="fixed z-50 pointer-events-none rounded border border-white/10 px-2 py-1.5 text-[0.5rem] font-mono leading-relaxed"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10, background: 'rgba(8,15,28,0.95)', backdropFilter: 'blur(6px)' }}>
          <div className="text-slate-300">{tooltip.session.slug}</div>
          <div className="text-slate-500">{tooltip.session.date} · {tooltip.session.sessionId}</div>
          <div className="text-cyan-400">{tooltip.session.turns} turns · {tooltip.session.durationMinutes}m</div>
        </div>
      )}
    </div>
  )
}

function TurnHistogram({ sessions }: { sessions: SessionRecord[] }) {
  if (sessions.length === 0) return null
  const maxTurns = Math.max(...sessions.map((s) => s.turns))
  const BUCKETS = 10
  const bucketSize = Math.max(1, Math.ceil(maxTurns / BUCKETS))
  const counts = Array(BUCKETS).fill(0)
  for (const s of sessions) {
    const bi = Math.min(BUCKETS - 1, Math.floor(s.turns / bucketSize))
    counts[bi]++
  }
  const maxCount = Math.max(1, ...counts)

  return (
    <div className="mt-4">
      <div className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-2">Turn count histogram</div>
      <div className="flex items-end gap-px h-16">
        {counts.map((c: number, i: number) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
            <div className="w-full rounded-t-sm" style={{
              height: `${Math.max(2, (c / maxCount) * 56)}px`,
              background: c > 0 ? `rgba(34,211,238,${0.3 + 0.7 * (c / maxCount)})` : 'rgba(255,255,255,0.04)',
            }} title={`${c} sessions`} />
            <span className="text-[0.35rem] font-mono text-slate-700">{i * bucketSize}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SessionLengthPage() {
  const [data, setData] = useState<SessionLengthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/session-length?days=30')
      .then((r) => r.json())
      .then((d: SessionLengthResponse) => { setData(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [])

  const sessions = data?.sessions ?? []
  const slugs = [...new Set(sessions.map((s) => s.slug))].sort()
  const slugIndex = new Map(slugs.map((s, i) => [s, i]))

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Session Length Distribution">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Turn count × wall-clock duration per session · last 30 days
        </span>
      </SubPageHeader>

      {loading && <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>}
      {error && <div className="text-center py-20 text-red-500 font-mono text-sm">{error}</div>}

      {!loading && !error && data && (
        <div className="max-w-4xl mx-auto">
          {sessions.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">No session data found</div>
          ) : (
            <>
              {/* Stats header */}
              <div className="flex flex-wrap gap-6 mb-5 text-[0.6rem] font-mono text-slate-500">
                <span>Median turns: <span className="text-cyan-400">{data.medianTurns}</span></span>
                <span>Median duration: <span className="text-cyan-400">{data.medianDurationMinutes}m</span></span>
                {data.longestSession && (
                  <span>Longest: <span className="text-cyan-400">{data.longestSession.slug}</span>
                    {' '}— {data.longestSession.turns} turns</span>
                )}
                <span>Sessions: <span className="text-slate-300">{sessions.length}</span></span>
              </div>

              <div className="rounded-lg border border-white/5 p-4 mb-5" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <div className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-3">
                  Scatter: x = turns, y = duration (min) · dot color = project
                </div>
                <ScatterPlot sessions={sessions} slugIndex={slugIndex} />
                <TurnHistogram sessions={sessions} />
              </div>

              {/* Project legend */}
              <div className="rounded-lg border border-white/5 p-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <div className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-2">Projects</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {slugs.map((s, i) => (
                    <div key={s} className="flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                      <span className="text-[0.48rem] font-mono text-slate-400">{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="text-[0.5rem] font-mono text-slate-700 text-right mt-3">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  )
}

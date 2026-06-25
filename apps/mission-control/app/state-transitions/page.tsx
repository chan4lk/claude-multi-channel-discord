'use client'

import { useEffect, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { StateTransitionsResponse, StateLabel, Transition, StateTotal } from '../api/state-transitions/route'

const STATE_COLOR: Record<StateLabel, string> = {
  idle: '#475569',
  active: '#22D3EE',
  stuck: '#F59E0B',
  'circuit-open': '#EF4444',
}

const STATE_ORDER: StateLabel[] = ['idle', 'active', 'stuck', 'circuit-open']

function fmtDuration(ms: number | null): string {
  if (ms === null) return '—'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

function SankeyDiagram({ transitions, stateTotals }: { transitions: Transition[]; stateTotals: StateTotal[] }) {
  const W = 500, H = 280
  const NODE_W = 18, NODE_GAP = 56
  const COLS = { idle: 40, active: 180, stuck: 320, 'circuit-open': 440 }

  // Node heights proportional to entries
  const maxEntries = Math.max(1, ...stateTotals.map((s) => s.entries))
  const nodeH: Record<string, number> = {}
  const nodeY: Record<string, number> = {}

  const totalsByState: Record<string, StateTotal> = {}
  for (const s of stateTotals) totalsByState[s.state] = s

  STATE_ORDER.forEach((state) => {
    const entries = totalsByState[state]?.entries ?? 0
    nodeH[state] = Math.max(24, (entries / maxEntries) * (H - 40))
    nodeY[state] = (H - nodeH[state]!) / 2
  })

  const maxCount = Math.max(1, ...transitions.map((t) => t.count))

  // Track vertical offsets for flow attachment
  const fromOffsets: Record<string, number> = {}
  const toOffsets: Record<string, number> = {}
  for (const s of STATE_ORDER) {
    fromOffsets[s] = nodeY[s]!
    toOffsets[s] = nodeY[s]!
  }

  const flows: Array<{
    path: string
    color: string
    width: number
    opacity: number
    label: string
    count: number
  }> = []

  for (const t of transitions) {
    const flowH = Math.max(2, (t.count / maxCount) * 40)
    const x1 = COLS[t.from] + NODE_W
    const y1 = fromOffsets[t.from]! + flowH / 2
    const x2 = COLS[t.to]
    const y2 = toOffsets[t.to]! + flowH / 2

    fromOffsets[t.from]! += flowH + 2
    toOffsets[t.to]! += flowH + 2

    const cx1 = x1 + (x2 - x1) * 0.4
    const cx2 = x2 - (x2 - x1) * 0.4

    flows.push({
      path: `M ${x1} ${y1 - flowH / 2} C ${cx1} ${y1 - flowH / 2}, ${cx2} ${y2 - flowH / 2}, ${x2} ${y2 - flowH / 2} L ${x2} ${y2 + flowH / 2} C ${cx2} ${y2 + flowH / 2}, ${cx1} ${y1 + flowH / 2}, ${x1} ${y1 + flowH / 2} Z`,
      color: STATE_COLOR[t.from],
      width: flowH,
      opacity: 0.3 + 0.5 * (t.count / maxCount),
      label: `${t.from}→${t.to}: ${t.count}`,
      count: t.count,
    })
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 300 }}>
      <defs>
        <filter id="st-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Flow paths */}
      {flows.map((f, i) => (
        <path key={i} d={f.path} fill={f.color} fillOpacity={f.opacity} stroke="none">
          <title>{f.label}</title>
        </path>
      ))}

      {/* State nodes */}
      {STATE_ORDER.map((state) => {
        const st = totalsByState[state]
        if (!st && !nodeH[state]) return null
        const h = nodeH[state]!
        const y = nodeY[state]!
        const x = COLS[state]
        const color = STATE_COLOR[state]
        return (
          <g key={state}>
            <rect
              x={x} y={y} width={NODE_W} height={h}
              fill={color} rx={3} filter="url(#st-glow)"
            />
            {/* Label above */}
            <text
              x={x + NODE_W / 2} y={y - 8}
              textAnchor="middle" fill={color}
              fontSize="0.5rem" fontFamily="monospace"
            >
              {state}
            </text>
            {/* Pct inside node if tall enough */}
            {h > 30 && st && (
              <text
                x={x + NODE_W / 2} y={y + h / 2 + 4}
                textAnchor="middle" fill="#0f172a"
                fontSize="0.45rem" fontFamily="monospace" fontWeight="bold"
              >
                {st.pct}%
              </text>
            )}
          </g>
        )
      })}

      {/* Flow count labels on visible flows */}
      {flows.filter((f) => f.count >= 3 && f.width >= 8).map((f, i) => {
        // Extract midpoint from path (rough)
        const parts = f.path.match(/M (\d+\.?\d*) (\d+\.?\d*)/)
        if (!parts) return null
        return (
          <text
            key={`lbl-${i}`}
            x={Number(parts[1]) + 30}
            y={Number(parts[2]) + f.width / 2 + 4}
            fill="rgba(255,255,255,0.5)"
            fontSize="0.4rem"
            fontFamily="monospace"
          >
            {f.count}
          </text>
        )
      })}
    </svg>
  )
}

export default function StateTransitionsPage() {
  const [data, setData] = useState<StateTransitionsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    fetch('/api/state-transitions')
      .then((r) => r.json())
      .then((d: StateTransitionsResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="State Transition Flow">
        <span className="text-[0.6rem] font-mono text-slate-500">
          idle → active → stuck → circuit-open flow across all projects · last 30d
        </span>
      </SubPageHeader>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}

      {!loading && data && (
        <div className="max-w-4xl mx-auto">
          {data.stateTotals.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              No state transition data found — no transcripts or circuit events in last 30d
            </div>
          ) : (
            <>
              {/* Sankey */}
              <div
                className="rounded-lg border border-white/5 p-6 mb-6"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-4">
                  State flow — node width = time spent, flow width = transition count
                </div>
                <SankeyDiagram transitions={data.transitions} stateTotals={data.stateTotals} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* State totals */}
                <div
                  className="rounded-lg border border-white/5 p-4"
                  style={{ background: 'rgba(255,255,255,0.02)' }}
                >
                  <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-3">
                    Time per state
                  </div>
                  {data.stateTotals.map((s: StateTotal) => (
                    <div key={s.state} className="flex items-center gap-3 mb-2">
                      <div className="w-2 h-2 rounded-sm shrink-0" style={{ background: STATE_COLOR[s.state] }} />
                      <span className="text-[0.6rem] font-mono w-24" style={{ color: STATE_COLOR[s.state] }}>{s.state}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${s.pct}%`, background: STATE_COLOR[s.state] }}
                        />
                      </div>
                      <span className="text-[0.6rem] font-mono text-slate-400 w-8 text-right">{s.pct}%</span>
                      <span className="text-[0.55rem] font-mono text-slate-600">({fmtDuration(s.totalMs)})</span>
                    </div>
                  ))}
                </div>

                {/* Top transitions */}
                <div
                  className="rounded-lg border border-white/5 p-4"
                  style={{ background: 'rgba(255,255,255,0.02)' }}
                >
                  <div className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider mb-3">
                    Transitions (count / avg time in source)
                  </div>
                  {data.transitions.slice(0, 10).map((t: Transition, i) => (
                    <div key={i} className="flex items-center gap-2 mb-1.5">
                      <span className="text-[0.55rem] font-mono w-4 text-slate-600">{i + 1}.</span>
                      <span className="text-[0.6rem] font-mono" style={{ color: STATE_COLOR[t.from] }}>{t.from}</span>
                      <span className="text-[0.5rem] text-slate-600">→</span>
                      <span className="text-[0.6rem] font-mono" style={{ color: STATE_COLOR[t.to] }}>{t.to}</span>
                      <span className="text-[0.55rem] font-mono text-slate-300 ml-auto">{t.count}×</span>
                      <span className="text-[0.5rem] font-mono text-slate-600">{fmtDuration(t.avgDurationMs)}</span>
                    </div>
                  ))}
                  {data.transitions.length === 0 && (
                    <div className="text-[0.6rem] font-mono text-slate-600">No transitions recorded</div>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="text-[0.55rem] font-mono text-slate-700 text-right mt-4">
            Generated {new Date(data.generatedAt).toLocaleString()} · 30d window
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { MomentumIndexResponse, MomentumIndexRow } from '../api/metrics/momentum-index/route'

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(Math.round(n))
}

function scoreColor(score: number): string {
  if (score >= 66) return '#4ADE80'
  if (score >= 33) return '#F59E0B'
  return '#EF4444'
}

// Radial gauge: 270° arc, value swept from the score.
function Gauge({ score }: { score: number }) {
  const R = 28
  const C = 36
  const stroke = 6
  const startAngle = 135 // degrees, sweeps clockwise 270°
  const sweep = 270
  const circ = 2 * Math.PI * R
  const arcFrac = sweep / 360
  const dash = circ * arcFrac
  const filled = dash * (Math.max(0, Math.min(100, score)) / 100)
  const color = scoreColor(score)

  return (
    <svg width={C * 2} height={C * 2} className="shrink-0">
      <g transform={`rotate(${startAngle} ${C} ${C})`}>
        <circle
          cx={C} cy={C} r={R} fill="none" stroke="#1e293b" strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        />
        <circle
          cx={C} cy={C} r={R} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.4s ease' }}
        />
      </g>
      <text x={C} y={C - 1} textAnchor="middle" fontSize={16} fontWeight={800} fill={color} fontFamily="Orbitron, monospace">{score}</text>
      <text x={C} y={C + 13} textAnchor="middle" fontSize={6} fill="#64748b" fontFamily="JetBrains Mono, monospace" letterSpacing={1}>SCORE</text>
    </svg>
  )
}

export default function MomentumIndexPage() {
  const [data, setData] = useState<MomentumIndexResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    function load() {
      fetch('/api/metrics/momentum-index')
        .then((r) => r.json() as Promise<MomentumIndexResponse>)
        .then((d) => { setData(d); setLoading(false) })
        .catch(() => setLoading(false))
    }
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Computing momentum index…</div>
      </div>
    )
  }

  const rows = data?.rows ?? []
  // Top mover = highest score; biggest decliner = lowest score among those with any score.
  const scored = rows.filter((r) => r.score > 0)
  const topSlug = scored.length ? scored[0].slug : null
  const declinerSlug = scored.length > 1 ? scored[scored.length - 1].slug : null

  function badge(r: MomentumIndexRow): { text: string; color: string } | null {
    if (r.slug === topSlug) return { text: '▲ TOP MOVER', color: '#4ADE80' }
    if (r.slug === declinerSlug) return { text: '▼ DECLINER', color: '#EF4444' }
    return null
  }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Project Momentum Index
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-500 border border-slate-700 px-2 py-0.5 rounded">burn · goals · proposals</span>
          <div className="flex-1" />
          <Link href="/momentum" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded">Momentum River →</Link>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        {rows.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-600 text-xs font-mono">No projects to rank.</div>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => {
              const b = badge(r)
              return (
                <div
                  key={r.slug}
                  className="flex items-center gap-4 rounded-lg border px-4 py-3"
                  style={{
                    borderColor: b ? `${b.color}40` : 'rgba(0,245,255,0.1)',
                    background: b ? `${b.color}08` : 'rgba(0,245,255,0.02)',
                  }}
                >
                  <span className="text-[0.7rem] font-mono text-slate-600 w-6 text-right">#{i + 1}</span>
                  <Gauge score={r.score} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/?spotlight=${r.slug}`} className="text-sm font-mono text-slate-200 hover:text-cyber-cyan transition-colors truncate">{r.slug}</Link>
                      {b && (
                        <span className="text-[0.5rem] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                          style={{ color: b.color, border: `1px solid ${b.color}40`, background: `${b.color}12` }}>
                          {b.text}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-4 text-[0.6rem] font-mono text-slate-500">
                      <span title="Tokens burned in the last 7 days">⥮ {fmtTokens(r.burn7d)} <span className="text-slate-700">7d burn</span></span>
                      <span title="Proposals proposed-and-completed this week">⟿ {r.proposalsDone} <span className="text-slate-700">proposals</span></span>
                      <span title="Goal freshness (days touched within the last week)">◎ {r.goalDelta} <span className="text-slate-700">goal Δ</span></span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <p className="text-[0.5rem] font-mono text-slate-700 mt-4">
          Composite score = 0.5·(7-day burn) + 0.3·(proposals done this week) + 0.2·(goal freshness), each fleet-normalized to 0–100.
          Top mover (green) ranks highest; biggest decliner (red) ranks lowest. Refreshes every 60s.
        </p>
      </main>
    </div>
  )
}

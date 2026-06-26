'use client'

import { useEffect, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { MemoryVelocityResponse, DailyCount } from '../api/memory-velocity/route'

const TREND_COLOR: Record<string, string> = {
  up: '#22C55E',
  down: '#EF4444',
  stable: '#22D3EE',
}

function Sparkline({
  data,
  color,
  width = 300,
  height = 28,
}: {
  data: DailyCount[]
  color: string
  width?: number
  height?: number
}) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const n = data.length
  if (n < 2) return null

  const pts = data.map((d, i) => {
    const x = (i / (n - 1)) * width
    const y = height - (d.count / max) * (height - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const last = data[n - 1]
  const lastX = width
  const lastY = height - (last.count / max) * (height - 4) - 2

  return (
    <svg width={width} height={height} className="block overflow-visible">
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
      {last.count > 0 && (
        <circle cx={lastX} cy={lastY} r={2} fill={color} opacity={0.9} />
      )}
    </svg>
  )
}

function FleetSparkline({ data }: { data: DailyCount[] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const n = data.length
  if (n < 2) return null

  const W = 600
  const H = 48
  const pts = data.map((d, i) => {
    const x = (i / (n - 1)) * W
    const y = H - (d.count / max) * (H - 6) - 3
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const area = `${pts.join(' ')} ${W},${H} 0,${H}`

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block">
      <polygon points={area} fill="rgba(34,211,238,0.08)" />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="rgba(255,255,255,0.7)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function MemoryVelocityPage() {
  const [data, setData] = useState<MemoryVelocityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/memory-velocity')
      .then((r) => r.json())
      .then((d: MemoryVelocityResponse) => {
        setData(d)
        setLoading(false)
      })
      .catch((e) => {
        setError(String(e))
        setLoading(false)
      })
  }, [])

  const projects = data?.projects ?? []
  const fleet = data?.fleet ?? []

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Memory Write Velocity Sparklines">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Memory commit frequency per project · last 14 days
        </span>
      </SubPageHeader>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}
      {error && (
        <div className="text-center py-20 text-red-500 font-mono text-sm">{error}</div>
      )}

      {!loading && !error && (
        <div className="max-w-5xl mx-auto">
          {data?.topSlug && (
            <div className="mb-4 text-[0.6rem] font-mono text-slate-500">
              Highest 3-day velocity:{' '}
              <span className="text-green-400 font-bold">{data.topSlug}</span>
            </div>
          )}

          {fleet.length > 0 && (
            <div
              className="rounded-lg border border-white/5 p-4 mb-5"
              style={{ background: 'rgba(255,255,255,0.02)' }}
            >
              <div className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-2">
                Fleet Aggregate
              </div>
              <FleetSparkline data={fleet} />
              <div className="flex justify-between mt-1 text-[0.42rem] font-mono text-slate-700">
                <span>{fleet[0]?.date}</span>
                <span>{fleet[fleet.length - 1]?.date}</span>
              </div>
            </div>
          )}

          {projects.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              No memory git history found
            </div>
          ) : (
            <div
              className="rounded-lg border border-white/5 p-4"
              style={{ background: 'rgba(255,255,255,0.02)' }}
            >
              <div className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-3">
                Projects sorted by 3-day velocity · max 20 shown
              </div>

              <div className="flex items-center gap-4 mb-3 text-[0.45rem] font-mono">
                {(['up', 'down', 'stable'] as const).map((t) => (
                  <span key={t} className="flex items-center gap-1">
                    <span
                      className="inline-block w-4 h-0.5"
                      style={{ background: TREND_COLOR[t] }}
                    />
                    <span className="text-slate-600 capitalize">
                      {t === 'up' ? 'Accelerating' : t === 'down' ? 'Declining' : 'Stable'}
                    </span>
                  </span>
                ))}
              </div>

              <div className="divide-y divide-white/5">
                {projects.map((p) => {
                  const recent = p.dailyCounts.slice(-3).reduce((s, d) => s + d.count, 0)
                  const color = p.total === 0 ? '#1E293B' : TREND_COLOR[p.trend]
                  return (
                    <div key={p.slug} className="flex items-center gap-3 py-1.5">
                      <span
                        className="text-[0.48rem] font-mono w-28 shrink-0 text-right truncate"
                        style={{ color: p.total === 0 ? '#334155' : '#64748B' }}
                      >
                        {p.slug}
                      </span>
                      <div className="flex-1 min-w-0">
                        <Sparkline data={p.dailyCounts} color={color} width={300} height={28} />
                      </div>
                      <span className="text-[0.45rem] font-mono text-slate-600 w-14 shrink-0 text-right">
                        +{recent} (3d)
                      </span>
                      <span className="text-[0.45rem] font-mono text-slate-700 w-12 shrink-0 text-right">
                        {p.total} total
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {data && (
            <div className="text-[0.5rem] font-mono text-slate-700 text-right mt-3">
              Generated {new Date(data.generatedAt).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

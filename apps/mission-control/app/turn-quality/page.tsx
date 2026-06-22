'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { TurnQualityResponse } from '../api/turn-quality/route'

function scoreColor(score: number): string {
  if (score === 0) return '#1E293B'
  if (score >= 70) return '#10B981'
  if (score >= 40) return '#F59E0B'
  return '#EF4444'
}

function scoreOpacity(score: number): number {
  if (score === 0) return 0.15
  return 0.3 + (score / 100) * 0.7
}

interface TooltipState {
  x: number
  y: number
  slug: string
  hour: string
  score: number
  turnCount: number
}

export default function TurnQualityPage() {
  const [data, setData] = useState<TurnQualityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const r = await fetch('/api/turn-quality')
        if (r.ok) setData(await r.json() as TurnQualityResponse)
      } catch { /* ignore */ } finally {
        setLoading(false)
      }
    }
    load()
    const id = setInterval(load, 5 * 60_000)
    return () => clearInterval(id)
  }, [])

  const cellMap = new Map<string, { score: number; turnCount: number }>()
  if (data) {
    for (const row of data.rows) {
      cellMap.set(`${row.slug}:${row.hour}`, { score: row.score, turnCount: row.turnCount })
    }
  }

  function formatHour(h: string): string {
    // h = "2026-06-22T14"
    const parts = h.split('T')
    if (parts.length < 2) return h
    return `${parts[0].slice(5)}T${parts[1]}:00`
  }

  function narrativeLink(slug: string, hour: string): string {
    const since = `${hour}:00:00`
    const until = `${hour}:59:59`
    return `/narrative?slug=${encodeURIComponent(slug)}&since=${since}&until=${until}`
  }

  return (
    <div className="min-h-screen bg-[#030712] text-slate-300 font-mono p-4">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-slate-600 hover:text-cyber-cyan text-sm">←</Link>
        <h1 className="text-lg font-bold tracking-widest text-cyber-cyan uppercase">Turn Quality Heatmap</h1>
        {data && (
          <span className="ml-auto text-[0.6rem] text-slate-600">
            24h window · refreshes 5 min
          </span>
        )}
      </div>

      {/* Legend */}
      <div className="flex gap-4 mb-5 text-[0.55rem] text-slate-600 flex-wrap">
        <span><span className="inline-block w-3 h-3 rounded-sm mr-1" style={{ background: '#10B981' }} />High (≥70)</span>
        <span><span className="inline-block w-3 h-3 rounded-sm mr-1" style={{ background: '#F59E0B' }} />Mid (40–69)</span>
        <span><span className="inline-block w-3 h-3 rounded-sm mr-1" style={{ background: '#EF4444' }} />Low (&lt;40)</span>
        <span><span className="inline-block w-3 h-3 rounded-sm mr-1" style={{ background: '#1E293B' }} />No data</span>
        <span className="ml-auto">Click cell → Narrative filtered to that hour</span>
      </div>

      {loading && (
        <div className="text-slate-600 text-sm animate-pulse">Computing turn quality…</div>
      )}

      {data && data.slugs.length === 0 && (
        <div className="text-slate-600 text-sm">No turn data in last 24h.</div>
      )}

      {data && data.slugs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="text-[0.55rem] border-collapse">
            <thead>
              <tr>
                <th className="text-left text-slate-600 pr-3 pb-2 font-normal w-28">Project</th>
                {data.hours.map((h) => (
                  <th key={h} className="text-slate-600 pb-2 font-normal px-0.5 text-center" style={{ minWidth: 28 }}>
                    {h.slice(11)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slugs.map((slug) => (
                <tr key={slug}>
                  <td className="text-slate-400 pr-3 py-0.5 truncate max-w-[7rem]" title={slug}>{slug}</td>
                  {data.hours.map((hour) => {
                    const cell = cellMap.get(`${slug}:${hour}`)
                    const score = cell?.score ?? 0
                    const turnCount = cell?.turnCount ?? 0
                    const color = scoreColor(score)
                    const opacity = scoreOpacity(score)
                    return (
                      <td key={hour} className="py-0.5 px-0.5">
                        <Link
                          href={narrativeLink(slug, hour)}
                          className="block w-6 h-6 rounded-sm cursor-pointer transition-transform hover:scale-110"
                          style={{ background: color, opacity }}
                          onMouseEnter={(e) => {
                            const rect = (e.target as HTMLElement).getBoundingClientRect()
                            setTooltip({ x: rect.left, y: rect.top, slug, hour, score, turnCount })
                          }}
                          onMouseLeave={() => setTooltip(null)}
                          title={`${slug} ${hour}: score=${score} turns=${turnCount}`}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border border-white/10 px-3 py-2 text-[0.6rem]"
          style={{
            left: tooltip.x + 32,
            top: tooltip.y - 8,
            background: '#0d1b2e',
            transform: 'translateY(-50%)',
          }}
        >
          <div className="font-bold text-slate-200 mb-1">{tooltip.slug}</div>
          <div className="text-slate-500">{formatHour(tooltip.hour)}</div>
          <div className="mt-1">
            <span className="font-bold" style={{ color: scoreColor(tooltip.score) }}>
              Score: {tooltip.score}
            </span>
            <span className="text-slate-600 ml-2">({tooltip.turnCount} turns)</span>
          </div>
          <div className="text-slate-700 mt-1">Click to open Narrative →</div>
        </div>
      )}
    </div>
  )
}

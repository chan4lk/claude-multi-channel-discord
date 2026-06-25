'use client'

import { useState, useMemo } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import { useFreshness } from '../../lib/useFreshness'
import FreshnessBadge from '../../components/FreshnessBadge'
import type { BudgetCalendarResponse, CalendarDay } from '../api/budget-calendar/route'

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

function cellColor(frac: number): string {
  // white → light blue → mid blue → deep blue
  if (frac <= 0) return '#0a1428'
  if (frac < 0.2) return '#1e3a5f'
  if (frac < 0.4) return '#1d4ed8'
  if (frac < 0.6) return '#2563eb'
  if (frac < 0.8) return '#3b82f6'
  return '#60a5fa'
}

// Assign deterministic colors to slugs
const PALETTE = [
  '#22D3EE', '#34D399', '#A78BFA', '#FB923C', '#F472B6',
  '#FBBF24', '#818CF8', '#6EE7B7', '#FCA5A5', '#67E8F9',
]

function slugColor(slug: string, slugs: string[]): string {
  const idx = slugs.indexOf(slug)
  return PALETTE[idx % PALETTE.length] ?? '#64748B'
}

interface TooltipState {
  x: number
  y: number
  day: CalendarDay
  top3: Array<{ slug: string; tokens: number }>
}

export default function BudgetCalendarPage() {
  const [months, setMonths] = useState(3)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const url = `/api/budget-calendar?months=${months}`
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<BudgetCalendarResponse>(url, 120_000)

  const { weeks, maxDayTokens } = useMemo(() => {
    if (!data?.days?.length) return { weeks: [], maxDayTokens: 1 }
    const dayMap = new Map(data.days.map(d => [d.date, d]))
    const max = Math.max(...data.days.map(d => d.totalTokens), 1)

    // Build calendar grid: Sun=0..Sat=6
    const endDate = new Date()
    endDate.setHours(23, 59, 59, 999)
    const startDate = new Date(endDate)
    startDate.setDate(startDate.getDate() - months * 30)
    // Align to previous Sunday
    startDate.setDate(startDate.getDate() - startDate.getDay())

    const weeksList: Array<Array<{ date: string; day: CalendarDay | null }>> = []
    let current = new Date(startDate)
    while (current <= endDate) {
      const week: Array<{ date: string; day: CalendarDay | null }> = []
      for (let d = 0; d < 7; d++) {
        const dateStr = current.toISOString().slice(0, 10)
        week.push({ date: dateStr, day: dayMap.get(dateStr) ?? null })
        current.setDate(current.getDate() + 1)
      }
      weeksList.push(week)
    }

    return { weeks: weeksList, maxDayTokens: max }
  }, [data, months])

  const slugs = data?.slugs ?? []
  const totalTokens = data?.days?.reduce((s, d) => s + d.totalTokens, 0) ?? 0

  // Stacked bar data: group days by week for bar chart
  const barData = useMemo(() => {
    if (!data?.days?.length) return []
    // Group into ~weekly buckets
    const buckets: Array<{ label: string; bySlug: Record<string, number>; total: number }> = []
    const week = 7 * 24 * 3_600_000
    const now = Date.now()
    const numWeeks = Math.ceil(months * 30 / 7)
    for (let i = numWeeks - 1; i >= 0; i--) {
      const endMs = now - i * week
      const startMs = endMs - week
      const start = new Date(startMs).toISOString().slice(0, 10)
      const end = new Date(endMs).toISOString().slice(0, 10)
      const bucket: Record<string, number> = {}
      let total = 0
      for (const d of data.days) {
        if (d.date >= start && d.date < end) {
          for (const [slug, tokens] of Object.entries(d.byProject)) {
            bucket[slug] = (bucket[slug] ?? 0) + tokens
            total += tokens
          }
        }
      }
      buckets.push({ label: new Date(startMs).toISOString().slice(5, 10), bySlug: bucket, total })
    }
    return buckets
  }, [data, months])

  const maxBarTotal = Math.max(1, ...barData.map(b => b.total))
  const CELL = 14
  const GAP = 2

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Budget Burn Calendar">
        <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
      </SubPageHeader>

      {/* Controls */}
      <div className="max-w-5xl mx-auto mb-5 flex gap-4 items-center flex-wrap">
        {[1, 3, 6].map(m => (
          <button
            key={m}
            onClick={() => setMonths(m)}
            className="text-[0.6rem] font-mono px-3 py-1 rounded border transition-colors"
            style={{
              background: months === m ? '#1d4ed8' : '#0d1b2e',
              borderColor: months === m ? '#3b82f6' : 'rgba(255,255,255,0.1)',
              color: months === m ? '#E2E8F0' : '#94A3B8',
            }}
          >
            {m}mo
          </button>
        ))}
        <span className="text-[0.6rem] font-mono text-slate-500 ml-auto">
          {fmtTokens(totalTokens)} total · {data?.days?.length ?? 0} active days
        </span>
      </div>

      {!data && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}

      {data && data.days.length === 0 && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">No token usage data found</div>
      )}

      {data && data.days.length > 0 && (
        <div className="max-w-5xl mx-auto">
          {/* GitHub-style heatmap calendar */}
          <div
            className="overflow-x-auto mb-6 p-4 rounded border border-white/06"
            style={{ background: '#060d19' }}
          >
            <div className="flex gap-[2px]" onMouseLeave={() => setTooltip(null)}>
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[2px]">
                  {week.map(({ date, day }) => {
                    const frac = day ? day.totalTokens / maxDayTokens : 0
                    const color = cellColor(frac)
                    const top3 = day
                      ? Object.entries(day.byProject)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 3)
                          .map(([slug, tokens]) => ({ slug, tokens }))
                      : []
                    return (
                      <div
                        key={date}
                        style={{
                          width: CELL,
                          height: CELL,
                          background: color,
                          borderRadius: 2,
                          cursor: day ? 'pointer' : 'default',
                        }}
                        onMouseEnter={ev => {
                          if (!day) return
                          setTooltip({ x: ev.clientX, y: ev.clientY, day, top3 })
                        }}
                      />
                    )
                  })}
                </div>
              ))}
            </div>

            {/* Color legend */}
            <div className="flex items-center gap-1 mt-3">
              <span className="text-[0.5rem] font-mono text-slate-600 mr-1">Less</span>
              {[0, 0.2, 0.4, 0.6, 0.8, 1].map(f => (
                <div key={f} style={{ width: 10, height: 10, background: cellColor(f), borderRadius: 1 }} />
              ))}
              <span className="text-[0.5rem] font-mono text-slate-600 ml-1">More</span>
              <span className="text-[0.5rem] font-mono text-slate-700 ml-4">
                max {fmtTokens(maxDayTokens)} in a day
              </span>
            </div>
          </div>

          {/* Stacked bar chart */}
          <div
            className="p-4 rounded border border-white/06 mb-4"
            style={{ background: '#060d19' }}
          >
            <div className="text-[0.55rem] font-mono text-slate-500 mb-3">Weekly token spend by project</div>
            <div className="flex items-end gap-1" style={{ height: 120 }}>
              {barData.map((bucket, bi) => {
                const barH = bucket.total > 0 ? Math.max(2, (bucket.total / maxBarTotal) * 110) : 0
                let offset = 0
                const segments = Object.entries(bucket.bySlug)
                  .sort((a, b) => b[1] - a[1])
                  .map(([slug, tokens]) => {
                    const segH = (tokens / bucket.total) * barH
                    const y = barH - offset - segH
                    offset += segH
                    return { slug, tokens, segH, y }
                  })
                return (
                  <div key={bi} className="flex flex-col items-center" style={{ flex: 1, minWidth: 0 }}>
                    <div className="relative w-full" style={{ height: 112 }}>
                      <svg width="100%" height={112} style={{ position: 'absolute', bottom: 0 }}>
                        {segments.map(seg => (
                          <rect
                            key={seg.slug}
                            x="5%"
                            y={112 - barH + seg.y}
                            width="90%"
                            height={Math.max(1, seg.segH)}
                            fill={slugColor(seg.slug, slugs)}
                            opacity={0.85}
                          />
                        ))}
                      </svg>
                    </div>
                    {bi % 2 === 0 && (
                      <span className="text-[0.4rem] font-mono text-slate-700 mt-1">{bucket.label}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Slug color legend */}
          <div className="flex flex-wrap gap-3">
            {slugs.map(slug => (
              <div key={slug} className="flex items-center gap-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: slugColor(slug, slugs) }}
                />
                <span className="text-[0.5rem] font-mono text-slate-500">{slug}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Floating tooltip */}
      {tooltip && (
        <div
          className="fixed pointer-events-none rounded border border-white/10 px-3 py-2 text-[0.6rem] font-mono"
          style={{
            background: '#0d1b2e',
            left: Math.min(tooltip.x + 14, window.innerWidth - 220),
            top: Math.max(0, tooltip.y - 80),
            zIndex: 50,
            maxWidth: 220,
          }}
        >
          <div className="text-slate-300 font-bold mb-1">{tooltip.day.date}</div>
          <div className="text-cyan-300">{fmtTokens(tooltip.day.totalTokens)} total</div>
          {tooltip.top3.map(({ slug, tokens }) => (
            <div key={slug} className="flex justify-between gap-3 mt-0.5">
              <span style={{ color: slugColor(slug, slugs) }}>{slug}</span>
              <span className="text-slate-400">{fmtTokens(tokens)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

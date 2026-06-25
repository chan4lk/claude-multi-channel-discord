'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { SessionHealthCalendarResponse, SessionHealthCalendarCell } from '../api/session-health-calendar/route'

const GREEN  = '#10B981'
const YELLOW = '#F59E0B'
const RED    = '#EF4444'
const GRAY   = '#1E293B'

const CELL_SIZE = 14
const CELL_GAP  = 2
const LABEL_W   = 128 // px — left-fixed label column

function scoreColor(score: number, turnCount: number): string {
  if (turnCount === 0) return GRAY
  if (score >= 80) return GREEN
  if (score >= 50) return YELLOW
  return RED
}

function scoreOpacity(score: number, turnCount: number): number {
  if (turnCount === 0) return 0.25
  return 0.3 + 0.7 * (score / 100)
}

function monthLabel(date: string): string {
  // date = "YYYY-MM-DD"
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
}

interface TooltipState {
  x: number
  y: number
  slug: string | null // null = fleet row
  date: string
  avgScore: number
  turnCount: number
}

type WindowDays = 30 | 60 | 90

function SessionHealthCalendarInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [windowDays, setWindowDays] = useState<WindowDays>(() => {
    const raw = searchParams.get('window')
    if (raw === '60') return 60
    if (raw === '90') return 90
    return 30
  })
  const [data, setData] = useState<SessionHealthCalendarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const r = await fetch(`/api/session-health-calendar?window=${windowDays}`)
        if (r.ok && !cancelled) setData(await r.json() as SessionHealthCalendarResponse)
      } catch { /* ignore */ } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const id = setInterval(load, 5 * 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [windowDays])

  // Build fast cell lookup
  const cellMap = new Map<string, SessionHealthCalendarCell>()
  const fleetByDate = new Map<string, { scoreSum: number; slugCount: number }>()
  if (data) {
    for (const cell of data.cells) {
      cellMap.set(`${cell.slug}:${cell.date}`, cell)
      const existing = fleetByDate.get(cell.date)
      if (existing) {
        existing.scoreSum += cell.avgScore
        existing.slugCount += 1
      } else {
        fleetByDate.set(cell.date, { scoreSum: cell.avgScore, slugCount: 1 })
      }
    }
  }

  function getFleetCell(date: string): { avgScore: number; turnCount: number } {
    const agg = fleetByDate.get(date)
    if (!agg || agg.slugCount === 0) return { avgScore: 0, turnCount: 0 }
    return { avgScore: Math.round(agg.scoreSum / agg.slugCount), turnCount: agg.slugCount }
  }

  function handleWindowChange(w: WindowDays) {
    setWindowDays(w)
    const params = new URLSearchParams(searchParams.toString())
    params.set('window', String(w))
    router.replace(`?${params.toString()}`)
  }

  function handleCellClick(slug: string | null, date: string) {
    if (slug) {
      router.push(`/turn-quality?slug=${encodeURIComponent(slug)}&date=${encodeURIComponent(date)}`)
    } else {
      router.push(`/turn-quality?date=${encodeURIComponent(date)}`)
    }
  }

  function showTooltip(e: React.MouseEvent, slug: string | null, date: string, avgScore: number, turnCount: number) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTooltip({ x: rect.right + 8, y: rect.top + rect.height / 2, slug, date, avgScore, turnCount })
  }

  const dates = data?.dates ?? []
  const slugs = data?.slugs ?? []

  // Month label positions: show when month changes
  const monthBreaks: Array<{ idx: number; label: string }> = []
  for (let i = 0; i < dates.length; i++) {
    const label = monthLabel(dates[i])
    if (i === 0 || label !== monthLabel(dates[i - 1])) {
      monthBreaks.push({ idx: i, label })
    }
  }

  const totalW = dates.length * (CELL_SIZE + CELL_GAP)
  const allRows = data ? [null, ...slugs] : [] // null = fleet row

  return (
    <div className="min-h-screen bg-[#030712] text-slate-300 font-mono p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <Link href="/" className="text-slate-600 hover:text-cyan-400 text-sm">←</Link>
        <h1 className="text-lg font-bold tracking-widest text-cyan-400 uppercase">Session Health Calendar</h1>
        <div className="ml-auto flex gap-1">
          {([30, 60, 90] as WindowDays[]).map((w) => (
            <button
              key={w}
              onClick={() => handleWindowChange(w)}
              className={`px-3 py-1 text-xs rounded border transition-colors ${
                windowDays === w
                  ? 'bg-cyan-900/60 border-cyan-600 text-cyan-300'
                  : 'bg-transparent border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mb-5 text-[0.55rem] text-slate-600 flex-wrap">
        <span>
          <span className="inline-block w-3 h-3 rounded-sm mr-1 align-middle" style={{ background: GREEN }} />
          High (≥80)
        </span>
        <span>
          <span className="inline-block w-3 h-3 rounded-sm mr-1 align-middle" style={{ background: YELLOW }} />
          Mid (50–79)
        </span>
        <span>
          <span className="inline-block w-3 h-3 rounded-sm mr-1 align-middle" style={{ background: RED }} />
          Low (&lt;50)
        </span>
        <span>
          <span className="inline-block w-3 h-3 rounded-sm mr-1 align-middle" style={{ background: GRAY }} />
          No data
        </span>
        <span className="text-slate-700">★ best · ▼ worst fleet day</span>
        <span className="ml-auto text-slate-700">Click cell → Turn Quality</span>
      </div>

      {loading && (
        <div className="text-slate-600 text-sm animate-pulse">Loading session health data…</div>
      )}

      {!loading && data && dates.length === 0 && (
        <div className="text-slate-600 text-sm">No turn quality data in last {windowDays} days.</div>
      )}

      {!loading && data && dates.length > 0 && (
        <div className="overflow-x-auto" ref={containerRef}>
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            {/* Left label column */}
            <div style={{ width: LABEL_W, flexShrink: 0 }}>
              {/* Month label spacer */}
              <div style={{ height: 20 }} />
              {/* Fleet Avg label */}
              <div
                style={{
                  height: CELL_SIZE + CELL_GAP,
                  lineHeight: `${CELL_SIZE}px`,
                  fontSize: '0.6rem',
                  color: '#94a3b8',
                  fontWeight: 700,
                  paddingRight: 8,
                  display: 'flex',
                  alignItems: 'center',
                  marginBottom: 4,
                }}
              >
                Fleet Avg
              </div>
              {/* Marker row spacer (★ ▼) */}
              <div style={{ height: 14, marginBottom: 6 }} />
              {/* Per-slug labels */}
              {slugs.map((slug) => (
                <div
                  key={slug}
                  style={{
                    height: CELL_SIZE + CELL_GAP,
                    lineHeight: `${CELL_SIZE}px`,
                    fontSize: '0.55rem',
                    color: '#64748b',
                    paddingRight: 8,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: CELL_GAP,
                  }}
                  title={slug}
                >
                  {slug}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div style={{ position: 'relative', width: totalW }}>
              {/* Month labels row */}
              <div style={{ position: 'relative', height: 20, marginBottom: 0 }}>
                {monthBreaks.map(({ idx, label }) => (
                  <span
                    key={`${idx}-${label}`}
                    style={{
                      position: 'absolute',
                      left: idx * (CELL_SIZE + CELL_GAP),
                      top: 0,
                      fontSize: '0.55rem',
                      color: '#475569',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>

              {/* Fleet row */}
              <div
                style={{
                  display: 'flex',
                  gap: CELL_GAP,
                  marginBottom: 4,
                  height: CELL_SIZE,
                  alignItems: 'center',
                }}
              >
                {dates.map((date) => {
                  const { avgScore, turnCount } = getFleetCell(date)
                  const color = scoreColor(avgScore, turnCount)
                  const opacity = scoreOpacity(avgScore, turnCount)
                  return (
                    <div
                      key={date}
                      onClick={() => handleCellClick(null, date)}
                      onMouseEnter={(e) => showTooltip(e, null, date, avgScore, turnCount)}
                      onMouseLeave={() => setTooltip(null)}
                      style={{
                        width: CELL_SIZE,
                        height: CELL_SIZE,
                        borderRadius: 2,
                        background: color,
                        opacity,
                        cursor: turnCount > 0 ? 'pointer' : 'default',
                        flexShrink: 0,
                        transition: 'transform 0.1s',
                      }}
                      title={`Fleet · ${date} · score=${avgScore} · ${turnCount} slug(s)`}
                    />
                  )
                })}
              </div>

              {/* Best/worst markers row */}
              <div
                style={{
                  position: 'relative',
                  height: 14,
                  marginBottom: 6,
                }}
              >
                {data.fleetBest && (() => {
                  const idx = dates.indexOf(data.fleetBest)
                  if (idx < 0) return null
                  return (
                    <span
                      style={{
                        position: 'absolute',
                        left: idx * (CELL_SIZE + CELL_GAP),
                        top: 0,
                        fontSize: '0.55rem',
                        color: GREEN,
                        lineHeight: 1,
                      }}
                      title={`Fleet best: ${data.fleetBest}`}
                    >
                      ★
                    </span>
                  )
                })()}
                {data.fleetWorst && data.fleetWorst !== data.fleetBest && (() => {
                  const idx = dates.indexOf(data.fleetWorst!)
                  if (idx < 0) return null
                  return (
                    <span
                      style={{
                        position: 'absolute',
                        left: idx * (CELL_SIZE + CELL_GAP),
                        top: 0,
                        fontSize: '0.55rem',
                        color: RED,
                        lineHeight: 1,
                      }}
                      title={`Fleet worst: ${data.fleetWorst}`}
                    >
                      ▼
                    </span>
                  )
                })()}
              </div>

              {/* Per-slug rows */}
              {slugs.map((slug) => (
                <div
                  key={slug}
                  style={{
                    display: 'flex',
                    gap: CELL_GAP,
                    marginBottom: CELL_GAP,
                    height: CELL_SIZE,
                    alignItems: 'center',
                  }}
                >
                  {dates.map((date) => {
                    const cell = cellMap.get(`${slug}:${date}`)
                    const avgScore = cell?.avgScore ?? 0
                    const turnCount = cell?.turnCount ?? 0
                    const color = scoreColor(avgScore, turnCount)
                    const opacity = scoreOpacity(avgScore, turnCount)
                    return (
                      <div
                        key={date}
                        onClick={() => handleCellClick(slug, date)}
                        onMouseEnter={(e) => showTooltip(e, slug, date, avgScore, turnCount)}
                        onMouseLeave={() => setTooltip(null)}
                        style={{
                          width: CELL_SIZE,
                          height: CELL_SIZE,
                          borderRadius: 2,
                          background: color,
                          opacity,
                          cursor: turnCount > 0 ? 'pointer' : 'default',
                          flexShrink: 0,
                          transition: 'transform 0.1s',
                        }}
                        title={`${slug} · ${date} · score=${avgScore} · ${turnCount} turns`}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border border-white/10 px-3 py-2 text-[0.6rem]"
          style={{
            left: Math.min(tooltip.x, window.innerWidth - 200),
            top: tooltip.y,
            background: '#0d1b2e',
            transform: 'translateY(-50%)',
            minWidth: 160,
          }}
        >
          <div className="font-bold text-slate-200 mb-0.5">
            {tooltip.slug ?? 'Fleet Avg'}
          </div>
          <div className="text-slate-500 mb-1">{tooltip.date}</div>
          {tooltip.turnCount > 0 ? (
            <>
              <div>
                <span className="font-bold" style={{ color: scoreColor(tooltip.avgScore, tooltip.turnCount) }}>
                  Score: {tooltip.avgScore}
                </span>
              </div>
              <div className="text-slate-600 mt-0.5">
                {tooltip.slug
                  ? `${tooltip.turnCount} turn${tooltip.turnCount !== 1 ? 's' : ''}`
                  : `${tooltip.turnCount} slug${tooltip.turnCount !== 1 ? 's' : ''} with data`
                }
              </div>
              <div className="text-slate-700 mt-1">Click → Turn Quality</div>
            </>
          ) : (
            <div className="text-slate-700">No data</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function SessionHealthCalendarPage() {
  return (
    <Suspense>
      <SessionHealthCalendarInner />
    </Suspense>
  )
}

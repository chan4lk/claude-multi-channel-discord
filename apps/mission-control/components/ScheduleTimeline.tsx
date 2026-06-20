'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import GlassCard from './ui/GlassCard'

interface McEventEntry {
  id: string
  ts: number
  type: string
  instance_id: string
  payload: Record<string, unknown>
}

interface Props {
  events: McEventEntry[]
}

interface ScheduleApiRow {
  id: string
  chatId: string
  slug: string
  at: string
  interval: string | null
  prompt: string
  enabled: boolean
  lastRunAt: string | null
  runCount: number
  maxRuns: number | null
}

// Parse "every Xm" / "every Xh" → interval in seconds, or null
function parseIntervalSeconds(interval: string | null): number | null {
  if (!interval) return null
  const m = interval.match(/every\s+(\d+)(m|h)/i)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return m[2].toLowerCase() === 'h' ? n * 3600 : n * 60
}

// Parse "HH:MM" → minutes since midnight, or null
function parseJobMinutes(at: string): number | null {
  const match = at.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10)
}

function nowMinutes(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

function formatTime(ts: string | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function formatCountdown(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function secsUntilNextHHMM(jobMinutes: number): number {
  const now = new Date()
  const nowSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  const jobSecs = jobMinutes * 60
  const diff = jobSecs - nowSecs
  return diff > 0 ? diff : diff + 86400
}

function secsUntilNextInterval(intervalSecs: number, lastRunAt: string | null): number {
  if (!lastRunAt) return intervalSecs
  const last = new Date(lastRunAt).getTime()
  const elapsed = Math.floor((Date.now() - last) / 1000)
  const remaining = intervalSecs - elapsed
  return remaining > 0 ? remaining : 0
}

// Width per minute in px for 24h timeline
const PX_PER_MIN = 2
const TIMELINE_W = 24 * 60 * PX_PER_MIN // 2880px
const SLUG_COL_W = 96 // px

interface TooltipInfo {
  row: ScheduleApiRow
  x: number
  y: number
}

export default function ScheduleTimeline({ events }: Props) {
  const [rows, setRows] = useState<ScheduleApiRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [nowMins, setNowMins] = useState(nowMinutes)
  const [countdowns, setCountdowns] = useState<Record<string, number>>({})
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function fetchSchedules() {
      try {
        const res = await fetch('/api/schedules')
        if (res.ok) setRows(await res.json())
      } catch {}
      finally { setLoading(false) }
    }
    fetchSchedules()
    const id = setInterval(fetchSchedules, 60_000)
    return () => clearInterval(id)
  }, [])

  // Update from live events
  useEffect(() => {
    const fired = events.filter((ev) => ev.type === 'scheduler_fired')
    if (fired.length === 0) return
    setRows((prev) =>
      prev.map((row) => {
        const match = fired.find((ev) => {
          const chatId = typeof ev.payload['chatId'] === 'string' ? ev.payload['chatId'] : String(ev.payload['chatId'] ?? '')
          return chatId === row.chatId
        })
        if (!match) return row
        return { ...row, lastRunAt: new Date(match.ts).toISOString(), runCount: row.runCount + 1 }
      })
    )
  }, [events])

  // Tick: update nowMins and countdowns
  useEffect(() => {
    function tick() {
      setNowMins(nowMinutes())
      setCountdowns(() => {
        const next: Record<string, number> = {}
        for (const row of rows) {
          if (!row.enabled) { next[row.id] = -1; continue }
          const intervalSecs = parseIntervalSeconds(row.interval)
          if (intervalSecs) {
            next[row.id] = secsUntilNextInterval(intervalSecs, row.lastRunAt)
          } else {
            const jobMins = parseJobMinutes(row.at)
            next[row.id] = jobMins != null ? secsUntilNextHHMM(jobMins) : -1
          }
        }
        return next
      })
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [rows])

  // Scroll to put "now" marker centered on mount
  useEffect(() => {
    if (!scrollRef.current) return
    const nowX = nowMins * PX_PER_MIN
    const containerW = scrollRef.current.clientWidth
    scrollRef.current.scrollLeft = Math.max(0, nowX - containerW / 2)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const handleCopy = useCallback((row: ScheduleApiRow) => {
    const cmd = `!project schedule add ${row.slug} ${row.interval ? row.interval : `--at ${row.at}`} "${row.prompt.slice(0, 120).replace(/"/g, '\\"')}..."`
    navigator.clipboard.writeText(cmd).then(() => {
      setCopiedId(row.id)
      setTimeout(() => setCopiedId(null), 1500)
    }).catch(() => {})
  }, [])

  if (loading) {
    return (
      <GlassCard className="p-4">
        <div className="text-slate-500 text-sm py-4 text-center">Loading timeline…</div>
      </GlassCard>
    )
  }

  if (rows.length === 0) {
    return (
      <GlassCard className="p-4">
        <div className="text-slate-500 text-sm py-4 text-center">No scheduled jobs.</div>
      </GlassCard>
    )
  }

  // Group rows by slug
  const bySlug = new Map<string, ScheduleApiRow[]>()
  for (const row of rows) {
    if (!bySlug.has(row.slug)) bySlug.set(row.slug, [])
    bySlug.get(row.slug)!.push(row)
  }
  const slugs = Array.from(bySlug.keys())

  const ROW_H = 40
  const HEADER_H = 28
  const totalH = slugs.length * ROW_H + HEADER_H

  // Hour tick positions
  const hourTicks = Array.from({ length: 25 }, (_, i) => i)

  // "Last ran" markers: jobs run within the last hour
  const lastHourCutoff = Date.now() - 60 * 60_000

  return (
    <GlassCard className="p-0 overflow-hidden relative">
      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-cyber-surface border border-cyber-cyan/20 rounded-lg p-3 shadow-xl text-xs max-w-xs pointer-events-none"
          style={{ left: Math.min(tooltip.x + 8, window.innerWidth - 300), top: tooltip.y + 8 }}
        >
          <div className="font-mono text-cyber-cyan font-bold mb-1">{tooltip.row.slug}</div>
          <div className="text-slate-400 mb-1">
            {tooltip.row.interval
              ? <span className="text-cyber-amber">{tooltip.row.interval}</span>
              : <span className="text-cyber-cyan">@{tooltip.row.at}</span>
            }
            {' '}
            <span className={tooltip.row.enabled ? 'text-green-400' : 'text-slate-600'}>
              {tooltip.row.enabled ? 'enabled' : 'paused'}
            </span>
          </div>
          <div className="text-slate-500 mb-2 line-clamp-3">{tooltip.row.prompt}</div>
          <div className="text-slate-600">
            runs: {tooltip.row.runCount}{tooltip.row.maxRuns != null ? `/${tooltip.row.maxRuns}` : ''}
            {tooltip.row.lastRunAt && <> · last: {formatTime(tooltip.row.lastRunAt)}</>}
          </div>
          <button
            className="mt-2 text-[10px] text-cyber-cyan/70 hover:text-cyber-cyan border border-cyber-cyan/20 rounded px-2 py-0.5 pointer-events-auto"
            onClick={() => handleCopy(tooltip.row)}
          >
            {copiedId === tooltip.row.id ? '✓ copied' : 'Copy inject cmd'}
          </button>
        </div>
      )}

      <div className="flex">
        {/* Slug labels — sticky left */}
        <div
          className="shrink-0 border-r border-cyber-cyan/10 bg-cyber-surface/90"
          style={{ width: SLUG_COL_W, zIndex: 10 }}
        >
          {/* Header spacer */}
          <div style={{ height: HEADER_H }} className="border-b border-cyber-cyan/10" />
          {slugs.map((slug) => (
            <div
              key={slug}
              className="flex items-center px-2 border-b border-cyber-cyan/5"
              style={{ height: ROW_H }}
            >
              <span
                className="text-[10px] font-mono text-cyber-cyan truncate"
                title={slug}
              >
                {slug}
              </span>
            </div>
          ))}
        </div>

        {/* Scrollable timeline */}
        <div
          ref={scrollRef}
          className="overflow-x-auto flex-1"
          onMouseLeave={() => setTooltip(null)}
        >
          <div
            className="relative select-none"
            style={{ width: TIMELINE_W, height: totalH }}
          >
            {/* Hour grid lines + labels */}
            {hourTicks.map((h) => {
              const x = h * 60 * PX_PER_MIN
              return (
                <g key={h}>
                  <div
                    className="absolute top-0 bottom-0 border-l border-cyber-cyan/8"
                    style={{ left: x, top: 0, bottom: 0, width: 1 }}
                  />
                  <div
                    className="absolute text-[9px] text-slate-600 font-mono"
                    style={{ left: x + 2, top: 6 }}
                  >
                    {String(h % 24).padStart(2, '0')}:00
                  </div>
                </g>
              )
            })}

            {/* Now marker */}
            <div
              className="absolute top-0 bottom-0 z-10"
              style={{ left: nowMins * PX_PER_MIN, width: 2, background: 'rgba(0,245,255,0.5)', boxShadow: '0 0 8px #00F5FF' }}
            />
            <div
              className="absolute z-10 text-[9px] text-cyber-cyan font-mono"
              style={{ left: nowMins * PX_PER_MIN + 3, top: 6 }}
            >
              NOW
            </div>

            {/* Job blocks per slug row */}
            {slugs.map((slug, rowIdx) => {
              const jobRows = bySlug.get(slug)!
              const y = HEADER_H + rowIdx * ROW_H

              return (
                <div key={slug}>
                  {/* Row separator */}
                  <div
                    className="absolute left-0 right-0 border-b border-cyber-cyan/5"
                    style={{ top: y + ROW_H - 1, width: TIMELINE_W }}
                  />

                  {jobRows.map((row) => {
                    const intervalSecs = parseIntervalSeconds(row.interval)
                    const isInterval = intervalSecs != null
                    const countdown = countdowns[row.id] ?? -1
                    const isEnabled = row.enabled
                    const lastRanRecently = row.lastRunAt && new Date(row.lastRunAt).getTime() > lastHourCutoff

                    if (isInterval) {
                      // Interval job: show multiple markers across the day
                      const periodMins = intervalSecs / 60
                      const markers: number[] = []
                      for (let m = 0; m < 24 * 60; m += periodMins) {
                        markers.push(Math.floor(m))
                      }

                      return (
                        <div key={row.id}>
                          {markers.map((m) => {
                            const x = m * PX_PER_MIN
                            const isPast = m < nowMins
                            return (
                              <div
                                key={m}
                                className={`absolute cursor-pointer rounded-sm transition-opacity ${isEnabled ? '' : 'opacity-30'}`}
                                style={{
                                  left: x - 2,
                                  top: y + 8,
                                  width: 4,
                                  height: ROW_H - 16,
                                  background: isEnabled
                                    ? isPast ? 'rgba(168,85,247,0.3)' : 'rgba(168,85,247,0.7)'
                                    : 'rgba(100,100,100,0.3)',
                                  boxShadow: isEnabled && !isPast ? '0 0 4px rgba(168,85,247,0.6)' : undefined,
                                }}
                                onMouseEnter={(e) => setTooltip({ row, x: e.clientX, y: e.clientY })}
                              />
                            )
                          })}
                          {/* Countdown pill near "now" for enabled interval jobs */}
                          {isEnabled && countdown >= 0 && (
                            <div
                              className="absolute z-20 text-[9px] font-mono text-purple-300 bg-purple-900/60 rounded px-1 py-0.5 whitespace-nowrap"
                              style={{ left: nowMins * PX_PER_MIN + 4, top: y + ROW_H / 2 - 8 }}
                            >
                              {formatCountdown(countdown)}
                            </div>
                          )}
                          {/* Last-ran marker */}
                          {lastRanRecently && row.lastRunAt && (
                            <div
                              className="absolute z-10 text-[9px] font-mono text-slate-500 whitespace-nowrap"
                              style={{
                                left: new Date(row.lastRunAt).getHours() * 60 * PX_PER_MIN +
                                      new Date(row.lastRunAt).getMinutes() * PX_PER_MIN + 4,
                                top: y + 4,
                              }}
                            >
                              ✓{Math.floor((Date.now() - new Date(row.lastRunAt).getTime()) / 60_000)}m
                            </div>
                          )}
                        </div>
                      )
                    } else {
                      // HH:MM daily job
                      const jobMins = parseJobMinutes(row.at)
                      if (jobMins == null) return null
                      const x = jobMins * PX_PER_MIN
                      const isPast = jobMins < nowMins
                      const BLOCK_W = 48

                      return (
                        <div key={row.id}>
                          <div
                            className={`absolute cursor-pointer rounded transition-opacity flex items-center justify-center ${isEnabled ? '' : 'opacity-30 line-through'}`}
                            style={{
                              left: x - BLOCK_W / 2,
                              top: y + 6,
                              width: BLOCK_W,
                              height: ROW_H - 12,
                              background: isEnabled
                                ? isPast ? 'rgba(0,245,255,0.12)' : 'rgba(0,245,255,0.25)'
                                : 'rgba(100,100,100,0.15)',
                              border: `1px solid ${isEnabled ? (isPast ? 'rgba(0,245,255,0.25)' : 'rgba(0,245,255,0.6)') : 'rgba(100,100,100,0.3)'}`,
                              boxShadow: isEnabled && !isPast ? '0 0 6px rgba(0,245,255,0.3)' : undefined,
                            }}
                            onMouseEnter={(e) => setTooltip({ row, x: e.clientX, y: e.clientY })}
                          >
                            <span
                              className={`text-[9px] font-mono ${isEnabled ? (isPast ? 'text-slate-500' : 'text-cyber-cyan') : 'text-slate-600'}`}
                            >
                              {row.at}
                            </span>
                          </div>
                          {/* Countdown near block when upcoming */}
                          {isEnabled && !isPast && countdown >= 0 && (
                            <div
                              className="absolute z-20 text-[9px] font-mono text-cyber-cyan/60 whitespace-nowrap"
                              style={{ left: x + BLOCK_W / 2 + 2, top: y + ROW_H / 2 - 6 }}
                            >
                              {formatCountdown(countdown)}
                            </div>
                          )}
                          {/* Last-ran marker */}
                          {lastRanRecently && row.lastRunAt && (
                            <div
                              className="absolute z-10 text-[9px] font-mono text-slate-500 whitespace-nowrap"
                              style={{
                                left: x - BLOCK_W / 2 - 2,
                                top: y + 4,
                                transform: 'translateX(-100%)',
                              }}
                            >
                              ✓{Math.floor((Date.now() - new Date(row.lastRunAt).getTime()) / 60_000)}m
                            </div>
                          )}
                        </div>
                      )
                    }
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </GlassCard>
  )
}

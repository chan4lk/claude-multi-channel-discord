'use client'

import { useCallback, useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import SubPageHeader from '../../components/SubPageHeader'
import type { SessionReplayResponse, ReplayEvent, ReplayEventType } from '../api/session-replay/route'
import type { FleetResponse } from '../api/fleet/route'

// ─── Colors ──────────────────────────────────────────────────────────────────

const LANE_COLORS: Record<ReplayEventType, string> = {
  user:        '#F59E0B',
  tool_use:    '#F97316',
  tool_result: '#22D3EE',
  reply:       '#4ADE80',
  agent_span:  '#A78BFA',
}

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 5]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

// ─── Lane layout ─────────────────────────────────────────────────────────────

const LANE_ORDER: ReplayEventType[] = ['user', 'tool_use', 'tool_result', 'reply']
const LANE_LABELS: Record<ReplayEventType, string> = {
  user:        'User Input',
  tool_use:    'Tool Calls',
  tool_result: 'Tool Results',
  reply:       'Replies',
  agent_span:  'Agent Spans',
}
const LANE_H = 40
const LANE_GAP = 8
const HEADER_H = 60
const MIN_BLOCK_W = 4

// pixels per millisecond
function calcPxPerMs(totalMs: number, viewW: number): number {
  if (totalMs <= 0) return 0.001
  const available = Math.max(viewW - 80, 200)
  return available / totalMs
}

// ─── Main component ───────────────────────────────────────────────────────────

function SessionReplayInner() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [slugs, setSlugs] = useState<string[]>([])
  const [slug, setSlug] = useState(searchParams.get('slug') ?? '')
  const [sessionId, setSessionId] = useState(searchParams.get('sessionId') ?? '')
  const [data, setData] = useState<SessionReplayResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Playback state
  const [playheadMs, setPlayheadMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speedIdx, setSpeedIdx] = useState(2) // default 1×
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastTickRef = useRef<number>(0)

  // Detail panel
  const [detail, setDetail] = useState<ReplayEvent | null>(null)

  // Timeline canvas size
  const timelineRef = useRef<HTMLDivElement>(null)
  const [timelineW, setTimelineW] = useState(800)

  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        setTimelineW(e.contentRect.width)
      }
    })
    if (timelineRef.current) obs.observe(timelineRef.current)
    return () => obs.disconnect()
  }, [])

  // Fetch fleet slugs
  useEffect(() => {
    fetch('/api/fleet')
      .then((r) => r.json())
      .then((d: FleetResponse) => setSlugs(d.projects.map((p) => p.slug).sort()))
      .catch(() => {})
  }, [])

  const fetchReplay = useCallback(async (targetSlug: string, targetSession: string) => {
    if (!targetSlug) return
    setLoading(true)
    setError(null)
    setData(null)
    setPlayheadMs(0)
    setPlaying(false)
    try {
      const params = new URLSearchParams({ slug: targetSlug })
      if (targetSession) params.set('sessionId', targetSession)
      const res = await fetch(`/api/session-replay?${params}`)
      if (!res.ok) { setError(`HTTP ${res.status}`); return }
      const json = await res.json() as SessionReplayResponse
      setData(json)
      setPlayheadMs(0)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (slug) fetchReplay(slug, sessionId)
  }, [slug, sessionId, fetchReplay])

  // Update URL params on slug/session change
  useEffect(() => {
    const params = new URLSearchParams()
    if (slug) params.set('slug', slug)
    if (sessionId) params.set('sessionId', sessionId)
    router.replace(`/session-replay${params.toString() ? '?' + params.toString() : ''}`, { scroll: false })
  }, [slug, sessionId, router])

  // Playback loop
  useEffect(() => {
    if (playIntervalRef.current) clearInterval(playIntervalRef.current)
    if (!playing || !data) return

    lastTickRef.current = Date.now()
    playIntervalRef.current = setInterval(() => {
      const now = Date.now()
      const elapsed = now - lastTickRef.current
      lastTickRef.current = now
      const speed = SPEED_OPTIONS[speedIdx]
      setPlayheadMs((prev) => {
        const total = data.endTs - data.startTs
        const next = prev + elapsed * speed
        if (next >= total) {
          setPlaying(false)
          return total
        }
        return next
      })
    }, 33)

    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current)
    }
  }, [playing, speedIdx, data])

  const totalMs = data ? Math.max(1, data.endTs - data.startTs) : 1
  const pxPerMs = calcPxPerMs(totalMs, timelineW)

  // Events visible up to playhead
  const activeEvents = data
    ? data.events.filter((e) => (e.ts - data.startTs) <= playheadMs)
    : []

  function handleBlockClick(ev: ReplayEvent) {
    setDetail(ev)
  }

  function laneY(type: ReplayEventType): number {
    const idx = LANE_ORDER.indexOf(type)
    if (idx < 0) return 0
    return HEADER_H + idx * (LANE_H + LANE_GAP)
  }

  const canvasH = HEADER_H + LANE_ORDER.length * (LANE_H + LANE_GAP) + 16

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#020811', fontFamily: 'JetBrains Mono, monospace' }}>
      <SubPageHeader title="SESSION REPLAY" />

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-white/5" style={{ background: '#060d1a' }}>
        {/* Project selector */}
        <div className="flex items-center gap-2">
          <span className="text-[0.6rem] font-mono text-slate-500 uppercase">Project</span>
          <select
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSessionId('') }}
            className="text-xs font-mono bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-300 focus:outline-none focus:border-cyber-cyan/50"
          >
            <option value="">— select —</option>
            {slugs.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Session selector */}
        {data && data.sessions.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[0.6rem] font-mono text-slate-500 uppercase">Session</span>
            <select
              value={sessionId || data.sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="text-xs font-mono bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-300 focus:outline-none focus:border-cyber-cyan/50 max-w-[200px]"
            >
              {data.sessions.map((s) => (
                <option key={s.sessionId} value={s.sessionId}>
                  {new Date(s.startTs).toLocaleDateString()} {new Date(s.startTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {s.turns}t
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex-1" />

        {/* Speed controls */}
        <div className="flex items-center gap-1">
          {SPEED_OPTIONS.map((s, i) => (
            <button
              key={s}
              onClick={() => setSpeedIdx(i)}
              className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded border transition-colors"
              style={{
                borderColor: speedIdx === i ? '#22D3EE60' : '#1e3a5f',
                color: speedIdx === i ? '#22D3EE' : '#475569',
                background: speedIdx === i ? '#22D3EE10' : 'transparent',
              }}
            >
              {s}×
            </button>
          ))}
        </div>

        {/* Play/pause */}
        {data && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setPlayheadMs(0); setPlaying(false) }}
              className="text-[0.6rem] font-mono px-2 py-1 rounded border border-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
            >
              ⏮
            </button>
            <button
              onClick={() => setPlaying((p) => !p)}
              className="text-xs font-mono px-3 py-1 rounded border transition-colors"
              style={{
                borderColor: playing ? '#22D3EE60' : '#1e3a5f',
                color: playing ? '#22D3EE' : '#94A3B8',
                background: playing ? '#22D3EE10' : 'transparent',
              }}
            >
              {playing ? '⏸ Pause' : '▶ Play'}
            </button>
          </div>
        )}
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Timeline */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="p-8 text-slate-500 text-xs font-mono">Loading session…</div>
          )}
          {error && (
            <div className="p-8 text-red-400 text-xs font-mono">Error: {error}</div>
          )}
          {!slug && !loading && (
            <div className="p-8 text-slate-600 text-xs font-mono">Select a project to begin replay.</div>
          )}
          {data && data.events.length === 0 && (
            <div className="p-8 text-slate-600 text-xs font-mono">No events found in this session transcript.</div>
          )}

          {data && data.events.length > 0 && (
            <div ref={timelineRef} className="relative w-full" style={{ minWidth: 600 }}>
              {/* Lane labels */}
              <div className="absolute left-0 top-0 bottom-0 w-20 z-10" style={{ background: '#020811', borderRight: '1px solid #1e3a5f' }}>
                {LANE_ORDER.map((type) => (
                  <div
                    key={type}
                    className="absolute flex items-center justify-end pr-2"
                    style={{
                      top: laneY(type),
                      height: LANE_H,
                      width: '100%',
                      color: LANE_COLORS[type],
                      fontSize: '0.5rem',
                      fontFamily: 'JetBrains Mono, monospace',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {LANE_LABELS[type]}
                  </div>
                ))}
              </div>

              {/* SVG timeline */}
              <svg
                style={{ display: 'block', marginLeft: 80, overflow: 'visible' }}
                width={Math.max(timelineW - 80, 200)}
                height={canvasH}
              >
                {/* Time ruler ticks */}
                {Array.from({ length: 11 }, (_, i) => {
                  const ms = (totalMs / 10) * i
                  const x = ms * pxPerMs
                  return (
                    <g key={i}>
                      <line x1={x} y1={0} x2={x} y2={canvasH} stroke="#1e3a5f" strokeWidth={1} />
                      <text x={x + 2} y={12} fill="#334155" fontSize={8} fontFamily="monospace">
                        {fmtTime(ms)}
                      </text>
                    </g>
                  )
                })}

                {/* Lane backgrounds */}
                {LANE_ORDER.map((type) => (
                  <rect
                    key={type}
                    x={0}
                    y={laneY(type)}
                    width={Math.max(timelineW - 80, 200)}
                    height={LANE_H}
                    fill={`${LANE_COLORS[type]}08`}
                    rx={2}
                  />
                ))}

                {/* Event blocks */}
                {data.events.map((ev) => {
                  const type = ev.type as ReplayEventType
                  if (!LANE_ORDER.includes(type)) return null
                  const relStart = ev.ts - data.startTs
                  const x = relStart * pxPerMs
                  const dur = ev.durationMs ?? (ev.endTs ? ev.endTs - ev.ts : 0)
                  const w = Math.max(MIN_BLOCK_W, dur * pxPerMs)
                  const y = laneY(type)
                  const color = LANE_COLORS[type]
                  const isVisible = relStart <= playheadMs
                  const isActive = relStart <= playheadMs && (relStart + (dur || 100)) >= playheadMs
                  const isSelected = detail?.id === ev.id
                  const alpha = isVisible ? (isActive ? 'ff' : '88') : '20'

                  return (
                    <g key={ev.id} onClick={() => handleBlockClick(ev)} style={{ cursor: 'pointer' }}>
                      <rect
                        x={x}
                        y={y + 4}
                        width={w}
                        height={LANE_H - 8}
                        fill={`${color}${alpha}`}
                        stroke={isSelected ? color : `${color}44`}
                        strokeWidth={isSelected ? 2 : 1}
                        rx={3}
                      />
                      {w > 30 && (
                        <text
                          x={x + 4}
                          y={y + LANE_H / 2 + 3}
                          fill={isVisible ? color : `${color}44`}
                          fontSize={8}
                          fontFamily="monospace"
                          style={{ pointerEvents: 'none' }}
                        >
                          {ev.label.slice(0, Math.floor(w / 5.5))}
                        </text>
                      )}
                    </g>
                  )
                })}

                {/* Playhead */}
                <line
                  x1={playheadMs * pxPerMs}
                  y1={0}
                  x2={playheadMs * pxPerMs}
                  y2={canvasH}
                  stroke="#22D3EE"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                />
                <text
                  x={playheadMs * pxPerMs + 3}
                  y={canvasH - 4}
                  fill="#22D3EE"
                  fontSize={8}
                  fontFamily="monospace"
                >
                  {fmtTs(data.startTs + playheadMs)}
                </text>
              </svg>

              {/* Scrubber */}
              <div className="px-5 pt-2 pb-4 flex items-center gap-3" style={{ marginLeft: 80 }}>
                <span className="text-[0.55rem] font-mono text-slate-600">{fmtTs(data.startTs)}</span>
                <input
                  type="range"
                  min={0}
                  max={totalMs}
                  step={Math.max(1, Math.round(totalMs / 1000))}
                  value={playheadMs}
                  onChange={(e) => { setPlayheadMs(parseInt(e.target.value, 10)); setPlaying(false) }}
                  className="flex-1 h-1 rounded appearance-none cursor-pointer"
                  style={{ accentColor: '#22D3EE' }}
                />
                <span className="text-[0.55rem] font-mono text-slate-600">{fmtTs(data.endTs)}</span>
              </div>

              {/* Stats bar */}
              <div className="flex gap-6 px-5 pb-4 text-[0.6rem] font-mono text-slate-500" style={{ marginLeft: 80 }}>
                <span>Events: <span className="text-slate-300">{data.events.length}</span></span>
                <span>Visible: <span style={{ color: '#22D3EE' }}>{activeEvents.length}</span></span>
                <span>Duration: <span className="text-slate-300">{fmtTime(totalMs)}</span></span>
                <span>Elapsed: <span style={{ color: '#22D3EE' }}>{fmtTime(playheadMs)}</span></span>
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {detail && (
          <div
            className="w-72 border-l border-white/5 overflow-auto flex flex-col"
            style={{ background: '#060d1a' }}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
              <span className="text-[0.6rem] font-mono font-bold" style={{ color: LANE_COLORS[detail.type as ReplayEventType] ?? '#94a3b8' }}>
                {LANE_LABELS[detail.type as ReplayEventType] ?? detail.type}
              </span>
              <button
                onClick={() => setDetail(null)}
                className="text-slate-600 hover:text-slate-300 text-xs"
              >
                ✕
              </button>
            </div>
            <div className="px-4 py-3 flex flex-col gap-2 text-[0.6rem] font-mono">
              <div className="text-slate-500">
                <span className="text-slate-400">Time:</span> {fmtTs(detail.ts)}
              </div>
              {detail.durationMs !== null && (
                <div className="text-slate-500">
                  <span className="text-slate-400">Duration:</span> {fmtTime(detail.durationMs)}
                </div>
              )}
              {detail.status && (
                <div>
                  <span className="text-slate-400">Status:</span>{' '}
                  <span style={{ color: detail.status === 'error' ? '#EF4444' : '#4ADE80' }}>
                    {detail.status}
                  </span>
                </div>
              )}
              <div className="mt-2 text-slate-400">Content:</div>
              <pre
                className="text-slate-300 whitespace-pre-wrap break-words text-[0.55rem] rounded p-2"
                style={{ background: '#0a1628', maxHeight: 400, overflow: 'auto' }}
              >
                {detail.content}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function SessionReplayPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500 font-mono text-sm">Loading…</div>}>
      <SessionReplayInner />
    </Suspense>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

interface EventRow {
  id: number
  instance_id: string
  type: string
  ts: string
  payload: string
}

const TYPE_COLORS: Record<string, string> = {
  spawn:                   '#00F5FF',
  stop:                    '#F97316',
  reply:                   '#4ADE80',
  progress:                '#F59E0B',
  error:                   '#EF4444',
  error_event:             '#EF4444',
  watchdog:                '#EF4444',
  specclaw_status_changed: '#A855F7',
  scheduler_fired:         '#FCD34D',
}

function eventColor(type: string): string {
  return TYPE_COLORS[type] ?? '#64748b'
}

const WINDOW_OPTIONS = [
  { label: '2h', ms: 2 * 60 * 60_000 },
  { label: '6h', ms: 6 * 60 * 60_000 },
  { label: '24h', ms: 24 * 60 * 60_000 },
]

interface Tick {
  id: number
  type: string
  ts: number
  instanceId: string
  payloadExcerpt: string
}

interface Swimlane {
  slug: string
  ticks: Tick[]
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function payloadExcerpt(raw: string): string {
  try {
    const p = JSON.parse(raw)
    const s = typeof p === 'object' ? JSON.stringify(p) : String(p)
    return s.slice(0, 60)
  } catch {
    return raw.slice(0, 60)
  }
}

export default function TimelinePage() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [windowMs, setWindowMs] = useState(6 * 60 * 60_000)
  const [now, setNow] = useState(Date.now())
  const [tooltip, setTooltip] = useState<{ x: number; y: number; tick: Tick } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  // Tick clock
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(i)
  }, [])

  // Fetch historical events
  useEffect(() => {
    fetch('/api/events?limit=500')
      .then((r) => r.json())
      .then((rows: EventRow[]) => setEvents(rows))
      .catch(() => {})
  }, [])

  // SSE for live events
  useEffect(() => {
    const es = new EventSource('/api/events/stream')
    esRef.current = es
    function handleMsg(e: MessageEvent) {
      try {
        const parsed = JSON.parse(e.data)
        const row: EventRow = {
          id: Date.now(),
          instance_id: parsed.instance_id ?? '',
          type: parsed.type ?? e.type ?? 'unknown',
          ts: new Date(parsed.ts ?? Date.now()).toISOString(),
          payload: JSON.stringify(parsed),
        }
        setEvents((prev) => [row, ...prev].slice(0, 500))
      } catch {}
    }
    es.onmessage = handleMsg
    for (const t of ['spawn','stop','reply','error_event','progress','watchdog','specclaw_status_changed','scheduler_fired']) {
      es.addEventListener(t, (e) => handleMsg(e as MessageEvent))
    }
    return () => es.close()
  }, [])

  const windowStart = now - windowMs

  // Build swimlanes from events within window
  const laneMap = new Map<string, Tick[]>()
  for (const ev of events) {
    const ts = typeof ev.ts === 'string' ? new Date(ev.ts).getTime() : Number(ev.ts) * 1000
    if (ts < windowStart) continue
    const slug = ev.instance_id || '(unknown)'
    if (!laneMap.has(slug)) laneMap.set(slug, [])
    laneMap.get(slug)!.push({
      id: ev.id,
      type: ev.type,
      ts,
      instanceId: ev.instance_id,
      payloadExcerpt: payloadExcerpt(ev.payload),
    })
  }

  // Also include slugs that had no events (would need project list — skip for now)
  const lanes: Swimlane[] = [...laneMap.entries()].map(([slug, ticks]) => ({ slug, ticks }))
  lanes.sort((a, b) => {
    const aLast = Math.max(...a.ticks.map((t) => t.ts))
    const bLast = Math.max(...b.ticks.map((t) => t.ts))
    return bLast - aLast
  })

  const LABEL_W = 120
  const TRACK_H = 28
  const HEADER_H = 36

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-4">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            TIMELINE
          </h1>
          <div className="flex-1" />
          <div className="flex rounded overflow-hidden border border-cyber-cyan/20">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => setWindowMs(opt.ms)}
                className={`text-[10px] px-3 py-1 font-mono uppercase tracking-wider transition-colors ${
                  windowMs === opt.ms ? 'bg-cyber-cyan/20 text-cyber-cyan' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-x-auto overflow-y-auto p-4" ref={containerRef}>
        {lanes.length === 0 ? (
          <div className="flex items-center justify-center h-64 flex-col gap-2 text-slate-600">
            <div className="text-3xl opacity-20">⬡</div>
            <span className="text-xs font-mono">No events in window</span>
          </div>
        ) : (
          <div className="relative" style={{ minWidth: 800 }}>
            {/* Time axis */}
            <div className="flex" style={{ marginLeft: LABEL_W, height: HEADER_H, position: 'relative' }}>
              {Array.from({ length: 7 }).map((_, i) => {
                const t = windowStart + (windowMs * i) / 6
                return (
                  <div key={i} className="flex-1 relative">
                    <span className="absolute top-0 left-0 text-[0.55rem] font-mono text-slate-600 translate-x-[-50%]">
                      {formatTime(t)}
                    </span>
                    <div className="absolute bottom-0 left-0 w-px h-2 bg-slate-700" />
                  </div>
                )
              })}
              {/* "now" line */}
              <div
                className="absolute bottom-0 w-px bg-cyber-cyan/60"
                style={{ right: 0, height: HEADER_H }}
              />
              <span className="absolute bottom-0 right-1 text-[0.55rem] font-mono text-cyber-cyan/70">now</span>
            </div>

            {/* Swimlanes */}
            {lanes.map((lane) => {
              return (
                <div key={lane.slug} className="flex items-center" style={{ height: TRACK_H }}>
                  {/* Slug label */}
                  <div
                    className="shrink-0 text-[0.6rem] font-mono text-slate-400 truncate pr-2"
                    style={{ width: LABEL_W }}
                    title={lane.slug}
                  >
                    {lane.slug}
                  </div>
                  {/* Track */}
                  <div className="flex-1 relative" style={{ height: TRACK_H }}>
                    {/* Track line */}
                    <div className="absolute top-1/2 left-0 right-0 h-px bg-slate-800" />
                    {/* Ticks */}
                    {lane.ticks.map((tick) => {
                      const pct = ((tick.ts - windowStart) / windowMs) * 100
                      if (pct < 0 || pct > 100) return null
                      const color = eventColor(tick.type)
                      return (
                        <div
                          key={tick.id}
                          className="absolute top-1/2 -translate-y-1/2 w-1.5 h-4 rounded-sm cursor-pointer transition-opacity hover:opacity-100"
                          style={{
                            left: `${pct}%`,
                            background: color,
                            opacity: 0.75,
                            transform: 'translate(-50%, -50%)',
                          }}
                          onMouseEnter={(e) => {
                            const rect = (e.target as HTMLElement).getBoundingClientRect()
                            setTooltip({ x: rect.left, y: rect.top, tick })
                          }}
                          onMouseLeave={() => setTooltip(null)}
                        />
                      )
                    })}
                    {/* "now" line */}
                    <div className="absolute top-0 bottom-0 right-0 w-px bg-cyber-cyan/20" />
                  </div>
                </div>
              )
            })}

            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-6 pt-4 border-t border-slate-800">
              {Object.entries(TYPE_COLORS).map(([type, color]) => (
                <div key={type} className="flex items-center gap-1">
                  <div className="w-2 h-3 rounded-sm" style={{ background: color, opacity: 0.8 }} />
                  <span className="text-[0.55rem] font-mono" style={{ color, opacity: 0.7 }}>{type.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none px-2.5 py-2 rounded text-xs font-mono shadow-xl"
          style={{
            left: tooltip.x + 10,
            top: tooltip.y - 60,
            background: 'rgba(4,10,20,0.97)',
            border: `1px solid ${eventColor(tooltip.tick.type)}40`,
            maxWidth: 280,
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: eventColor(tooltip.tick.type) }} />
            <span className="font-bold" style={{ color: eventColor(tooltip.tick.type) }}>{tooltip.tick.type.replace(/_/g, ' ')}</span>
          </div>
          <div className="text-slate-400 text-[0.6rem]">{formatTime(tooltip.tick.ts)}</div>
          {tooltip.tick.payloadExcerpt && (
            <div className="text-slate-500 text-[0.55rem] mt-1 truncate">{tooltip.tick.payloadExcerpt}</div>
          )}
        </div>
      )}

      <footer className="border-t border-cyber-cyan/8 px-6 py-2">
        <p className="text-[0.55rem] font-mono text-slate-600">
          {lanes.length} channels · {lanes.reduce((s, l) => s + l.ticks.length, 0)} events in window · Updates every 5s
        </p>
      </footer>
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
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

// Stable color per slug
const PALETTE = [
  '#00F5FF', '#A855F7', '#4ADE80', '#F59E0B', '#F472B6',
  '#38BDF8', '#FB923C', '#34D399', '#818CF8', '#FCD34D',
]
function slugColor(slug: string): string {
  let h = 0
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function parseJobMinutes(at: string): number | null {
  const m = at.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

function formatLastRun(ts: string | null): string {
  if (!ts) return 'never'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface TooltipState {
  job: ScheduleApiRow
  x: number
  y: number
}

export default function SchedulerCalendar({ events: _events }: Props) {
  const [rows, setRows] = useState<ScheduleApiRow[]>([])
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [nowMinutes, setNowMinutes] = useState(0)
  const [view, setView] = useState<'day' | 'week'>('day')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function tick() {
      const d = new Date()
      setNowMinutes(d.getHours() * 60 + d.getMinutes())
    }
    tick()
    const iv = setInterval(tick, 60_000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    fetch('/api/schedules')
      .then((r) => r.json())
      .then((data: ScheduleApiRow[]) => setRows(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  // Group by day of week for week view (HH:MM jobs fire every day, so same for all days)
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const todayIdx = (new Date().getDay() + 6) % 7 // 0=Mon

  function handleMarkerEnter(job: ScheduleApiRow, e: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setTooltip({ job, x: e.clientX - rect.left, y: e.clientY - rect.top - 8 })
  }

  function handleMarkerLeave() {
    setTooltip(null)
  }

  // 24-hour band
  function DayBand({ label, highlight }: { label?: string; highlight?: boolean }) {
    return (
      <div style={{ marginBottom: 6 }}>
        {label && (
          <div style={{ fontSize: 9, fontFamily: 'monospace', color: highlight ? '#00F5FF' : '#475569', marginBottom: 2 }}>
            {label}
          </div>
        )}
        <div
          style={{
            position: 'relative',
            height: 28,
            background: '#0f172a',
            borderRadius: 4,
            border: `1px solid ${highlight ? '#1e3a5f' : '#1e293b'}`,
            overflow: 'visible',
          }}
        >
          {/* Hour tick marks */}
          {Array.from({ length: 25 }, (_, h) => (
            <div
              key={h}
              style={{
                position: 'absolute',
                left: `${(h / 24) * 100}%`,
                top: 0,
                bottom: 0,
                width: 1,
                background: h % 6 === 0 ? '#1e3a5f' : '#0d1929',
              }}
            />
          ))}
          {/* Hour labels at 0, 6, 12, 18, 24 */}
          {[0, 6, 12, 18].map((h) => (
            <span
              key={h}
              style={{
                position: 'absolute',
                left: `${(h / 24) * 100}%`,
                bottom: -14,
                fontSize: 8,
                fontFamily: 'monospace',
                color: '#334155',
                transform: 'translateX(-50%)',
                whiteSpace: 'nowrap',
              }}
            >
              {String(h).padStart(2, '0')}:00
            </span>
          ))}
          {/* Now indicator */}
          {view === 'day' && label === undefined && (
            <div
              style={{
                position: 'absolute',
                left: `${(nowMinutes / (24 * 60)) * 100}%`,
                top: -2,
                bottom: -2,
                width: 2,
                background: '#EF4444',
                borderRadius: 1,
                zIndex: 10,
              }}
            />
          )}
          {/* Job markers */}
          {rows
            .filter((job) => job.enabled !== false)
            .map((job) => {
              const mins = parseJobMinutes(job.at)
              if (mins === null) return null
              const pct = (mins / (24 * 60)) * 100
              const color = slugColor(job.slug)
              return (
                <div
                  key={job.id}
                  style={{
                    position: 'absolute',
                    left: `${pct}%`,
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: color,
                    boxShadow: `0 0 6px ${color}`,
                    cursor: 'pointer',
                    zIndex: 5,
                  }}
                  onMouseEnter={(e) => handleMarkerEnter(job, e)}
                  onMouseLeave={handleMarkerLeave}
                />
              )
            })}
        </div>
      </div>
    )
  }

  return (
    <GlassCard className="p-3">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#475569' }}>
          {rows.filter((r) => r.enabled !== false).length} active job{rows.filter((r) => r.enabled !== false).length !== 1 ? 's' : ''}
        </span>
        <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: '1px solid rgba(0,245,255,0.2)' }}>
          {(['day', 'week'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                fontSize: 9,
                padding: '2px 8px',
                fontFamily: 'monospace',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                background: view === v ? 'rgba(0,245,255,0.15)' : 'transparent',
                color: view === v ? '#00F5FF' : '#475569',
                border: 'none',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} style={{ position: 'relative', paddingBottom: 18 }}>
        {view === 'day' ? (
          <DayBand />
        ) : (
          DAYS.map((day, i) => (
            <DayBand key={day} label={day} highlight={i === todayIdx} />
          ))
        )}

        {/* Tooltip */}
        {tooltip && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(tooltip.x, 220),
              top: tooltip.y - 80,
              zIndex: 50,
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: '8px 10px',
              minWidth: 180,
              pointerEvents: 'none',
              boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            }}
          >
            <div style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold', color: slugColor(tooltip.job.slug), marginBottom: 3 }}>
              {tooltip.job.slug}
            </div>
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#94a3b8', marginBottom: 2 }}>
              {tooltip.job.at}
            </div>
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#64748b', marginBottom: 4, maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {tooltip.job.prompt.slice(0, 60)}{tooltip.job.prompt.length > 60 ? '…' : ''}
            </div>
            <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#475569' }}>
              last: {formatLastRun(tooltip.job.lastRunAt)}
            </div>
            {tooltip.job.runCount > 0 && (
              <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#334155' }}>
                runs: {tooltip.job.runCount}{tooltip.job.maxRuns ? `/${tooltip.job.maxRuns}` : ''}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      {rows.filter((r) => r.enabled !== false).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 6 }}>
          {[...new Map(rows.filter((r) => r.enabled !== false).map((r) => [r.slug, r])).values()].map((job) => (
            <div key={job.slug} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: slugColor(job.slug), flexShrink: 0 }} />
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#64748b' }}>{job.slug}</span>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { IdleRecoveryEvent, IdleRecoveryResponse } from '../api/idle-recovery/route'

// ─── SVG chart constants ───────────────────────────────────────────────────
const svgW = 700
const svgH = 400
const PAD_T = 20
const PAD_R = 20
const PAD_B = 40
const PAD_L = 50
const plotW = svgW - PAD_L - PAD_R
const plotH = svgH - PAD_T - PAD_B

// x scale: log2(gapHours) in range [0, 5] → [PAD_L, PAD_L + plotW]
function xScale(gapHours: number): number {
  return PAD_L + (Math.log2(Math.max(gapHours, 1)) / 5) * plotW
}

// y scale: quality [0, 100] → [PAD_T + plotH, PAD_T]
function yScale(quality: number): number {
  return PAD_T + plotH - (quality / 100) * plotH
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]
}

function avg(values: number[]): number {
  if (values.length === 0) return 0
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length)
}

const X_TICKS: Array<{ hours: number; label: string }> = [
  { hours: 2, label: '2h' },
  { hours: 4, label: '4h' },
  { hours: 8, label: '8h' },
  { hours: 16, label: '16h' },
  { hours: 32, label: '32h' },
]

const Y_TICKS = [0, 25, 50, 75, 100]

export default function IdleRecoveryPage() {
  const [windowDays, setWindowDays] = useState(90)
  const [data, setData] = useState<IdleRecoveryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/idle-recovery?window=${windowDays}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as IdleRecoveryResponse
        if (!cancelled) {
          setData(json)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error')
          setLoading(false)
        }
      }
    }

    void fetchData()

    const interval = setInterval(() => { void fetchData() }, 300_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [windowDays])

  const events: IdleRecoveryEvent[] = data?.events ?? []
  const qualities = events.map((e) => e.firstTurnQuality)
  const resumedEvents = events.filter((e) => e.resumed)
  const notResumedEvents = events.filter((e) => !e.resumed)
  const medianQuality = median(qualities)
  const pctAbove = events.length > 0
    ? Math.round((events.filter((e) => e.firstTurnQuality >= 50).length / events.length) * 100)
    : 0
  const avgResumed = avg(resumedEvents.map((e) => e.firstTurnQuality))
  const avgNotResumed = avg(notResumedEvents.map((e) => e.firstTurnQuality))

  return (
    <div style={{ background: '#030712', minHeight: '100vh', fontFamily: 'monospace', color: '#cbd5e1', padding: '24px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
        <Link
          href="/"
          style={{ color: '#22d3ee', textDecoration: 'none', fontSize: 13, opacity: 0.8 }}
        >
          ← Dashboard
        </Link>
        <h1 style={{ margin: 0, fontSize: 18, fontFamily: 'Orbitron, monospace', color: '#22d3ee', letterSpacing: '0.05em' }}>
          Idle Recovery Tracker
        </h1>
        <span style={{ color: '#475569', fontSize: 12 }}>auto-refreshes every 5m</span>
      </div>
      <p style={{ margin: '0 0 20px 0', fontSize: 12, color: '#475569' }}>
        First-turn quality after idle gap ≥ 2h
      </p>

      {/* Window selector */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
        {[30, 60, 90].map((w) => (
          <button
            key={w}
            onClick={() => setWindowDays(w)}
            style={{
              padding: '4px 12px',
              fontSize: 12,
              fontFamily: 'monospace',
              background: windowDays === w ? '#22d3ee20' : 'transparent',
              color: windowDays === w ? '#22d3ee' : '#64748b',
              border: `1px solid ${windowDays === w ? '#22d3ee60' : '#1e293b'}`,
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {w}d
          </button>
        ))}
      </div>

      {/* Loading / error states */}
      {loading && (
        <div style={{ color: '#475569', fontSize: 13, padding: '40px 0' }}>
          Loading…
        </div>
      )}
      {!loading && error && (
        <div style={{ color: '#f87171', fontSize: 13, padding: '40px 0' }}>
          Error: {error}
        </div>
      )}
      {!loading && !error && events.length === 0 && (
        <div style={{ color: '#475569', fontSize: 13, padding: '40px 0' }}>
          No idle recovery events in the last {windowDays} days.
        </div>
      )}

      {/* Scatter plot */}
      {!loading && !error && events.length > 0 && (
        <>
          <div style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, padding: 8, marginBottom: 20 }}>
            <svg
              viewBox={`0 0 ${svgW} ${svgH}`}
              style={{ width: '100%', display: 'block' }}
            >
              {/* Y-axis grid lines */}
              {Y_TICKS.map((tick) => {
                const y = yScale(tick)
                return (
                  <g key={tick}>
                    <line
                      x1={PAD_L} y1={y} x2={PAD_L + plotW} y2={y}
                      stroke="#1E293B" strokeWidth={0.5}
                    />
                    <text
                      x={PAD_L - 6} y={y + 4}
                      fontSize={9} textAnchor="end" fill="#64748B" fontFamily="monospace"
                    >
                      {tick}
                    </text>
                  </g>
                )
              })}

              {/* X-axis ticks */}
              {X_TICKS.map(({ hours, label }) => {
                const x = xScale(hours)
                return (
                  <g key={hours}>
                    <line
                      x1={x} y1={PAD_T} x2={x} y2={PAD_T + plotH}
                      stroke="#1E293B" strokeWidth={0.5}
                    />
                    <text
                      x={x} y={svgH - 8}
                      fontSize={9} textAnchor="middle" fill="#64748B" fontFamily="monospace"
                    >
                      {label}
                    </text>
                  </g>
                )
              })}

              {/* X-axis label */}
              <text
                x={PAD_L + plotW / 2} y={svgH - 0}
                fontSize={9} textAnchor="middle" fill="#475569" fontFamily="monospace"
              >
                idle gap (log scale)
              </text>

              {/* Y-axis label */}
              <text
                x={0} y={0}
                fontSize={9} fill="#475569" fontFamily="monospace"
                transform={`translate(12, ${PAD_T + plotH / 2}) rotate(-90)`}
                textAnchor="middle"
              >
                quality score
              </text>

              {/* Recovery threshold reference line at y=50 */}
              <line
                x1={PAD_L} y1={yScale(50)} x2={PAD_L + plotW} y2={yScale(50)}
                stroke="rgba(16,185,129,0.3)" strokeWidth={1} strokeDasharray="6 3"
              />
              <text
                x={PAD_L + plotW - 2} y={yScale(50) - 4}
                fontSize={8} textAnchor="end" fill="rgba(16,185,129,0.6)" fontFamily="monospace"
              >
                Recovery threshold
              </text>

              {/* Scatter dots */}
              {events.map((ev, i) => {
                const cx = xScale(ev.gapHours)
                const cy = yScale(ev.firstTurnQuality)
                const fill = ev.resumed ? '#22d3ee' : '#F59E0B'
                return (
                  <circle
                    key={`${ev.slug}-${ev.ts}-${i}`}
                    cx={cx}
                    cy={cy}
                    r={8}
                    fill={fill}
                    fillOpacity={0.7}
                  >
                    <title>{`${ev.slug} · gap: ${ev.gapHours}h · quality: ${ev.firstTurnQuality} · resumed: ${ev.resumed ? 'yes' : 'no'}`}</title>
                  </circle>
                )
              })}
            </svg>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap', fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 9999, background: '#22d3ee', display: 'inline-block', flexShrink: 0 }} />
              <span style={{ color: '#94a3b8' }}>resumed (session restored)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 9999, background: '#F59E0B', display: 'inline-block', flexShrink: 0 }} />
              <span style={{ color: '#94a3b8' }}>not resumed (fresh start)</span>
            </div>
          </div>

          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Total reactivations', value: String(events.length) },
              { label: 'Median quality', value: String(medianQuality) },
              { label: 'Above threshold', value: `${pctAbove}%` },
              { label: 'Avg quality (resumed)', value: resumedEvents.length > 0 ? String(avgResumed) : '—' },
              { label: 'Avg quality (not resumed)', value: notResumedEvents.length > 0 ? String(avgNotResumed) : '—' },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  background: '#0a1628',
                  border: '1px solid #1e293b',
                  borderRadius: 6,
                  padding: '10px 14px',
                }}
              >
                <div style={{ fontSize: 10, color: '#475569', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {label}
                </div>
                <div style={{ fontSize: 20, color: '#22d3ee', fontFamily: 'Orbitron, monospace', fontWeight: 700 }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Footer */}
      <div style={{ color: '#334155', fontSize: 11, marginTop: 8 }}>
        {data && `${events.length} events · ${data.windowDays}d window`}
        {data?.generatedAt && ` · updated ${new Date(data.generatedAt).toLocaleTimeString()}`}
      </div>
    </div>
  )
}

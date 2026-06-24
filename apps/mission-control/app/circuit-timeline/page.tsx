'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { CircuitEvent, CircuitTimelineResponse } from '../api/circuit-timeline/route'

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export default function CircuitTimelinePage() {
  const [windowDays, setWindowDays] = useState(30)
  const [filterSlug, setFilterSlug] = useState('')
  const [filterEvent, setFilterEvent] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<CircuitTimelineResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ days: String(windowDays), page: String(page) })
        if (filterSlug) params.set('slug', filterSlug)
        if (filterEvent) params.set('event', filterEvent)
        const res = await fetch(`/api/circuit-timeline?${params}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as CircuitTimelineResponse
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
    const interval = setInterval(() => { void fetchData() }, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [windowDays, filterSlug, filterEvent, page])

  // Reset to page 1 on filter change
  useEffect(() => { setPage(1) }, [windowDays, filterSlug, filterEvent])

  const events: CircuitEvent[] = data?.events ?? []
  const slugOptions = data?.slugs ?? []
  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1

  const openCount = events.filter((e) => e.event === 'open').length
  const closeCount = events.filter((e) => e.event === 'close').length

  return (
    <div style={{ background: '#030712', minHeight: '100vh', fontFamily: 'monospace', color: '#cbd5e1', padding: '24px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
        <Link href="/" style={{ color: '#22d3ee', textDecoration: 'none', fontSize: 13, opacity: 0.8 }}>
          ← Dashboard
        </Link>
        <h1 style={{ margin: 0, fontSize: 18, fontFamily: 'Orbitron, monospace', color: '#22d3ee', letterSpacing: '0.05em' }}>
          Circuit Breaker Timeline
        </h1>
        <span style={{ color: '#475569', fontSize: 12 }}>auto-refreshes every 1m</span>
      </div>
      <p style={{ margin: '0 0 20px 0', fontSize: 12, color: '#475569' }}>
        Open/close events from project circuit breakers — written to circuit-events.jsonl on each state transition
      </p>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[7, 14, 30].map((w) => (
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

        <select
          value={filterSlug}
          onChange={(e) => setFilterSlug(e.target.value)}
          style={{
            background: '#0a1628',
            border: '1px solid #1e3a5f',
            color: '#94a3b8',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 12,
            fontFamily: 'monospace',
            cursor: 'pointer',
          }}
        >
          <option value="">All projects</option>
          {slugOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          value={filterEvent}
          onChange={(e) => setFilterEvent(e.target.value)}
          style={{
            background: '#0a1628',
            border: '1px solid #1e3a5f',
            color: '#94a3b8',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: 12,
            fontFamily: 'monospace',
            cursor: 'pointer',
          }}
        >
          <option value="">All events</option>
          <option value="open">Open only</option>
          <option value="close">Close only</option>
        </select>
      </div>

      {loading && <div style={{ color: '#475569', fontSize: 13, padding: '40px 0' }}>Loading…</div>}
      {!loading && error && <div style={{ color: '#f87171', fontSize: 13, padding: '40px 0' }}>Error: {error}</div>}

      {!loading && !error && (
        <>
          {/* Summary chips */}
          {data && data.total > 0 && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              <div style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 6, padding: '8px 14px' }}>
                <span style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total events</span>
                <div style={{ fontSize: 20, color: '#22d3ee', fontFamily: 'Orbitron, monospace', marginTop: 2 }}>{data.total}</div>
              </div>
              <div style={{ background: '#0a1628', border: '1px solid #7f1d1d', borderRadius: 6, padding: '8px 14px' }}>
                <span style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Opens (this page)</span>
                <div style={{ fontSize: 20, color: '#f87171', fontFamily: 'Orbitron, monospace', marginTop: 2 }}>{openCount}</div>
              </div>
              <div style={{ background: '#0a1628', border: '1px solid #14532d', borderRadius: 6, padding: '8px 14px' }}>
                <span style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Closes (this page)</span>
                <div style={{ fontSize: 20, color: '#4ade80', fontFamily: 'Orbitron, monospace', marginTop: 2 }}>{closeCount}</div>
              </div>
            </div>
          )}

          {events.length === 0 && (
            <div style={{ color: '#475569', fontSize: 13, padding: '40px 0' }}>
              No circuit events in the last {windowDays} days.
              {' '}Events are written to <code style={{ color: '#94a3b8' }}>circuit-events.jsonl</code> whenever a project&apos;s circuit opens or closes.
            </div>
          )}

          {/* Event stream */}
          {events.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {events.map((ev, i) => {
                const isOpen = ev.event === 'open'
                const borderColor = isOpen ? '#7f1d1d' : '#14532d'
                const badgeColor = isOpen ? '#f87171' : '#4ade80'
                const badgeBg = isOpen ? '#7f1d1d40' : '#14532d40'
                return (
                  <div
                    key={`${ev.ts}-${ev.slug}-${i}`}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '10px 14px',
                      background: i % 2 === 0 ? '#060d1a' : '#080f1e',
                      borderLeft: `3px solid ${borderColor}`,
                      borderRadius: 4,
                    }}
                  >
                    {/* Event badge */}
                    <span style={{
                      flexShrink: 0,
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 700,
                      color: badgeColor,
                      background: badgeBg,
                      border: `1px solid ${borderColor}`,
                      minWidth: 48,
                      textAlign: 'center',
                    }}>
                      {isOpen ? 'OPEN' : 'CLOSE'}
                    </span>

                    {/* Slug */}
                    <span style={{ flexShrink: 0, color: '#22d3ee', fontSize: 13, minWidth: 120 }}>
                      {ev.slug}
                    </span>

                    {/* Reason */}
                    <span style={{ flex: 1, color: '#94a3b8', fontSize: 12 }}>
                      {ev.reason}
                      {ev.stuckCount != null && (
                        <span style={{ color: '#f87171', marginLeft: 8 }}>({ev.stuckCount} failures)</span>
                      )}
                      {ev.durationMs != null && (
                        <span style={{ color: '#4ade80', marginLeft: 8 }}>open for {formatDuration(ev.durationMs)}</span>
                      )}
                    </span>

                    {/* Timestamp */}
                    <span style={{ flexShrink: 0, color: '#475569', fontSize: 11, textAlign: 'right' }}>
                      <span title={ev.ts}>{formatRelative(ev.ts)}</span>
                      <div style={{ fontSize: 10, color: '#334155' }}>{ev.ts.slice(0, 10)}</div>
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center', fontSize: 12, color: '#64748b' }}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{
                  padding: '4px 12px',
                  background: 'transparent',
                  border: '1px solid #1e293b',
                  borderRadius: 4,
                  color: page <= 1 ? '#334155' : '#94a3b8',
                  cursor: page <= 1 ? 'default' : 'pointer',
                  fontFamily: 'monospace',
                  fontSize: 12,
                }}
              >
                ← prev
              </button>
              <span>page {page} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={{
                  padding: '4px 12px',
                  background: 'transparent',
                  border: '1px solid #1e293b',
                  borderRadius: 4,
                  color: page >= totalPages ? '#334155' : '#94a3b8',
                  cursor: page >= totalPages ? 'default' : 'pointer',
                  fontFamily: 'monospace',
                  fontSize: 12,
                }}
              >
                next →
              </button>
            </div>
          )}
        </>
      )}

      {/* Footer */}
      <div style={{ color: '#334155', fontSize: 11, marginTop: 16 }}>
        {data && `${data.total} events · ${data.windowDays}d window`}
        {data?.generatedAt && ` · updated ${new Date(data.generatedAt).toLocaleTimeString()}`}
      </div>
    </div>
  )
}

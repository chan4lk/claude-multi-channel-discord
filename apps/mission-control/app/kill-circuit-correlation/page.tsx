'use client'

import { useEffect, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { KillCircuitResponse, KillCircuitEvent } from '../api/kill-circuit-correlation/route'

function fmtTs(ts: string): string {
  return ts.slice(0, 16).replace('T', ' ')
}

function latencyLabel(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function KillRow({ ev }: { ev: KillCircuitEvent }) {
  const tripped = ev.circuitOpenTs !== null
  return (
    <tr style={{ borderBottom: '1px solid #0F1E35' }}>
      <td style={{ padding: '8px 10px', color: '#64748B', fontSize: 11 }}>{fmtTs(ev.killTs)}</td>
      <td style={{ padding: '8px 10px', color: '#00F5FF', fontSize: 12 }}>{ev.slug}</td>
      <td style={{ padding: '8px 10px', color: '#94A3B8', fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {ev.lastToolCall ?? '—'}
      </td>
      <td style={{ padding: '8px 10px' }}>
        {tripped ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#22C55E', fontSize: 11 }}>→ circuit open</span>
            <span style={{
              background: '#22C55E20', color: '#22C55E',
              border: '1px solid #22C55E40', borderRadius: 4,
              padding: '1px 6px', fontSize: 10,
            }}>
              +{latencyLabel(ev.circuitOpenMs)}
            </span>
          </div>
        ) : (
          <span style={{ color: '#475569', fontSize: 11 }}>no trip</span>
        )}
      </td>
    </tr>
  )
}

export default function KillCircuitCorrelationPage() {
  const [data, setData] = useState<KillCircuitResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterSlug, setFilterSlug] = useState('')
  const [days, setDays] = useState(30)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ days: String(days) })
    if (filterSlug) params.set('slug', filterSlug)
    fetch(`/api/kill-circuit-correlation?${params}`)
      .then((r) => r.json())
      .then((d: KillCircuitResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [filterSlug, days])

  return (
    <div style={{ background: '#080F1E', minHeight: '100vh', fontFamily: 'monospace', color: '#E2E8F0' }}>
      <SubPageHeader title="Watchdog Kill → Circuit Correlation">
        <span style={{ color: '#475569', fontSize: 11 }}>kill → circuit-open causal chain</span>
      </SubPageHeader>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px' }}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <select
            value={filterSlug}
            onChange={(e) => setFilterSlug(e.target.value)}
            style={{
              background: '#0B1628', border: '1px solid #1E3A5F', color: '#94A3B8',
              padding: '6px 10px', borderRadius: 6, fontSize: 12,
            }}
          >
            <option value="">All projects</option>
            {(data?.slugs ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{
              background: '#0B1628', border: '1px solid #1E3A5F', color: '#94A3B8',
              padding: '6px 10px', borderRadius: 6, fontSize: 12,
            }}
          >
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>Last {d}d</option>)}
          </select>
        </div>

        {/* Summary cards */}
        {data && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
            {[
              { label: 'Total kills', value: String(data.totalKills), color: '#EF4444' },
              { label: 'Tripped circuit', value: `${data.killsThatTripped} (${data.killsThatTrippedPct}%)`, color: '#F59E0B' },
              { label: 'Avg kill→trip', value: data.avgKillToTripMs !== null ? latencyLabel(data.avgKillToTripMs) : '—', color: '#22C55E' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                background: '#0B1628', border: '1px solid #1E3A5F',
                borderRadius: 8, padding: '12px 20px', textAlign: 'center', minWidth: 130,
              }}>
                <div style={{ color, fontSize: 18, fontWeight: 700 }}>{value}</div>
                <div style={{ color: '#475569', fontSize: 10, marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: '#475569' }}>Loading…</div>}

        {!loading && data && data.events.length === 0 && (
          <div style={{
            textAlign: 'center', color: '#475569', fontSize: 14,
            border: '1px solid #1E3A5F', borderRadius: 8, padding: '40px 24px',
          }}>
            No watchdog kill events in the selected window.
          </div>
        )}

        {!loading && data && data.events.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1E3A5F', color: '#475569', fontSize: 10 }}>
                  <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>Kill Time</th>
                  <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>Project</th>
                  <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>Last Tool Call</th>
                  <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>Circuit Trip (≤5m)</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((ev, i) => <KillRow key={i} ev={ev} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { ScheduleRow } from '../api/schedules/route'

function statusBadge(row: ScheduleRow): { label: string; color: string } {
  if (!row.enabled) return { label: 'paused', color: '#F59E0B' }
  if (row.maxRuns !== null && row.runCount >= row.maxRuns) return { label: 'exhausted', color: '#64748B' }
  return { label: 'active', color: '#22C55E' }
}

function nextFireLabel(row: ScheduleRow & { nextFireMs?: number }): string {
  if (!row.enabled) return '—'
  if (row.maxRuns !== null && row.runCount >= row.maxRuns) return 'exhausted'
  const ms = row.nextFireMs
  if (!ms || ms <= 0) return '—'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `in ${sec}s`
  if (sec < 3600) return `in ${Math.round(sec / 60)}m`
  return `in ${Math.round(sec / 3600)}h`
}

function nextFireAbsolute(row: ScheduleRow & { nextFireMs?: number }): string {
  if (!row.nextFireMs || row.nextFireMs <= 0) return ''
  const abs = new Date(Date.now() + row.nextFireMs)
  return abs.toLocaleString()
}

function timeAgo(ts: string | null): string {
  if (!ts) return 'never'
  const diff = Date.now() - Date.parse(ts)
  const min = Math.floor(diff / 60_000)
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

type EnrichedRow = ScheduleRow & { nextFireMs?: number }

export default function SchedulesPage() {
  const [rows, setRows] = useState<EnrichedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredNext, setHoveredNext] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/schedules')
      .then((r) => r.json())
      .then((data: EnrichedRow[]) => { setRows(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const active = rows.filter((r) => r.enabled && !(r.maxRuns !== null && r.runCount >= r.maxRuns))
  const paused = rows.filter((r) => !r.enabled)
  const exhausted = rows.filter((r) => r.enabled && r.maxRuns !== null && r.runCount >= r.maxRuns)

  return (
    <div style={{ background: '#080F1E', minHeight: '100vh', fontFamily: 'monospace', color: '#E2E8F0' }}>
      <SubPageHeader title="Active Schedules">
        <span style={{ color: '#475569', fontSize: 11 }}>fleet-wide schedule inventory</span>
      </SubPageHeader>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 24px' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#475569' }}>Loading schedules…</div>
        )}

        {!loading && rows.length === 0 && (
          <div style={{
            marginTop: 60, textAlign: 'center', color: '#475569', fontSize: 14,
            border: '1px solid #1E3A5F', borderRadius: 8, padding: '40px 24px',
          }}>
            No schedules found. Use <code style={{ color: '#00F5FF' }}>!project schedule add</code> to create one.
          </div>
        )}

        {!loading && rows.length > 0 && (
          <>
            {/* Summary cards */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
              {[
                { label: 'Active', count: active.length, color: '#22C55E' },
                { label: 'Paused', count: paused.length, color: '#F59E0B' },
                { label: 'Exhausted', count: exhausted.length, color: '#64748B' },
                { label: 'Total', count: rows.length, color: '#E2E8F0' },
              ].map(({ label, count, color }) => (
                <div key={label} style={{
                  background: '#0B1628', border: '1px solid #1E3A5F',
                  borderRadius: 8, padding: '12px 20px', textAlign: 'center', minWidth: 90,
                }}>
                  <div style={{ color, fontSize: 22, fontWeight: 700 }}>{count}</div>
                  <div style={{ color: '#475569', fontSize: 10 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1E3A5F', color: '#475569', fontSize: 10 }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>ID</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Project</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Schedule</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Last Run</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Next Fire</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Runs</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const badge = statusBadge(row)
                    const nfl = nextFireLabel(row)
                    const nfa = nextFireAbsolute(row)
                    return (
                      <tr
                        key={row.id}
                        style={{ borderBottom: '1px solid #0F1E35', cursor: 'pointer' }}
                        onClick={() => {
                          window.location.href = `/scheduler-history?schedule_id=${row.id}`
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#0B1628')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ padding: '8px 8px', color: '#475569', fontSize: 10 }}>
                          {row.id.slice(0, 12)}…
                        </td>
                        <td style={{ padding: '8px 8px', color: '#00F5FF' }}>{row.slug}</td>
                        <td style={{ padding: '8px 8px', color: '#94A3B8' }}>
                          {row.interval ? `every ${row.interval}` : `at ${row.at}`}
                        </td>
                        <td style={{ padding: '8px 8px' }}>
                          <span style={{
                            background: badge.color + '20', color: badge.color,
                            border: `1px solid ${badge.color}40`,
                            borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700,
                          }}>
                            {badge.label}
                          </span>
                        </td>
                        <td style={{ padding: '8px 8px', color: '#64748B' }}>
                          {timeAgo(row.lastRunAt)}
                        </td>
                        <td
                          style={{ padding: '8px 8px', color: '#94A3B8', position: 'relative' }}
                          onMouseEnter={() => setHoveredNext(row.id)}
                          onMouseLeave={() => setHoveredNext(null)}
                        >
                          {nfl}
                          {hoveredNext === row.id && nfa && (
                            <div style={{
                              position: 'absolute', bottom: '100%', left: 0,
                              background: '#0B1628', border: '1px solid #1E3A5F',
                              borderRadius: 4, padding: '4px 8px',
                              fontSize: 10, color: '#CBD5E1', whiteSpace: 'nowrap', zIndex: 50,
                            }}>
                              {nfa}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', color: '#94A3B8' }}>
                          {row.runCount}{row.maxRuns !== null ? `/${row.maxRuns}` : ''}
                        </td>
                        <td style={{
                          padding: '8px 8px', color: '#64748B', maxWidth: 220,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {row.prompt.slice(0, 80)}{row.prompt.length > 80 ? '…' : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 12, color: '#1E3A5F', fontSize: 10 }}>
              Click row to view schedule history
            </div>
          </>
        )}
      </div>
    </div>
  )
}

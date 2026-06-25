'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'
import type { CommandHistoryResponse, CommandHistoryEntry } from '../api/command-history/route'

const PLATFORM_ICON: Record<string, string> = {
  discord: '◉',
  teams: '⬡',
  whatsapp: '◎',
}

const DAY_OPTIONS = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
]

function fmt(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return ts }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

export default function CommandHistoryPage() {
  const [data, setData] = useState<CommandHistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)
  const [userFilter, setUserFilter] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ days: String(days) })
    if (userFilter) params.set('user', userFilter)
    fetch(`/api/command-history?${params}`)
      .then(r => r.json())
      .then((d: CommandHistoryResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [days, userFilter])

  useEffect(() => { load() }, [load])

  const filtered = data?.entries.filter(e =>
    !search || e.text.toLowerCase().includes(search.toLowerCase())
  ) ?? []

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#e2e8f0', fontFamily: 'monospace', padding: '24px' }}>
      <SubPageHeader title="Operator Message History">
        <button onClick={load} style={{ background: 'none', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
          ↻ Refresh
        </button>
      </SubPageHeader>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {DAY_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => setDays(o.value)}
              style={{
                background: days === o.value ? '#1e40af' : '#1e293b',
                border: '1px solid #334155',
                color: days === o.value ? '#93c5fd' : '#94a3b8',
                borderRadius: 6,
                padding: '4px 10px',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        {data?.users && data.users.length > 1 && (
          <select
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
            style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}
          >
            <option value="">All users</option>
            {data.users.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        )}
        <input
          placeholder="Search messages…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6, padding: '4px 10px', fontSize: 12, minWidth: 200 }}
        />
        {data && (
          <span style={{ color: '#64748b', fontSize: 12 }}>
            {filtered.length} / {data.total} messages
          </span>
        )}
      </div>

      {loading && <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading…</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>
          No operator messages found for selected range.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filtered.map((entry, idx) => {
            const key = `${entry.ts}-${idx}`
            const isExpanded = expanded === key
            return (
              <div
                key={key}
                style={{
                  background: '#0f172a',
                  border: '1px solid #1e293b',
                  borderRadius: 8,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px', cursor: entry.responseSnippet ? 'pointer' : 'default' }}
                  onClick={() => entry.responseSnippet && setExpanded(isExpanded ? null : key)}
                >
                  <span style={{ color: '#64748b', fontSize: 11, minWidth: 120, paddingTop: 2 }}>
                    {fmt(entry.ts)}
                  </span>
                  <span style={{ color: '#475569', fontSize: 13, minWidth: 20 }} title={entry.platform}>
                    {PLATFORM_ICON[entry.platform] ?? '◦'}
                  </span>
                  <span style={{ color: '#7c3aed', fontSize: 11, minWidth: 80, paddingTop: 2 }}>
                    {entry.user}
                  </span>
                  <span style={{ flex: 1, color: '#e2e8f0', fontSize: 13, lineHeight: 1.5 }}>
                    {isExpanded ? entry.text : truncate(entry.text, 120)}
                  </span>
                  {entry.responseSnippet && (
                    <span style={{ color: '#475569', fontSize: 11 }}>{isExpanded ? '▲' : '▼'}</span>
                  )}
                </div>
                {isExpanded && entry.responseSnippet && (
                  <div style={{ padding: '0 14px 12px 14px', borderTop: '1px solid #1e293b', marginTop: 4 }}>
                    <div style={{ color: '#64748b', fontSize: 11, marginBottom: 6, marginTop: 8 }}>Response snippet</div>
                    <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                      {entry.responseSnippet}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 24, color: '#334155', fontSize: 11, textAlign: 'right' }}>
        {data?.generatedAt ? `Generated ${fmt(data.generatedAt)}` : ''}
        {' · '}
        <Link href="/audit" style={{ color: '#475569' }}>Audit Log</Link>
        {' · '}
        <Link href="/command-log" style={{ color: '#475569' }}>Command Log</Link>
      </div>
    </div>
  )
}

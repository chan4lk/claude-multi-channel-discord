'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { BranchInfo, BranchesResponse } from '../api/branches/route'

function formatDate(raw: string | null): string {
  if (!raw) return '—'
  try { return new Date(raw).toLocaleString() } catch { return raw }
}

type SortKey = keyof Pick<BranchInfo, 'slug' | 'aheadCount' | 'behindCount' | 'uncommittedCount'>

function RowStatus({ b }: { b: BranchInfo }) {
  if (!b.hasGit) return <span style={{ color: '#4b5563' }}>no git</span>
  if (b.diverged) return <span style={{ color: '#EF4444', fontWeight: 700 }}>diverged</span>
  if (b.behindCount > 0) return <span style={{ color: '#F59E0B' }}>behind</span>
  if (b.aheadCount > 0) return <span style={{ color: '#4ADE80' }}>ahead</span>
  return <span style={{ color: '#6b7280' }}>clean</span>
}

function PullButton({ slug, onDone }: { slug: string; onDone: () => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  async function handlePull() {
    setState('loading')
    try {
      const res = await fetch(`/api/projects/${slug}/pull`, { method: 'POST' })
      if (res.ok) {
        setState('done')
        setTimeout(() => { setState('idle'); onDone() }, 1500)
      } else {
        setState('error')
        setTimeout(() => setState('idle'), 2000)
      }
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 2000)
    }
  }

  const label = state === 'loading' ? '⟳ pulling…' : state === 'done' ? '✓ done' : state === 'error' ? '✗ error' : 'Pull'
  const color = state === 'done' ? '#4ADE80' : state === 'error' ? '#EF4444' : '#00F5FF'

  return (
    <button
      onClick={handlePull}
      disabled={state === 'loading'}
      style={{
        background: 'none',
        border: `1px solid ${color}`,
        color,
        borderRadius: 4,
        padding: '2px 8px',
        cursor: state === 'loading' ? 'wait' : 'pointer',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

export default function BranchesPage() {
  const [data, setData] = useState<BranchesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('behindCount')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [filter, setFilter] = useState<'all' | 'diverged' | 'behind' | 'ahead' | 'clean'>('all')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/branches')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const rows = (data?.branches ?? [])
    .filter((b) => {
      if (filter === 'diverged') return b.diverged
      if (filter === 'behind') return b.behindCount > 0 && !b.diverged
      if (filter === 'ahead') return b.aheadCount > 0 && !b.diverged
      if (filter === 'clean') return b.hasGit && b.aheadCount === 0 && b.behindCount === 0 && b.uncommittedCount === 0
      return true
    })
    .sort((a, b) => {
      const av = sortKey === 'slug' ? a.slug : (a[sortKey] as number)
      const bv = sortKey === 'slug' ? b.slug : (b[sortKey] as number)
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })

  const SortTh = ({ label, k }: { label: string; k: SortKey }) => (
    <th
      onClick={() => toggleSort(k)}
      style={{
        cursor: 'pointer',
        padding: '8px 12px',
        textAlign: 'left',
        color: sortKey === k ? '#00F5FF' : '#9ca3af',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 12,
      }}
    >
      {label} {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  )

  const bg = '#0d1117'
  const card = '#111827'
  const border = '#1f2937'

  return (
    <div style={{ background: bg, minHeight: '100vh', padding: '24px 32px', color: '#e5e7eb', fontFamily: 'JetBrains Mono, monospace' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <Link href="/" style={{ color: '#4b5563', textDecoration: 'none', fontSize: 13 }}>← Dashboard</Link>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#00F5FF', letterSpacing: 1 }}>
          Git Branch Dashboard
        </h1>
        {data && (
          <span style={{ fontSize: 11, color: '#4b5563', marginLeft: 'auto' }}>
            updated {new Date(data.checkedAt).toLocaleTimeString()}
          </span>
        )}
        <button
          onClick={fetchData}
          style={{ background: 'none', border: '1px solid #1f2937', color: '#9ca3af', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}
        >
          Refresh
        </button>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {(['all', 'diverged', 'behind', 'ahead', 'clean'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              background: filter === f ? 'rgba(0,245,255,0.1)' : 'none',
              border: `1px solid ${filter === f ? '#00F5FF' : '#1f2937'}`,
              color: filter === f ? '#00F5FF' : '#6b7280',
              borderRadius: 20,
              padding: '3px 12px',
              cursor: 'pointer',
              fontSize: 11,
              textTransform: 'capitalize',
            }}
          >
            {f}
            {f !== 'all' && data && (
              <span style={{ marginLeft: 6, opacity: 0.7 }}>
                ({data.branches.filter((b) => {
                  if (f === 'diverged') return b.diverged
                  if (f === 'behind') return b.behindCount > 0 && !b.diverged
                  if (f === 'ahead') return b.aheadCount > 0 && !b.diverged
                  if (f === 'clean') return b.hasGit && b.aheadCount === 0 && b.behindCount === 0 && b.uncommittedCount === 0
                  return false
                }).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <div style={{ color: '#4b5563', fontSize: 13 }}>Loading git state…</div>}
      {error && <div style={{ color: '#EF4444', fontSize: 13 }}>Error: {error}</div>}

      {!loading && !error && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: card, borderRadius: 8, overflow: 'hidden' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${border}` }}>
                <SortTh label="Slug" k="slug" />
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#9ca3af', fontSize: 12 }}>Branch</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#9ca3af', fontSize: 12 }}>Status</th>
                <SortTh label="↑ Ahead" k="aheadCount" />
                <SortTh label="↓ Behind" k="behindCount" />
                <SortTh label="Uncommitted" k="uncommittedCount" />
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#9ca3af', fontSize: 12 }}>Last Commit</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#9ca3af', fontSize: 12 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#4b5563', fontSize: 13 }}>
                    No projects match this filter.
                  </td>
                </tr>
              )}
              {rows.map((b, i) => {
                const rowBg = b.diverged
                  ? 'rgba(239,68,68,0.04)'
                  : b.behindCount > 0
                  ? 'rgba(245,158,11,0.04)'
                  : 'transparent'

                return (
                  <tr
                    key={b.slug}
                    style={{
                      borderBottom: i < rows.length - 1 ? `1px solid ${border}` : 'none',
                      background: rowBg,
                    }}
                  >
                    <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, color: '#e5e7eb' }}>
                      {b.slug}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: '#9ca3af' }}>
                      {b.hasGit ? (b.currentBranch ?? '—') : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12 }}>
                      <RowStatus b={b} />
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: b.aheadCount > 0 ? '#4ADE80' : '#4b5563', textAlign: 'right' }}>
                      {b.hasGit ? b.aheadCount : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: b.behindCount > 0 ? '#F59E0B' : '#4b5563', textAlign: 'right' }}>
                      {b.hasGit ? b.behindCount : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: b.uncommittedCount > 0 ? '#A78BFA' : '#4b5563', textAlign: 'right' }}>
                      {b.hasGit ? b.uncommittedCount : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 11, color: '#6b7280', maxWidth: 260 }}>
                      {b.lastCommitSha && (
                        <span style={{ color: '#4b5563', marginRight: 6 }}>
                          [{b.lastCommitSha}]
                        </span>
                      )}
                      <span style={{ color: '#9ca3af' }} title={formatDate(b.lastCommitDate)}>
                        {b.lastCommitMessage
                          ? b.lastCommitMessage.length > 50
                            ? b.lastCommitMessage.slice(0, 50) + '…'
                            : b.lastCommitMessage
                          : '—'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {b.hasGit && b.behindCount > 0 && (
                          <PullButton slug={b.slug} onDone={fetchData} />
                        )}
                        {b.hasGit && b.aheadCount > 0 && (
                          <Link
                            href={`/pipeline?slug=${b.slug}`}
                            style={{
                              background: 'none',
                              border: '1px solid #1f2937',
                              color: '#9ca3af',
                              borderRadius: 4,
                              padding: '2px 8px',
                              fontSize: 11,
                              textDecoration: 'none',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            View Diff
                          </Link>
                        )}
                        {!b.hasGit && <span style={{ color: '#374151', fontSize: 11 }}>no git</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

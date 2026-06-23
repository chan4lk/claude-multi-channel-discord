'use client'

import { useCallback, useEffect, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { IdleProject, IdleFleetResponse } from '../api/idle-fleet/route'

const BADGE_CONFIG = {
  active:  { label: 'Active',   color: '#10B981', bg: '#10B98118', border: '#10B98140' },
  idle:    { label: 'Idle',     color: '#F59E0B', bg: '#F59E0B18', border: '#F59E0B40' },
  dormant: { label: 'Dormant',  color: '#EF4444', bg: '#EF444418', border: '#EF444440' },
  never:   { label: 'No turns', color: '#64748B', bg: '#64748B18', border: '#64748B40' },
}

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) {
    const hrs = Math.floor(diff / 3_600_000)
    if (hrs === 0) return `${Math.floor(diff / 60_000)}m ago`
    return `${hrs}h ago`
  }
  return `${days}d ago`
}

function absTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function IdleFleetPage() {
  const [projects, setProjects] = useState<IdleProject[]>([])
  const [loading, setLoading] = useState(true)
  const [nudging, setNudging] = useState<string | null>(null)
  const [nudgeResult, setNudgeResult] = useState<Record<string, string>>({})
  const [lastRefresh, setLastRefresh] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/idle-fleet')
      if (res.ok) {
        const data = await res.json() as IdleFleetResponse
        setProjects(data.projects)
        setLastRefresh(new Date().toLocaleTimeString())
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
    const id = setInterval(() => void fetchData(), 15 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchData])

  async function nudge(slug: string) {
    setNudging(slug)
    try {
      const res = await fetch('/api/idle-fleet/nudge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      setNudgeResult((prev) => ({
        ...prev,
        [slug]: data.ok ? '✓ Nudge sent' : (data.error ?? 'Failed'),
      }))
      setTimeout(() => setNudgeResult((prev) => { const n = { ...prev }; delete n[slug]; return n }), 4000)
    } finally {
      setNudging(null)
    }
  }

  const dormantCount = projects.filter((p) => p.idleBadge === 'dormant' || p.idleBadge === 'never').length
  const idleCount = projects.filter((p) => p.idleBadge === 'idle').length

  return (
    <div style={{ background: '#080F1E', minHeight: '100vh', fontFamily: 'monospace' }}>
      <SubPageHeader title="Idle Fleet" />

      <div style={{ padding: '20px 24px' }}>
        {/* Summary bar */}
        <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
          {Object.entries(BADGE_CONFIG).map(([key, cfg]) => {
            const count = projects.filter((p) => p.idleBadge === key).length
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                  background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
                }}>{cfg.label}</span>
                <span style={{ color: '#94A3B8', fontSize: 13 }}>{count}</span>
              </div>
            )
          })}
          <span style={{ marginLeft: 'auto', color: '#475569', fontSize: 11 }}>
            {lastRefresh && `refreshed ${lastRefresh}`}
          </span>
          <button
            onClick={() => void fetchData()}
            style={{
              padding: '4px 12px', borderRadius: 5, fontFamily: 'monospace', fontSize: 11,
              background: '#1E3A5F30', border: '1px solid #1E3A5F', color: '#94A3B8', cursor: 'pointer',
            }}
          >↻</button>
        </div>

        {dormantCount > 0 || idleCount > 0 ? (
          <div style={{
            background: '#F59E0B10', border: '1px solid #F59E0B30', borderRadius: 8,
            padding: '8px 16px', marginBottom: 16, color: '#F59E0B', fontSize: 12,
          }}>
            {dormantCount > 0 && `${dormantCount} dormant project${dormantCount > 1 ? 's' : ''} (30d+)`}
            {dormantCount > 0 && idleCount > 0 && ' · '}
            {idleCount > 0 && `${idleCount} idle project${idleCount > 1 ? 's' : ''} (7–30d)`}
          </div>
        ) : null}

        {loading ? (
          <div style={{ color: '#475569', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>
            Scanning transcripts…
          </div>
        ) : projects.length === 0 ? (
          <div style={{ color: '#475569', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>
            No projects found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px', minWidth: 600 }}>
              <thead>
                <tr>
                  {['Project', 'Last Turn', 'Absolute', 'Turns', 'Memory Files', 'Status', ''].map((h) => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '6px 12px', color: '#475569', fontSize: 11,
                      fontWeight: 600, borderBottom: '1px solid #1E3A5F', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const cfg = BADGE_CONFIG[p.idleBadge]
                  const isNudging = nudging === p.slug
                  const result = nudgeResult[p.slug]
                  return (
                    <tr key={p.slug} style={{ background: '#0B1A2E' }}>
                      <td style={{ padding: '8px 12px', color: '#CBD5E1', fontSize: 13, borderRadius: '6px 0 0 6px', whiteSpace: 'nowrap' }}>
                        {p.slug}
                      </td>
                      <td style={{ padding: '8px 12px', color: '#94A3B8', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {relTime(p.lastTurnAt)}
                      </td>
                      <td style={{ padding: '8px 12px', color: '#475569', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {absTime(p.lastTurnAt)}
                      </td>
                      <td style={{ padding: '8px 12px', color: '#94A3B8', fontSize: 12, textAlign: 'right' }}>
                        {p.turnCount}
                      </td>
                      <td style={{ padding: '8px 12px', color: '#94A3B8', fontSize: 12, textAlign: 'right' }}>
                        {p.memoryFileCount}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {p.idleBadge !== 'active' && (
                          <span style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                            background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
                          }}>{cfg.label}</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', borderRadius: '0 6px 6px 0' }}>
                        {result ? (
                          <span style={{ color: result.startsWith('✓') ? '#10B981' : '#EF4444', fontSize: 11 }}>
                            {result}
                          </span>
                        ) : (
                          <button
                            onClick={() => void nudge(p.slug)}
                            disabled={isNudging}
                            style={{
                              padding: '4px 12px', borderRadius: 5, fontFamily: 'monospace', fontSize: 11,
                              background: '#A78BFA18', border: '1px solid #A78BFA40', color: '#A78BFA',
                              cursor: isNudging ? 'default' : 'pointer',
                              opacity: isNudging ? 0.5 : 1,
                            }}
                          >
                            {isNudging ? '…' : '↯ Nudge'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ color: '#1E3A5F', fontSize: 11, marginTop: 16 }}>
          {projects.length} projects · sorted by idle duration · 15-min cache · Nudge injects a status-check message
        </div>
      </div>
    </div>
  )
}

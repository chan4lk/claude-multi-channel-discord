'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import GlassCard from '@/components/ui/GlassCard'

interface AuditRow {
  id: number
  ts: number
  actor: string
  actor_id: string
  verb: string
  target: string
  payload: string
  ip: string
}

const VERB_COLORS: Record<string, string> = {
  spawn: 'text-cyber-cyan',
  stop: 'text-amber-400',
  kill: 'text-cyber-crimson',
  command: 'text-violet-400',
  'schedule-fire': 'text-emerald-400',
  'circuit-open': 'text-orange-400',
  'circuit-reset': 'text-emerald-400',
  'context-warning': 'text-yellow-400',
}

function VerbBadge({ verb }: { verb: string }) {
  const color = VERB_COLORS[verb] ?? 'text-slate-400'
  return (
    <span className={`font-mono text-[0.65rem] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 ${color}`}>
      {verb}
    </span>
  )
}

function formatTs(ts: number): string {
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="w-2 h-2 rounded-sm bg-cyber-cyan/60 shrink-0" />
      <h2 className="section-label">{label}</h2>
      <div className="flex-1 h-px bg-gradient-to-r from-cyber-cyan/20 to-transparent" />
    </div>
  )
}

export default function AuditLogPage() {
  const router = useRouter()
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(false)
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [cursor, setCursor] = useState<number | undefined>(undefined)

  // Filters
  const [filterVerb, setFilterVerb] = useState('')
  const [filterActorId, setFilterActorId] = useState('')
  const [filterTarget, setFilterTarget] = useState('')
  const [filterSince, setFilterSince] = useState('')
  const [filterUntil, setFilterUntil] = useState('')

  const fetchRows = useCallback(async (cur?: number) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (cur != null) params.set('cursor', String(cur))
      if (filterVerb) params.set('verb', filterVerb)
      if (filterActorId) params.set('actor_id', filterActorId)
      if (filterTarget) params.set('target', filterTarget)
      if (filterSince) params.set('since', String(Math.floor(new Date(filterSince).getTime() / 1000)))
      if (filterUntil) params.set('until', String(Math.floor(new Date(filterUntil).getTime() / 1000)))

      const res = await fetch(`/api/admin/audit?${params}`)
      if (res.status === 401) { router.push('/login'); return }
      if (!res.ok) return
      const data = await res.json() as { rows: AuditRow[]; nextCursor: number | null }
      setRows(cur == null ? data.rows : (prev) => [...prev, ...data.rows])
      setNextCursor(data.nextCursor)
    } finally {
      setLoading(false)
    }
  }, [router, filterVerb, filterActorId, filterTarget, filterSince, filterUntil])

  useEffect(() => {
    setCursor(undefined)
    setRows([])
    fetchRows(undefined)
  }, [fetchRows])

  function handleLoadMore() {
    if (nextCursor == null) return
    setCursor(nextCursor)
    fetchRows(nextCursor)
  }

  function handleExport() {
    const params = new URLSearchParams({ format: 'ndjson', limit: '500' })
    if (filterVerb) params.set('verb', filterVerb)
    if (filterActorId) params.set('actor_id', filterActorId)
    if (filterTarget) params.set('target', filterTarget)
    if (filterSince) params.set('since', String(Math.floor(new Date(filterSince).getTime() / 1000)))
    if (filterUntil) params.set('until', String(Math.floor(new Date(filterUntil).getTime() / 1000)))
    window.open(`/api/admin/audit?${params}`, '_blank')
  }

  return (
    <div className="min-h-dvh bg-cyber-bg px-4 sm:px-6 py-6">
      <header className="mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/')}
            className="text-xs text-slate-500 hover:text-cyber-cyan transition-colors cursor-pointer flex items-center gap-1"
          >
            <span className="text-cyber-cyan/40">←</span> Dashboard
          </button>
          <div className="h-3 w-px bg-cyber-cyan/20" />
          <h1
            className="text-lg font-black tracking-[0.18em] text-cyber-cyan neon-cyan"
            style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}
          >
            AUDIT LOG
          </h1>
          <div className="flex-1" />
          <button
            onClick={handleExport}
            className="cyber-btn text-xs font-mono px-3 py-1.5 rounded uppercase tracking-wider"
          >
            Export NDJSON
          </button>
        </div>
      </header>

      {/* Filters */}
      <GlassCard className="p-4 mb-4">
        <SectionLabel label="Filters" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-[0.6rem] text-slate-500 uppercase tracking-widest font-semibold block mb-1">Verb</label>
            <input
              type="text"
              placeholder="spawn, kill, command…"
              value={filterVerb}
              onChange={(e) => setFilterVerb(e.target.value)}
              className="cyber-input px-2 py-1.5 text-xs w-full"
            />
          </div>
          <div>
            <label className="text-[0.6rem] text-slate-500 uppercase tracking-widest font-semibold block mb-1">Actor ID</label>
            <input
              type="text"
              placeholder="Discord user ID"
              value={filterActorId}
              onChange={(e) => setFilterActorId(e.target.value)}
              className="cyber-input px-2 py-1.5 text-xs w-full"
            />
          </div>
          <div>
            <label className="text-[0.6rem] text-slate-500 uppercase tracking-widest font-semibold block mb-1">Target</label>
            <input
              type="text"
              placeholder="project slug"
              value={filterTarget}
              onChange={(e) => setFilterTarget(e.target.value)}
              className="cyber-input px-2 py-1.5 text-xs w-full"
            />
          </div>
          <div>
            <label className="text-[0.6rem] text-slate-500 uppercase tracking-widest font-semibold block mb-1">Since</label>
            <input
              type="datetime-local"
              value={filterSince}
              onChange={(e) => setFilterSince(e.target.value)}
              className="cyber-input px-2 py-1.5 text-xs w-full"
            />
          </div>
          <div>
            <label className="text-[0.6rem] text-slate-500 uppercase tracking-widest font-semibold block mb-1">Until</label>
            <input
              type="datetime-local"
              value={filterUntil}
              onChange={(e) => setFilterUntil(e.target.value)}
              className="cyber-input px-2 py-1.5 text-xs w-full"
            />
          </div>
        </div>
      </GlassCard>

      {/* Table */}
      <GlassCard className="p-4 overflow-x-auto">
        <SectionLabel label={`Entries${rows.length > 0 ? ` (${rows.length}${nextCursor ? '+' : ''})` : ''}`} />
        {loading && rows.length === 0 ? (
          <div className="text-slate-500 text-sm py-10 text-center font-mono">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-slate-500 text-sm py-10 text-center">No audit entries found.</div>
        ) : (
          <>
            <table className="w-full text-xs border-collapse min-w-[700px]">
              <thead>
                <tr className="text-left border-b border-cyber-cyan/15">
                  <th className="pb-2 pr-4 text-[0.6rem] font-semibold text-cyber-cyan/50 uppercase tracking-widest whitespace-nowrap">Time (UTC)</th>
                  <th className="pb-2 pr-4 text-[0.6rem] font-semibold text-cyber-cyan/50 uppercase tracking-widest">Verb</th>
                  <th className="pb-2 pr-4 text-[0.6rem] font-semibold text-cyber-cyan/50 uppercase tracking-widest">Actor</th>
                  <th className="pb-2 pr-4 text-[0.6rem] font-semibold text-cyber-cyan/50 uppercase tracking-widest">Target</th>
                  <th className="pb-2 text-[0.6rem] font-semibold text-cyber-cyan/50 uppercase tracking-widest">Payload</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-cyber-cyan/5 hover:bg-cyber-cyan/3 transition-colors">
                    <td className="py-2 pr-4 text-slate-500 font-mono whitespace-nowrap">{formatTs(row.ts)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap"><VerbBadge verb={row.verb} /></td>
                    <td className="py-2 pr-4 text-slate-300 font-mono">
                      {row.actor || <span className="text-slate-600 italic">system</span>}
                      {row.actor_id && (
                        <span className="text-slate-600 text-[0.6rem] ml-1">({row.actor_id})</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-slate-400 font-mono">
                      {row.target || <span className="text-slate-600">—</span>}
                    </td>
                    <td className="py-2 text-slate-600 font-mono text-[0.6rem] max-w-xs truncate" title={row.payload}>
                      {row.payload}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {nextCursor != null && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="cyber-btn text-xs font-mono px-4 py-1.5 rounded uppercase tracking-wider disabled:opacity-40"
                >
                  {loading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </GlassCard>
    </div>
  )
}

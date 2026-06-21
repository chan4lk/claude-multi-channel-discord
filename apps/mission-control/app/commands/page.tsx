'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

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

interface AuditResponse {
  rows: AuditRow[]
  nextCursor: number | null
}

const COMMAND_VERBS = [
  'list', 'show', 'status', 'create', 'clone', 'set', 'rename',
  'remote', 'pull', 'stop', 'rm', 'help', 'inject', 'broadcast',
  'schedule', 'provider', 'usage', 'ps', 'top',
]

function formatTs(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function parsePayload(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown> } catch { return {} }
}

function CommandRow({ row, onRerun }: { row: AuditRow; onRerun: (slug: string, cmd: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [rerunStatus, setRerunStatus] = useState<'ok' | 'error' | null>(null)
  const payload = parsePayload(row.payload)
  const cmd = typeof payload.command === 'string' ? payload.command : `!project ${row.verb}${row.target ? ` ${row.target}` : ''}`
  const errMsg = typeof payload.error === 'string' ? payload.error : null
  const status = errMsg ? 'error' : 'ok'

  const handleRerun = async () => {
    const masterSlug = 'master'
    setRerunning(true)
    try {
      const res = await fetch('/api/inject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: masterSlug, message: cmd }),
      })
      setRerunStatus(res.ok ? 'ok' : 'error')
    } catch {
      setRerunStatus('error')
    }
    setRerunning(false)
    setTimeout(() => setRerunStatus(null), 3000)
    onRerun(row.target, cmd)
  }

  return (
    <div
      className="border-b"
      style={{ borderColor: '#0e1e35' }}
    >
      <div
        className="flex items-center gap-3 px-4 py-3 hover:bg-white/2 transition-colors cursor-pointer"
        onClick={() => setExpanded((x) => !x)}
      >
        {/* Timestamp */}
        <span className="text-[0.6rem] font-mono text-slate-600 shrink-0 w-36">
          {formatTs(row.ts)}
        </span>

        {/* Operator */}
        <span className="text-[0.65rem] font-mono shrink-0 w-28 truncate" style={{ color: '#A78BFA' }}>
          {row.actor || row.actor_id || '—'}
        </span>

        {/* Verb */}
        <span
          className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded shrink-0"
          style={{ color: '#38BDF8', background: '#38BDF810', border: '1px solid #38BDF820' }}
        >
          {row.verb}
        </span>

        {/* Target */}
        <span className="text-[0.65rem] font-mono text-slate-400 truncate flex-1">
          {row.target || '—'}
        </span>

        {/* Status */}
        <span
          className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded shrink-0"
          style={
            status === 'error'
              ? { color: '#EF4444', background: '#EF444418' }
              : { color: '#4ADE80', background: '#4ADE8018' }
          }
        >
          {status}
        </span>

        {/* Expand toggle */}
        <span className="text-[0.55rem] font-mono text-slate-700 shrink-0 w-4">
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {expanded && (
        <div
          className="px-4 pb-3 ml-36"
          style={{ borderTop: '1px solid #0e1e35' }}
        >
          <div className="mt-2 flex flex-col gap-2">
            <div>
              <span className="text-[0.55rem] font-mono text-slate-600 uppercase tracking-widest">Command</span>
              <pre
                className="mt-1 text-[0.65rem] font-mono text-slate-300 whitespace-pre-wrap break-all p-2 rounded"
                style={{ background: '#040a14', border: '1px solid #1e3a5f', maxWidth: 600 }}
              >
                {cmd}
              </pre>
            </div>

            {errMsg && (
              <div>
                <span className="text-[0.55rem] font-mono text-slate-600 uppercase tracking-widest">Error</span>
                <div
                  className="mt-1 text-[0.65rem] font-mono p-2 rounded"
                  style={{ color: '#EF4444', background: '#EF444410', border: '1px solid #EF444425' }}
                >
                  {errMsg}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={(e) => { e.stopPropagation(); handleRerun() }}
                disabled={rerunning}
                className="text-[0.6rem] font-mono px-3 py-1 rounded transition-colors disabled:opacity-40"
                style={{ color: '#00F5FF', background: '#00F5FF10', border: '1px solid #00F5FF30' }}
              >
                {rerunning ? 'Sending…' : '↺ Re-run'}
              </button>
              {rerunStatus === 'ok' && (
                <span className="text-[0.6rem] font-mono" style={{ color: '#4ADE80' }}>Sent ✓</span>
              )}
              {rerunStatus === 'error' && (
                <span className="text-[0.6rem] font-mono" style={{ color: '#EF4444' }}>Failed ✗</span>
              )}
              <span className="text-[0.55rem] font-mono text-slate-700">
                Re-run sends to master channel
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CommandsPage() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [verbFilter, setVerbFilter] = useState<string[]>([])
  const [actorFilter, setActorFilter] = useState('')
  const [showVerbMenu, setShowVerbMenu] = useState(false)

  const buildUrl = useCallback((cur?: number | null) => {
    const params = new URLSearchParams()
    params.set('verb', 'command_executed')
    params.set('limit', '50')
    if (cur) params.set('cursor', String(cur))
    return `/api/admin/audit?${params}`
  }, [])

  const load = useCallback(async (cur?: number | null) => {
    const res = await fetch(buildUrl(cur))
    if (!res.ok) return null
    return await res.json() as AuditResponse
  }, [buildUrl])

  useEffect(() => {
    setLoading(true)
    load().then((data) => {
      if (!data) { setLoading(false); return }
      setRows(data.rows)
      setCursor(data.nextCursor)
      setLoading(false)
    })
  }, [load])

  const loadMore = async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    const data = await load(cursor)
    if (data) {
      setRows((prev) => [...prev, ...data.rows])
      setCursor(data.nextCursor)
    }
    setLoadingMore(false)
  }

  const filtered = rows.filter((r) => {
    const payload = parsePayload(r.payload)
    const verb = typeof payload.verb === 'string' ? payload.verb : r.verb
    if (verbFilter.length > 0 && !verbFilter.some((v) => verb.includes(v) || r.verb.includes(v))) return false
    if (actorFilter && !(r.actor + r.actor_id).toLowerCase().includes(actorFilter.toLowerCase())) return false
    return true
  })

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
            ← Dashboard
          </Link>
          <span className="text-slate-700 font-mono">·</span>
          <h1 className="text-lg font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            FLEET COMMANDS
          </h1>
          <span className="text-[0.6rem] font-mono text-slate-600">
            {filtered.length} command{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </header>

      {/* Filters */}
      <div
        className="flex items-center gap-3 px-6 py-3 flex-wrap border-b"
        style={{ borderColor: '#0e1e35', background: '#07101f' }}
      >
        {/* Verb multi-select */}
        <div className="relative">
          <button
            onClick={() => setShowVerbMenu((x) => !x)}
            className="text-[0.6rem] font-mono px-2 py-1 rounded border transition-colors flex items-center gap-1"
            style={{
              color: verbFilter.length > 0 ? '#38BDF8' : '#64748b',
              borderColor: verbFilter.length > 0 ? '#38BDF840' : '#1e3a5f',
              background: verbFilter.length > 0 ? '#38BDF810' : 'transparent',
            }}
          >
            Verb {verbFilter.length > 0 ? `(${verbFilter.length})` : '(all)'}
            <span style={{ fontSize: '0.5rem', opacity: 0.5 }}>{showVerbMenu ? '▲' : '▼'}</span>
          </button>
          {showVerbMenu && (
            <div
              className="absolute top-full left-0 mt-1 z-10 rounded border p-2 shadow-xl"
              style={{ background: '#080f1c', borderColor: '#1e3a5f', minWidth: 160 }}
            >
              <button
                onClick={() => setVerbFilter([])}
                className="block w-full text-left text-[0.6rem] font-mono px-2 py-1 rounded hover:bg-white/5 text-slate-500 mb-1"
              >
                Clear all
              </button>
              {COMMAND_VERBS.map((v) => (
                <label key={v} className="flex items-center gap-2 px-2 py-0.5 rounded hover:bg-white/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={verbFilter.includes(v)}
                    onChange={(e) => {
                      setVerbFilter((prev) =>
                        e.target.checked ? [...prev, v] : prev.filter((x) => x !== v)
                      )
                    }}
                    className="w-3 h-3 accent-sky-400"
                  />
                  <span className="text-[0.6rem] font-mono text-slate-400">{v}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Actor filter */}
        <input
          type="text"
          placeholder="Filter by operator…"
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
          className="text-[0.65rem] font-mono px-2 py-1 rounded border bg-transparent outline-none transition-colors"
          style={{
            borderColor: actorFilter ? '#A78BFA50' : '#1e3a5f',
            color: '#A78BFA',
            minWidth: 160,
          }}
        />
      </div>

      {/* Table header */}
      <div
        className="flex items-center gap-3 px-4 py-2 border-b"
        style={{ borderColor: '#0e1e35', background: '#040c18' }}
      >
        <span className="text-[0.55rem] font-mono uppercase tracking-widest text-slate-700 w-36 shrink-0">Timestamp</span>
        <span className="text-[0.55rem] font-mono uppercase tracking-widest text-slate-700 w-28 shrink-0">Operator</span>
        <span className="text-[0.55rem] font-mono uppercase tracking-widest text-slate-700 shrink-0 w-16">Verb</span>
        <span className="text-[0.55rem] font-mono uppercase tracking-widest text-slate-700 flex-1">Target</span>
        <span className="text-[0.55rem] font-mono uppercase tracking-widest text-slate-700 shrink-0">Status</span>
        <span className="w-4 shrink-0" />
      </div>

      <main className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-slate-600 font-mono text-xs animate-pulse">
            Loading commands…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-slate-700">
            <div className="text-4xl opacity-20">≡</div>
            <span className="text-xs font-mono">No commands found</span>
          </div>
        ) : (
          <>
            {filtered.map((row) => (
              <CommandRow
                key={row.id}
                row={row}
                onRerun={() => {}}
              />
            ))}
            {cursor && (
              <div className="flex justify-center py-4">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="text-xs font-mono px-4 py-2 rounded transition-colors disabled:opacity-40"
                  style={{ color: '#00F5FF', background: '#00F5FF10', border: '1px solid #00F5FF30' }}
                >
                  {loadingMore ? 'Loading…' : 'Load more (50)'}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

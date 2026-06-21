'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'

interface TickerRow {
  id: string
  ts: string
  slug: string
  toolName: string
  phase: 'started' | 'done' | 'error'
  durationMs?: number
}

const TOOL_COLORS: Record<string, string> = {
  Bash: '#FB923C',
  Read: '#60A5FA',
  Edit: '#60A5FA',
  Write: '#60A5FA',
  Agent: '#A78BFA',
  Task: '#A78BFA',
  WebFetch: '#2DD4BF',
  WebSearch: '#2DD4BF',
  Glob: '#818CF8',
  Grep: '#818CF8',
}

const MCP_PREFIX_RE = /^mcp__|^mcp:/i

function toolColor(name: string): string {
  if (MCP_PREFIX_RE.test(name)) return '#2DD4BF'
  return TOOL_COLORS[name] ?? '#94A3B8'
}

function toolCategory(name: string): string {
  if (MCP_PREFIX_RE.test(name)) return 'MCP'
  if (['Read', 'Edit', 'Write', 'Glob', 'Grep'].includes(name)) return 'File'
  if (['Agent', 'Task'].includes(name)) return 'Agent'
  if (name === 'Bash') return 'Bash'
  if (['WebFetch', 'WebSearch'].includes(name)) return 'Web'
  return 'Other'
}

const CATEGORIES = ['All', 'Bash', 'File', 'Agent', 'Web', 'MCP', 'Other'] as const
type Category = (typeof CATEGORIES)[number]

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toTimeString().slice(0, 8)
}

function fmtDur(ms?: number): string {
  if (ms === undefined) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

const MAX_ROWS = 500

export default function TickerPage() {
  const [rows, setRows] = useState<TickerRow[]>([])
  const [slugFilter, setSlugFilter] = useState('')
  const [categories, setCategories] = useState<Set<Category>>(new Set(['All']))
  const [paused, setPaused] = useState(false)
  const [connected, setConnected] = useState(false)
  const pendingRef = useRef<TickerRow[]>([])
  const pausedRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  pausedRef.current = paused

  const addRows = useCallback((newRows: TickerRow[]) => {
    setRows((prev) => {
      const combined = [...prev, ...newRows]
      return combined.length > MAX_ROWS ? combined.slice(combined.length - MAX_ROWS) : combined
    })
  }, [])

  useEffect(() => {
    const es = new EventSource('/api/events/stream')
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    es.onmessage = (e) => {
      let event: Record<string, unknown>
      try { event = JSON.parse(e.data) } catch { return }
      if (event.type !== 'tool_progress') return

      const payload = (event.payload ?? {}) as Record<string, unknown>
      const phase = payload.phase as string
      if (phase !== 'start' && phase !== 'done') return

      const row: TickerRow = {
        id: `${event.ts}-${payload.toolId}`,
        ts: (event.ts as string) ?? new Date().toISOString(),
        slug: (payload.slug as string) ?? (event.slug as string) ?? '?',
        toolName: (payload.toolName as string) ?? '?',
        phase: phase === 'start' ? 'started' : (payload.isError ? 'error' : 'done'),
        durationMs: phase === 'done' ? (payload.durationMs as number) : undefined,
      }

      if (pausedRef.current) {
        pendingRef.current.push(row)
      } else {
        addRows([row])
      }
    }

    return () => es.close()
  }, [addRows])

  // Flush pending on unpause
  useEffect(() => {
    if (!paused && pendingRef.current.length > 0) {
      addRows(pendingRef.current)
      pendingRef.current = []
    }
  }, [paused, addRows])

  // Auto-scroll
  useEffect(() => {
    if (autoScrollRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [rows])

  function toggleCategory(cat: Category) {
    setCategories((prev) => {
      const next = new Set(prev)
      if (cat === 'All') return new Set(['All'])
      next.delete('All')
      if (next.has(cat)) {
        next.delete(cat)
        if (next.size === 0) return new Set(['All'])
      } else {
        next.add(cat)
      }
      return next
    })
  }

  const filtered = rows.filter((r) => {
    if (slugFilter && !r.slug.toLowerCase().includes(slugFilter.toLowerCase())) return false
    if (!categories.has('All') && !categories.has(toolCategory(r.toolName) as Category)) return false
    return true
  })

  return (
    <div className="flex flex-col h-dvh">
      {/* Header */}
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-4 py-3 flex-shrink-0">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <h1
              className="text-base font-black tracking-[0.18em] text-cyber-cyan neon-cyan"
              style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}
            >
              TOOL CALL TICKER
            </h1>
            <Link href="/" className="text-[0.55rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
              ← Dashboard
            </Link>
          </div>
          <div className="flex items-center gap-1.5 ml-auto flex-wrap">
            {/* Connection status */}
            <span
              className="text-[0.55rem] font-mono px-2 py-0.5 rounded-full border"
              style={{
                color: connected ? '#4ADE80' : '#F87171',
                borderColor: connected ? '#4ADE8040' : '#F8717140',
                background: connected ? '#4ADE8010' : '#F8717110',
              }}
            >
              {connected ? '● LIVE' : '○ DISCONNECTED'}
            </span>
            {/* Pause */}
            <button
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
              className="text-[0.6rem] font-mono px-2 py-1 rounded border border-white/10 text-slate-400 hover:text-amber-400 hover:border-amber-400/30 transition-colors select-none"
            >
              {paused ? `⏸ PAUSED (+${pendingRef.current.length})` : '⏸ Hover to pause'}
            </button>
            {/* Clear */}
            <button
              onClick={() => setRows([])}
              className="text-[0.6rem] font-mono px-2 py-1 rounded border border-white/10 text-slate-400 hover:text-red-400 hover:border-red-400/30 transition-colors"
            >
              ✕ Clear
            </button>
          </div>
        </div>
        {/* Filters */}
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <input
            type="text"
            placeholder="Filter slug…"
            value={slugFilter}
            onChange={(e) => setSlugFilter(e.target.value)}
            className="text-[0.65rem] font-mono bg-white/5 border border-white/10 rounded px-2 py-1 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyber-cyan/40 w-36"
          />
          <div className="flex items-center gap-1 flex-wrap">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded border transition-colors"
                style={{
                  color: categories.has(cat) ? '#22D3EE' : '#475569',
                  borderColor: categories.has(cat) ? '#22D3EE40' : '#ffffff10',
                  background: categories.has(cat) ? '#22D3EE0d' : 'transparent',
                }}
              >
                {cat}
              </button>
            ))}
          </div>
          <span className="text-[0.55rem] font-mono text-slate-600 ml-auto">
            {filtered.length} / {rows.length} events
          </span>
        </div>
      </header>

      {/* Feed */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto font-mono"
        style={{ background: '#060d18' }}
        onMouseEnter={() => { autoScrollRef.current = false }}
        onMouseLeave={() => { autoScrollRef.current = true }}
      >
        {filtered.length === 0 && (
          <div className="text-slate-600 text-[0.7rem] text-center py-16">
            {connected ? 'Waiting for tool calls…' : 'Connecting to event stream…'}
          </div>
        )}
        <table className="w-full text-[0.65rem] border-collapse">
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.id}
                className="border-b border-white/3 hover:bg-white/2"
              >
                <td className="px-3 py-1 text-slate-600 w-[6rem] whitespace-nowrap">{fmtTime(row.ts)}</td>
                <td className="px-3 py-1 w-[8rem] whitespace-nowrap" style={{ color: '#22D3EE' }}>
                  {row.slug}
                </td>
                <td className="px-3 py-1 w-[12rem] whitespace-nowrap" style={{ color: toolColor(row.toolName) }}>
                  {row.toolName}
                </td>
                <td className="px-3 py-1 w-[5rem] whitespace-nowrap">
                  <span
                    className="px-1.5 py-0.5 rounded text-[0.55rem]"
                    style={{
                      color: row.phase === 'done' ? '#4ADE80' : row.phase === 'error' ? '#F87171' : '#FCD34D',
                      background:
                        row.phase === 'done'
                          ? '#4ADE8010'
                          : row.phase === 'error'
                          ? '#F8717110'
                          : '#FCD34D10',
                    }}
                  >
                    {row.phase}
                  </span>
                </td>
                <td className="px-3 py-1 text-slate-500 text-right pr-4 w-[5rem]">
                  {fmtDur(row.durationMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

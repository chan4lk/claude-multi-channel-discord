'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { ConversationResponse, ConversationTurn, ToolCallBlock } from '@/app/api/projects/[slug]/conversation/route'

function ToolChip({ tool, expanded, onToggle }: { tool: ToolCallBlock; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="rounded border border-white/8 overflow-hidden" style={{ background: 'rgba(168,85,247,0.06)' }}>
      <button
        className="w-full flex items-center gap-2 px-2 py-1 text-left"
        onClick={onToggle}
      >
        <span className="text-[0.5rem] font-mono text-purple-400 uppercase tracking-wider">⬡</span>
        <span className="text-[0.6rem] font-mono text-purple-300 font-bold">{tool.name}</span>
        <span className="text-[0.55rem] font-mono text-slate-500 flex-1 truncate">{tool.input.slice(0, 60)}</span>
        <span className="text-[0.5rem] font-mono text-slate-600">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <pre className="text-[0.55rem] font-mono text-slate-400 px-2 pb-1.5 whitespace-pre-wrap break-all leading-relaxed border-t border-white/5">
          {tool.input}
        </pre>
      )}
    </div>
  )
}

function TurnBubble({ turn, search }: { turn: ConversationTurn; search: string }) {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const isHuman = turn.role === 'human'

  function toggleTool(id: string) {
    setExpandedTools((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function highlight(text: string): React.ReactNode {
    if (!search) return text
    const parts = text.split(new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return parts.map((p, i) =>
      p.toLowerCase() === search.toLowerCase()
        ? <mark key={i} style={{ background: 'rgba(0,245,255,0.25)', color: '#00F5FF', borderRadius: 2 }}>{p}</mark>
        : p
    )
  }

  const hasText = turn.text.trim().length > 0
  const hasTools = (turn.toolCalls?.length ?? 0) > 0

  return (
    <div className={`flex ${isHuman ? 'justify-start' : 'justify-end'} mb-2`}>
      <div style={{ maxWidth: '72%' }}>
        <div className="flex items-center gap-1.5 mb-0.5" style={{ justifyContent: isHuman ? 'flex-start' : 'flex-end' }}>
          <span className="text-[0.5rem] font-mono uppercase tracking-wider" style={{ color: isHuman ? '#00F5FF' : '#94a3b8' }}>
            {isHuman ? 'operator' : 'claude'}
          </span>
          {turn.timestamp && (
            <span className="text-[0.45rem] font-mono text-slate-700">
              {new Date(turn.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>

        <div
          className="rounded-lg px-3 py-2"
          style={{
            background: isHuman ? 'rgba(0,245,255,0.08)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${isHuman ? 'rgba(0,245,255,0.15)' : 'rgba(255,255,255,0.06)'}`,
          }}
        >
          {hasText && (
            <p className="text-[0.65rem] font-mono text-slate-300 leading-relaxed whitespace-pre-wrap break-words">
              {highlight(turn.text)}
            </p>
          )}
          {hasTools && (
            <div className="flex flex-col gap-1 mt-1.5">
              {turn.toolCalls!.map((t) => (
                <ToolChip key={t.id || t.name} tool={t} expanded={expandedTools.has(t.id || t.name)} onToggle={() => toggleTool(t.id || t.name)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DateSeparator({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-3 my-3">
      <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
      <span className="text-[0.5rem] font-mono text-slate-700 uppercase tracking-wider">{date}</span>
      <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
    </div>
  )
}

export default function ConversationPage() {
  const params = useParams()
  const slug = typeof params.slug === 'string' ? params.slug : Array.isArray(params.slug) ? params.slug[0] : ''

  const [turns, setTurns] = useState<ConversationTurn[]>([])
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (before?: string) => {
    if (!slug) return
    const params = new URLSearchParams({ limit: '40' })
    if (before) params.set('before', before)
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(slug)}/conversation?${params}`)
      const d = await r.json() as ConversationResponse
      setTurns((prev) => before ? [...prev, ...d.turns] : d.turns)
      setTotal(d.total)
      setCursor(d.cursor)
    } catch {}
  }, [slug])

  useEffect(() => {
    setLoading(true)
    load().then(() => setLoading(false))
  }, [load])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  async function loadMore() {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    await load(cursor)
    setLoadingMore(false)
  }

  // Filter + group by date
  const filtered = debouncedSearch
    ? turns.filter((t) => t.text.toLowerCase().includes(debouncedSearch.toLowerCase())
        || t.toolCalls?.some((tc) => tc.name.toLowerCase().includes(debouncedSearch.toLowerCase())))
    : turns

  // Rendered newest-first (turns array is already newest-first from API)
  // Insert date separators between groups
  const grouped: Array<ConversationTurn | { type: 'separator'; date: string }> = []
  let lastDate = ''
  for (const turn of filtered) {
    if (turn.date && turn.date !== lastDate) {
      grouped.push({ type: 'separator', date: turn.date })
      lastDate = turn.date
    }
    grouped.push(turn)
  }

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading conversation…</div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-4 py-2.5">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href={`/projects/${encodeURIComponent(slug)}`} className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
            ← {slug}
          </Link>
          <span className="text-[0.65rem] font-mono font-bold text-cyber-cyan uppercase tracking-widest">Conversation</span>
          <span className="text-[0.55rem] font-mono text-slate-600 border border-slate-700 px-1.5 py-0.5 rounded">
            {total} turns
          </span>
          <div className="flex-1" />
          <input
            className="text-[0.6rem] font-mono bg-transparent border border-slate-700 rounded px-2 py-1 text-slate-300 placeholder-slate-700 outline-none focus:border-cyber-cyan/40 w-40"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </header>

      <main className="flex-1 p-4 max-w-4xl mx-auto w-full">
        {turns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="text-4xl opacity-15">◎</div>
            <p className="text-xs font-mono text-slate-500">No conversation found for <span className="text-cyber-cyan">{slug}</span></p>
            <p className="text-[0.6rem] font-mono text-slate-700">Transcript may be empty or project not yet active.</p>
          </div>
        ) : (
          <>
            {cursor && (
              <div className="flex justify-center mb-4">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-3 py-1.5 rounded disabled:opacity-40"
                >
                  {loadingMore ? '◌ Loading…' : `↑ Load older (${total - turns.length} more)`}
                </button>
              </div>
            )}

            {debouncedSearch && filtered.length === 0 && (
              <p className="text-[0.6rem] font-mono text-slate-600 text-center py-8">No messages match "{debouncedSearch}"</p>
            )}

            {grouped.map((item, i) => {
              if ('type' in item && item.type === 'separator') {
                return <DateSeparator key={`sep-${item.date}-${i}`} date={item.date} />
              }
              const turn = item as ConversationTurn
              return <TurnBubble key={turn.id} turn={turn} search={debouncedSearch} />
            })}

            <p className="text-[0.5rem] font-mono text-slate-700 text-center mt-4">
              Showing {turns.length} of {total} turns · Newest first
            </p>
          </>
        )}
      </main>
    </div>
  )
}

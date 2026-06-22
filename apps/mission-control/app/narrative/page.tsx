'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import type { NarrativeTurn, NarrativeResponse } from '../api/narrative/route'

const ROLE_COLORS: Record<string, string> = {
  user: '#22D3EE',
  assistant: '#A855F7',
}

const PLAYBACK_SPEEDS = [1, 5, 10] as const

function TurnCard({
  turn,
  active,
  onSelect,
}: {
  turn: NarrativeTurn
  active: boolean
  onSelect: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [active])

  const color = ROLE_COLORS[turn.role] ?? '#64748B'
  return (
    <div
      ref={ref}
      onClick={onSelect}
      className="flex gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors"
      style={{
        background: active ? '#0d1b2e' : 'transparent',
        borderLeft: `2px solid ${active ? color : 'transparent'}`,
      }}
    >
      <div className="flex-shrink-0 w-16 text-[0.55rem] text-slate-600 pt-0.5">
        {new Date(turn.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className="flex-shrink-0">
        <span
          className="text-[0.55rem] font-bold px-1.5 py-0.5 rounded"
          style={{ color, background: `${color}15` }}
        >
          {turn.slug}
        </span>
      </div>
      <div className="flex-shrink-0 w-14">
        <span className="text-[0.55rem]" style={{ color }}>
          {turn.role}
        </span>
      </div>
      <div className="flex-1 text-[0.7rem] text-slate-400 leading-relaxed line-clamp-2 min-w-0">
        {turn.text}
      </div>
      <Link
        href={`/turns?slug=${turn.slug}&session=${turn.sessionFile}&turn=${turn.turnIndex}`}
        onClick={(e) => e.stopPropagation()}
        className="flex-shrink-0 text-[0.6rem] text-slate-700 hover:text-cyber-cyan transition-colors pt-0.5"
        title="Open in Turn Viewer"
      >
        →
      </Link>
    </div>
  )
}

function exportMarkdown(turns: NarrativeTurn[]): void {
  const lines = turns.map(
    (t) => `### [${t.slug}] ${t.role} — ${t.ts}\n\n${t.text}\n`
  )
  const blob = new Blob([lines.join('\n---\n\n')], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'narrative-export.md'
  a.click()
  URL.revokeObjectURL(url)
}

function NarrativeInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [turns, setTurns] = useState<NarrativeTurn[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  // Filters
  const [role, setRole] = useState(searchParams.get('role') ?? '')
  const [keyword, setKeyword] = useState(searchParams.get('q') ?? '')
  const [since, setSince] = useState(searchParams.get('since') ?? '')
  const [until, setUntil] = useState(searchParams.get('until') ?? '')

  // Playback
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<typeof PLAYBACK_SPEEDS[number]>(1)
  const [activeIdx, setActiveIdx] = useState(-1)
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const buildUrl = useCallback(
    (cur?: string) => {
      const p = new URLSearchParams()
      if (role) p.set('role', role)
      if (keyword) p.set('q', keyword)
      if (since) p.set('since', since)
      if (until) p.set('until', until)
      if (cur) p.set('cursor', cur)
      return `/api/narrative?${p.toString()}`
    },
    [role, keyword, since, until]
  )

  async function load(replace = true) {
    setLoading(true)
    try {
      const r = await fetch(buildUrl())
      if (!r.ok) return
      const data = await r.json() as NarrativeResponse
      if (replace) {
        setTurns(data.turns)
      } else {
        setTurns((prev) => [...prev, ...data.turns])
      }
      setTotal(data.total)
      setCursor(data.nextCursor)
      setHasMore(data.nextCursor !== null)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(true) }, [role, keyword, since, until]) // eslint-disable-line react-hooks/exhaustive-deps

  // Playback timer
  useEffect(() => {
    if (playing) {
      playRef.current = setInterval(() => {
        setActiveIdx((i) => {
          const next = i + 1
          if (next >= turns.length) {
            setPlaying(false)
            return i
          }
          return next
        })
      }, 1000 / speed)
    } else {
      if (playRef.current) clearInterval(playRef.current)
    }
    return () => { if (playRef.current) clearInterval(playRef.current) }
  }, [playing, speed, turns.length])

  // Keyboard J/K navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (document.activeElement?.tagName === 'INPUT') return
      if (e.key === 'j' || e.key === 'J') setActiveIdx((i) => Math.min(i + 1, turns.length - 1))
      if (e.key === 'k' || e.key === 'K') setActiveIdx((i) => Math.max(i - 1, 0))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [turns.length])

  const handleLoadMore = async () => {
    if (!cursor) return
    setLoading(true)
    try {
      const r = await fetch(buildUrl(cursor))
      if (!r.ok) return
      const data = await r.json() as NarrativeResponse
      setTurns((prev) => [...prev, ...data.turns])
      setCursor(data.nextCursor)
      setHasMore(data.nextCursor !== null)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#030712] text-slate-300 font-mono flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#030712] border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/" className="text-slate-600 hover:text-cyber-cyan text-sm">←</Link>
          <h1 className="text-base font-bold tracking-widest text-cyber-cyan uppercase">Narrative Timeline</h1>
          <span className="ml-auto text-[0.6rem] text-slate-600">{total.toLocaleString()} turns</span>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="bg-[#0d1b2e] border border-white/10 text-slate-400 text-[0.65rem] rounded px-2 py-1"
          >
            <option value="">All roles</option>
            <option value="user">User</option>
            <option value="assistant">Assistant</option>
          </select>
          <input
            value={since}
            onChange={(e) => setSince(e.target.value)}
            type="date"
            className="bg-[#0d1b2e] border border-white/10 text-slate-400 text-[0.65rem] rounded px-2 py-1"
            placeholder="From"
          />
          <input
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            type="date"
            className="bg-[#0d1b2e] border border-white/10 text-slate-400 text-[0.65rem] rounded px-2 py-1"
            placeholder="To"
          />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="bg-[#0d1b2e] border border-white/10 text-slate-400 text-[0.65rem] rounded px-2 py-1 flex-1 min-w-32"
            placeholder="Keyword search…"
          />

          {/* Playback controls */}
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => { setPlaying((p) => !p); if (activeIdx < 0) setActiveIdx(0) }}
              className="text-[0.6rem] px-2 py-1 rounded border border-white/10 hover:border-cyber-cyan hover:text-cyber-cyan transition-colors"
            >
              {playing ? '⏸ Pause' : '▶ Play'}
            </button>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value) as typeof PLAYBACK_SPEEDS[number])}
              className="bg-[#0d1b2e] border border-white/10 text-slate-400 text-[0.6rem] rounded px-1 py-1"
            >
              {PLAYBACK_SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
            <button
              onClick={() => exportMarkdown(turns)}
              className="text-[0.6rem] px-2 py-1 rounded border border-white/10 hover:border-amber-400 hover:text-amber-400 transition-colors"
            >
              ↓ MD
            </button>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {loading && turns.length === 0 && (
          <div className="text-slate-600 text-sm py-8 animate-pulse">Loading narrative…</div>
        )}

        {turns.map((turn, i) => (
          <TurnCard
            key={turn.id}
            turn={turn}
            active={i === activeIdx}
            onSelect={() => setActiveIdx(i)}
          />
        ))}

        {hasMore && (
          <div className="py-4 text-center">
            <button
              onClick={handleLoadMore}
              disabled={loading}
              className="text-[0.65rem] px-4 py-2 rounded border border-white/10 hover:border-cyber-cyan hover:text-cyber-cyan transition-colors disabled:opacity-40"
            >
              {loading ? 'Loading…' : `Load more (${total - turns.length} remaining)`}
            </button>
          </div>
        )}

        {!loading && turns.length === 0 && (
          <div className="text-slate-600 text-sm py-8">No turns match filters.</div>
        )}
      </div>

      {/* Keyboard hint */}
      <div className="px-4 py-2 border-t border-white/5 text-[0.5rem] text-slate-700 flex gap-3">
        <span><kbd className="px-1 border border-white/10 rounded">J</kbd>/<kbd className="px-1 border border-white/10 rounded">K</kbd> step turns</span>
        <span><kbd className="px-1 border border-white/10 rounded">▶</kbd> playback</span>
        <span><kbd className="px-1 border border-white/10 rounded">→</kbd> open turn viewer</span>
      </div>
    </div>
  )
}

export default function NarrativePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#030712] text-slate-600 p-4 font-mono">Loading…</div>}>
      <NarrativeInner />
    </Suspense>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import SubPageHeader from '../../components/SubPageHeader'
import type { FleetResponse } from '../api/fleet/route'
import type { ReplayResponse, ReplayTurn, ReplayToolCall } from '../api/replay/[slug]/route'

// ─── tool color ───────────────────────────────────────────────────────────────
function toolColor(name: string): string {
  const n = name.toLowerCase()
  if (n === 'bash') return '#F97316'
  if (n === 'read') return '#3B82F6'
  if (n === 'write' || n === 'edit') return '#06B6D4'
  if (n.startsWith('agent') || n === 'task') return '#A78BFA'
  if (n.startsWith('mcp__')) return '#22D3EE'
  return '#64748B'
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function fmtTime(epoch: number): string {
  if (!epoch) return '—'
  return new Date(epoch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ─── tool call row ────────────────────────────────────────────────────────────
function ToolRow({ tc, idx }: { tc: ReplayToolCall; idx: number }) {
  const [open, setOpen] = useState(false)
  const color = toolColor(tc.name)
  const isErr = tc.status === 'error'
  return (
    <div
      className="rounded border text-[0.6rem] font-mono cursor-pointer select-none"
      style={{
        borderColor: isErr ? '#EF444440' : `${color}30`,
        background: isErr ? '#EF444408' : `${color}08`,
      }}
      onClick={() => setOpen((o) => !o)}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: isErr ? '#EF4444' : color }} />
        <span style={{ color: isErr ? '#EF4444' : color }} className="font-bold truncate">{tc.name}</span>
        <span style={{ color: '#334155' }} className="ml-auto shrink-0">{fmtMs(tc.durationMs)}</span>
        <span style={{ color: '#334155' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="border-t px-2 py-1.5 space-y-1" style={{ borderColor: `${color}20` }}>
          <div>
            <div style={{ color: '#475569' }} className="uppercase tracking-wider text-[0.5rem] mb-0.5">input</div>
            <pre style={{ color: '#94A3B8', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }} className="text-[0.6rem]">
              {tc.input || '—'}
            </pre>
          </div>
          <div>
            <div style={{ color: '#475569' }} className="uppercase tracking-wider text-[0.5rem] mb-0.5">output</div>
            <pre style={{ color: isErr ? '#EF4444' : '#4ADE80', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }} className="text-[0.6rem]">
              {tc.output || '—'}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── diff strip ───────────────────────────────────────────────────────────────
function DiffStrip({ diff }: { diff: string }) {
  if (!diff || diff === '(no text change)') {
    return (
      <div className="text-[0.6rem] font-mono px-2 py-1.5 rounded" style={{ color: '#334155', background: '#0d1525' }}>
        (no text change from previous turn)
      </div>
    )
  }
  const lines = diff.split('\n')
  return (
    <div className="rounded overflow-auto max-h-40 text-[0.6rem] font-mono" style={{ background: '#060d18', border: '1px solid #1e3a5f' }}>
      {lines.map((line, i) => {
        const added = line.startsWith('+ ')
        const removed = line.startsWith('- ')
        return (
          <div
            key={i}
            className="px-2 py-px"
            style={{
              background: added ? '#4ADE8010' : removed ? '#EF444410' : 'transparent',
              color: added ? '#4ADE80' : removed ? '#EF4444' : '#475569',
            }}
          >
            {line || ' '}
          </div>
        )
      })}
    </div>
  )
}

// ─── main inner ───────────────────────────────────────────────────────────────
function ReplayInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const preselect = searchParams.get('project') ?? ''

  const [slugs, setSlugs] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('')
  const [data, setData] = useState<ReplayResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [turnIdx, setTurnIdx] = useState(0)
  const [autoplay, setAutoplay] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scrubRef = useRef<HTMLInputElement>(null)

  // load slugs
  useEffect(() => {
    fetch('/api/fleet')
      .then((r) => r.json())
      .then((d: FleetResponse) => {
        const ss = d.projects.map((p) => p.slug).sort()
        setSlugs(ss)
        const init = preselect && ss.includes(preselect) ? preselect : (ss[0] ?? '')
        setSelected(init)
      })
      .catch(() => {})
  }, [])

  const loadData = useCallback((slug: string) => {
    if (!slug) return
    setLoading(true)
    setTurnIdx(0)
    setAutoplay(false)
    fetch(`/api/replay/${encodeURIComponent(slug)}?turns=50`)
      .then((r) => r.json())
      .then((d: ReplayResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { if (selected) loadData(selected) }, [selected, loadData])

  const turns = data?.turns ?? []
  const total = turns.length
  const turn: ReplayTurn | undefined = turns[turnIdx]

  // clamp turnIdx
  useEffect(() => { setTurnIdx((i) => Math.min(i, Math.max(0, total - 1))) }, [total])

  // autoplay
  useEffect(() => {
    if (autoplay && total > 0) {
      autoRef.current = setInterval(() => {
        setTurnIdx((i) => {
          if (i >= total - 1) { setAutoplay(false); return i }
          return i + 1
        })
      }, 3000)
    }
    return () => { if (autoRef.current) clearInterval(autoRef.current) }
  }, [autoplay, total])

  // keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setTurnIdx((i) => Math.min(i + 1, total - 1))
        setAutoplay(false)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setTurnIdx((i) => Math.max(i - 1, 0))
        setAutoplay(false)
      } else if (e.key === 'Escape') {
        router.back()
      } else if (e.key === ' ') {
        e.preventDefault()
        setAutoplay((a) => !a)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [total, router])

  const prev = () => { setTurnIdx((i) => Math.max(i - 1, 0)); setAutoplay(false) }
  const next = () => { setTurnIdx((i) => Math.min(i + 1, total - 1)); setAutoplay(false) }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#060d18', color: '#CBD5E1' }}>
      <SubPageHeader title="Session Replay">
        {/* project selector */}
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="text-xs font-mono rounded px-2 py-1"
          style={{ background: '#0d1525', color: '#94A3B8', border: '1px solid #1e3a5f' }}
        >
          {slugs.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button
          onClick={() => loadData(selected)}
          disabled={loading}
          className="text-[0.6rem] font-mono px-2 py-1 rounded border transition-colors"
          style={{ borderColor: '#1e3a5f', color: '#64748B', background: loading ? '#0d1525' : 'transparent' }}
        >
          {loading ? '...' : '↺'}
        </button>
        <button
          onClick={() => setShowDiff((d) => !d)}
          className="text-[0.6rem] font-mono px-2 py-1 rounded border transition-colors"
          style={{
            borderColor: showDiff ? '#22D3EE40' : '#1e3a5f',
            color: showDiff ? '#22D3EE' : '#64748B',
            background: 'transparent',
          }}
        >
          Δ diff
        </button>
      </SubPageHeader>

      {/* empty / loading state */}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-xs font-mono animate-pulse" style={{ color: '#22D3EE' }}>Loading replay…</div>
        </div>
      )}

      {!loading && total === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="text-4xl" style={{ color: '#1e3a5f' }}>⏮</div>
          <div className="text-sm font-mono" style={{ color: '#334155' }}>
            No transcript turns for <span style={{ color: '#22D3EE' }}>{selected || '—'}</span>
          </div>
          <div className="text-xs font-mono" style={{ color: '#1e3a5f' }}>
            Select a project with conversation history
          </div>
        </div>
      )}

      {!loading && total > 0 && turn && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* turn content */}
          <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-4">
            {/* user bubble */}
            {turn.userText && (
              <div
                className="rounded p-3 text-xs font-mono leading-relaxed"
                style={{
                  background: '#0d1525',
                  border: '1px solid #1e3a5f',
                  color: '#64748B',
                  borderLeft: '2px solid #1e3a5f',
                }}
              >
                <div className="text-[0.5rem] uppercase tracking-wider mb-1" style={{ color: '#334155' }}>
                  user · T{turnIdx + 1} · {fmtTime(turn.startEpoch)}
                </div>
                <div style={{ color: '#94A3B8', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {turn.userText}
                </div>
              </div>
            )}

            {/* assistant text */}
            {turn.assistantText && (
              <div
                className="rounded p-3 text-xs font-mono leading-relaxed"
                style={{
                  background: '#060d18',
                  border: '1px solid #22D3EE20',
                  borderLeft: '2px solid #22D3EE60',
                  color: '#CBD5E1',
                }}
              >
                <div className="text-[0.5rem] uppercase tracking-wider mb-1" style={{ color: '#22D3EE60' }}>
                  assistant · {fmtMs(turn.durationMs)}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {turn.assistantText}
                </div>
              </div>
            )}

            {/* tool calls */}
            {turn.toolCalls.length > 0 && (
              <div className="space-y-1">
                <div className="text-[0.5rem] font-mono uppercase tracking-wider mb-1" style={{ color: '#334155' }}>
                  tool calls ({turn.toolCalls.length})
                </div>
                {turn.toolCalls.map((tc, ci) => (
                  <ToolRow key={`${tc.toolUseId}-${ci}`} tc={tc} idx={ci} />
                ))}
              </div>
            )}

            {/* diff */}
            {showDiff && (
              <div>
                <div className="text-[0.5rem] font-mono uppercase tracking-wider mb-1" style={{ color: '#334155' }}>
                  diff from T{turnIdx} → T{turnIdx + 1}
                </div>
                <DiffStrip diff={turn.diffFromPrev} />
              </div>
            )}
          </div>

          {/* bottom controls */}
          <div
            className="shrink-0 border-t px-4 py-3 space-y-2"
            style={{ borderColor: '#1e3a5f', background: '#060d18' }}
          >
            {/* scrubber */}
            <div className="flex items-center gap-2">
              <span className="text-[0.6rem] font-mono shrink-0" style={{ color: '#334155' }}>T1</span>
              <input
                ref={scrubRef}
                type="range"
                min={0}
                max={Math.max(0, total - 1)}
                value={turnIdx}
                onChange={(e) => { setTurnIdx(parseInt(e.target.value, 10)); setAutoplay(false) }}
                className="flex-1 h-1 rounded appearance-none cursor-pointer"
                style={{ accentColor: '#22D3EE' }}
              />
              <span className="text-[0.6rem] font-mono shrink-0" style={{ color: '#334155' }}>T{total}</span>
            </div>

            {/* navigation row */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={prev}
                  disabled={turnIdx === 0}
                  className="text-xs font-mono px-3 py-1 rounded border transition-all disabled:opacity-30"
                  style={{ borderColor: '#1e3a5f', color: '#94A3B8', background: 'transparent' }}
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setAutoplay((a) => !a)}
                  className="text-xs font-mono px-3 py-1 rounded border transition-all"
                  style={{
                    borderColor: autoplay ? '#22D3EE60' : '#1e3a5f',
                    color: autoplay ? '#22D3EE' : '#94A3B8',
                    background: autoplay ? '#22D3EE10' : 'transparent',
                  }}
                >
                  {autoplay ? '⏸ Pause' : '▶ Play'}
                </button>
                <button
                  onClick={next}
                  disabled={turnIdx >= total - 1}
                  className="text-xs font-mono px-3 py-1 rounded border transition-all disabled:opacity-30"
                  style={{ borderColor: '#1e3a5f', color: '#94A3B8', background: 'transparent' }}
                >
                  Next →
                </button>
              </div>

              {/* turn counter */}
              <div className="text-xs font-mono" style={{ color: '#475569' }}>
                <span style={{ color: '#22D3EE' }}>T{turnIdx + 1}</span>
                <span> / {total}</span>
                {autoplay && (
                  <span className="ml-2 animate-pulse" style={{ color: '#4ADE80' }}>● auto</span>
                )}
              </div>

              <div className="text-[0.55rem] font-mono hidden sm:block" style={{ color: '#1e3a5f' }}>
                ← → keys · Space = play · Esc = back
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ReplayPage() {
  return <Suspense><ReplayInner /></Suspense>
}

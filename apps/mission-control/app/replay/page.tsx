'use client'

import { useCallback, useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import SubPageHeader from '../../components/SubPageHeader'
import type { FleetResponse } from '../api/fleet/route'
import type { ReplayResponse, ReplayTurn, ReplayToolCall } from '../api/replay/[slug]/route'
import type { TurnAnnotationTag, TurnAnnotationRow } from '../api/annotations/route'

const TAG_COLORS: Record<TurnAnnotationTag, string> = {
  note:    '#22D3EE',
  warning: '#F59E0B',
  bug:     '#EF4444',
}
const TAG_ICONS: Record<TurnAnnotationTag, string> = {
  note: '📝', warning: '⚠️', bug: '🐛',
}

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

// ─── cross-turn tool diff ─────────────────────────────────────────────────────
function computeToolDiff(a: ReplayToolCall[], b: ReplayToolCall[]): Array<{ name: string; status: 'added' | 'removed' | 'changed' | 'same'; durationDelta?: number }> {
  const aNames = a.map((t) => t.name)
  const bNames = b.map((t) => t.name)
  const all = [...new Set([...aNames, ...bNames])]
  return all.map((name) => {
    const inA = a.find((t) => t.name === name)
    const inB = b.find((t) => t.name === name)
    if (inA && inB) {
      const changed = inA.input !== inB.input
      return { name, status: changed ? 'changed' : 'same', durationDelta: inB.durationMs - inA.durationMs }
    }
    if (inB) return { name, status: 'added' }
    return { name, status: 'removed' }
  })
}

function CrossTurnDiff({ fromTurn, toTurn, fromIdx, toIdx }: { fromTurn: ReplayTurn; toTurn: ReplayTurn; fromIdx: number; toIdx: number }) {
  const toolDiff = computeToolDiff(fromTurn.toolCalls, toTurn.toolCalls)
  const textDelta = toTurn.assistantText.length - fromTurn.assistantText.length
  const durationDelta = toTurn.durationMs - fromTurn.durationMs

  function copyDiffLink() {
    const url = new URL(window.location.href)
    url.searchParams.set('from', String(fromIdx))
    url.searchParams.set('to', String(toIdx))
    navigator.clipboard.writeText(url.toString()).catch(() => {})
  }

  return (
    <div className="flex flex-col gap-3">
      {/* delta strip */}
      <div className="flex items-center gap-4 px-3 py-2 rounded text-[0.6rem] font-mono flex-wrap" style={{ background: '#0d1525', border: '1px solid #1e3a5f' }}>
        <span style={{ color: '#22D3EE' }}>T{fromIdx + 1} → T{toIdx + 1}</span>
        <span style={{ color: textDelta >= 0 ? '#4ADE80' : '#EF4444' }}>
          Δ text {textDelta >= 0 ? '+' : ''}{textDelta} chars
        </span>
        <span style={{ color: durationDelta <= 0 ? '#4ADE80' : '#F59E0B' }}>
          Δ duration {durationDelta >= 0 ? '+' : ''}{Math.round(durationDelta / 100) / 10}s
        </span>
        <span style={{ color: '#475569' }}>
          {toolDiff.filter((t) => t.status === 'added').length} added ·{' '}
          {toolDiff.filter((t) => t.status === 'removed').length} removed ·{' '}
          {toolDiff.filter((t) => t.status === 'changed').length} changed
        </span>
        <button
          onClick={copyDiffLink}
          className="ml-auto text-[0.5rem] px-2 py-0.5 rounded border transition-colors"
          style={{ borderColor: '#1e3a5f', color: '#475569' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#22D3EE' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#475569' }}
        >
          ⎘ Copy diff link
        </button>
      </div>

      {/* tool diff */}
      {toolDiff.length > 0 && (
        <div>
          <div className="text-[0.5rem] font-mono uppercase tracking-wider mb-1.5" style={{ color: '#334155' }}>Tool call diff</div>
          <div className="flex flex-col gap-1">
            {toolDiff.map((t, i) => {
              const color = t.status === 'added' ? '#4ADE80' : t.status === 'removed' ? '#EF4444' : t.status === 'changed' ? '#F59E0B' : '#334155'
              const prefix = t.status === 'added' ? '+ ' : t.status === 'removed' ? '− ' : t.status === 'changed' ? '~ ' : '  '
              if (t.status === 'same') return null
              return (
                <div key={i} className="flex items-center gap-2 px-2 py-1 rounded text-[0.6rem] font-mono" style={{ background: `${color}08`, border: `1px solid ${color}25` }}>
                  <span style={{ color, fontWeight: 'bold' }}>{prefix}</span>
                  <span style={{ color }}>{t.name}</span>
                  {t.durationDelta !== undefined && t.status === 'changed' && (
                    <span className="ml-auto" style={{ color: '#475569' }}>
                      Δ {t.durationDelta >= 0 ? '+' : ''}{Math.round(t.durationDelta)}ms
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* side-by-side text */}
      <div className="grid grid-cols-2 gap-2">
        {[{ turn: fromTurn, label: `T${fromIdx + 1}`, color: '#475569' }, { turn: toTurn, label: `T${toIdx + 1}`, color: '#22D3EE' }].map(({ turn, label, color }) => (
          <div key={label} className="rounded p-2.5" style={{ background: '#060d18', border: `1px solid ${color}30` }}>
            <div className="text-[0.5rem] font-mono uppercase tracking-wider mb-1.5" style={{ color }}>
              {label} · {fmtMs(turn.durationMs)}
            </div>
            <pre className="text-[0.6rem] font-mono overflow-auto max-h-48" style={{ color: '#94A3B8', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {turn.assistantText || '(no text)'}
            </pre>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── main inner ───────────────────────────────────────────────────────────────
function ReplayInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const preselect = searchParams.get('project') ?? ''
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  const [slugs, setSlugs] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('')
  const [data, setData] = useState<ReplayResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [turnIdx, setTurnIdx] = useState(0)
  const [diffTurnIdx, setDiffTurnIdx] = useState<number | null>(null)
  const [autoplay, setAutoplay] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scrubRef = useRef<HTMLInputElement>(null)
  // annotation state
  const [annotations, setAnnotations] = useState<TurnAnnotationRow[]>([])
  const [annotateIdx, setAnnotateIdx] = useState<number | null>(null)
  const [annotateTag, setAnnotateTag] = useState<TurnAnnotationTag>('note')
  const [annotateNote, setAnnotateNote] = useState('')
  const [annotateSaving, setAnnotateSaving] = useState(false)

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
    setDiffTurnIdx(null)
    setAutoplay(false)
    fetch(`/api/replay/${encodeURIComponent(slug)}?turns=50`)
      .then((r) => r.json())
      .then((d: ReplayResponse) => {
        setData(d)
        setLoading(false)
        // Apply ?from / ?to URL params if present
        if (fromParam !== null && toParam !== null) {
          const f = parseInt(fromParam, 10)
          const t = parseInt(toParam, 10)
          if (!isNaN(f) && !isNaN(t)) {
            setTurnIdx(t)
            setDiffTurnIdx(f)
          }
        }
        // apply ?turn= deep link from annotations page
      })
      .catch(() => setLoading(false))
    // load annotations for this slug
    fetch(`/api/annotations?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d: { annotations: TurnAnnotationRow[] }) => setAnnotations(d.annotations ?? []))
      .catch(() => {})
  }, [fromParam, toParam])

  useEffect(() => {
    if (selected) {
      loadData(selected)
    }
  }, [selected, loadData])

  // apply ?turn= deep link from annotations page
  const turnParam = useSearchParams().get('turn')
  useEffect(() => {
    if (turnParam !== null) {
      const t = parseInt(turnParam, 10)
      if (!isNaN(t)) setTurnIdx(t)
    }
  }, [turnParam, data])

  const turns = data?.turns ?? []
  const total = turns.length
  const turn: ReplayTurn | undefined = turns[turnIdx]
  const diffTurn: ReplayTurn | undefined = diffTurnIdx !== null ? turns[diffTurnIdx] : undefined
  const isDiffMode = diffTurnIdx !== null && diffTurnIdx !== turnIdx && diffTurn !== undefined

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
        if (diffTurnIdx !== null) { setDiffTurnIdx(null); return }
        router.back()
      } else if (e.key === ' ') {
        e.preventDefault()
        setAutoplay((a) => !a)
      } else if (e.key === 'd' || e.key === 'D') {
        setDiffTurnIdx((prev) => {
          if (prev === null) return turnIdx  // pin current as baseline
          return null                         // clear diff mode
        })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [total, router, turnIdx, diffTurnIdx])

  const prev = () => { setTurnIdx((i) => Math.max(i - 1, 0)); setAutoplay(false) }
  const next = () => { setTurnIdx((i) => Math.min(i + 1, total - 1)); setAutoplay(false) }

  function handleTurnChipClick(idx: number, e: React.MouseEvent) {
    if (e.shiftKey) {
      setDiffTurnIdx(idx)
    } else {
      setTurnIdx(idx)
      setAutoplay(false)
    }
  }

  function openAnnotatePopover(idx: number) {
    const existing = annotations.find((a) => a.slug === selected && a.turn_index === idx)
    setAnnotateIdx(idx)
    setAnnotateTag(existing ? existing.tag as TurnAnnotationTag : 'note')
    setAnnotateNote(existing ? existing.note : '')
  }

  async function saveAnnotation() {
    if (annotateIdx === null) return
    setAnnotateSaving(true)
    const existing = annotations.find((a) => a.slug === selected && a.turn_index === annotateIdx)
    await fetch('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(existing ? { id: existing.id } : {}),
        slug: selected,
        sessionFile: data?.sessionFile ?? '',
        turnIndex: annotateIdx,
        tag: annotateTag,
        note: annotateNote,
      }),
    })
    // reload annotations
    const r = await fetch(`/api/annotations?slug=${encodeURIComponent(selected)}`)
    const d = await r.json() as { annotations: TurnAnnotationRow[] }
    setAnnotations(d.annotations ?? [])
    setAnnotateSaving(false)
    setAnnotateIdx(null)
  }

  async function deleteAnnotationForTurn(idx: number) {
    const existing = annotations.find((a) => a.slug === selected && a.turn_index === idx)
    if (!existing) return
    await fetch(`/api/annotations?id=${existing.id}`, { method: 'DELETE' })
    setAnnotations((prev) => prev.filter((a) => a.id !== existing.id))
    setAnnotateIdx(null)
  }

  const annotationMap = new Map(annotations.filter((a) => a.slug === selected).map((a) => [a.turn_index, a]))

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
        <button
          onClick={() => setDiffTurnIdx((prev) => prev === null ? turnIdx : null)}
          title="Toggle cross-turn diff mode (D)"
          className="text-[0.6rem] font-mono px-2 py-1 rounded border transition-colors"
          style={{
            borderColor: isDiffMode ? '#F59E0B40' : '#1e3a5f',
            color: isDiffMode ? '#F59E0B' : '#64748B',
            background: 'transparent',
          }}
        >
          {isDiffMode ? `⇌ T${(diffTurnIdx ?? 0) + 1}↔T${turnIdx + 1}` : '⇌ compare'}
        </button>
        {isDiffMode && (
          <button
            onClick={() => setDiffTurnIdx(null)}
            className="text-[0.6rem] font-mono px-1.5 py-1 rounded border transition-colors"
            style={{ borderColor: '#1e3a5f', color: '#64748B' }}
          >
            ✕ exit diff
          </button>
        )}
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
            {isDiffMode && diffTurn ? (
              <CrossTurnDiff
                fromTurn={diffTurn}
                toTurn={turn}
                fromIdx={diffTurnIdx ?? 0}
                toIdx={turnIdx}
              />
            ) : (
              <>
                {/* turn annotation bar */}
                {(() => {
                  const ann = annotationMap.get(turnIdx)
                  return (
                    <div className="flex items-center gap-2 justify-end">
                      {ann && (
                        <span
                          className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded"
                          style={{ background: `${TAG_COLORS[ann.tag as TurnAnnotationTag]}15`, color: TAG_COLORS[ann.tag as TurnAnnotationTag], border: `1px solid ${TAG_COLORS[ann.tag as TurnAnnotationTag]}30` }}
                        >
                          {TAG_ICONS[ann.tag as TurnAnnotationTag]} {ann.note || ann.tag}
                        </span>
                      )}
                      <button
                        onClick={() => openAnnotatePopover(turnIdx)}
                        className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded border border-white/5 text-slate-600 hover:text-slate-300 hover:border-white/20 transition-colors"
                        title="Annotate this turn"
                      >
                        🏷
                      </button>
                    </div>
                  )
                })()}

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

                {/* diff from prev */}
                {showDiff && (
                  <div>
                    <div className="text-[0.5rem] font-mono uppercase tracking-wider mb-1" style={{ color: '#334155' }}>
                      diff from T{turnIdx} → T{turnIdx + 1}
                    </div>
                    <DiffStrip diff={turn.diffFromPrev} />
                  </div>
                )}
              </>
            )}
          </div>

          {/* bottom controls */}
          <div
            className="shrink-0 border-t px-4 py-3 space-y-2"
            style={{ borderColor: '#1e3a5f', background: '#060d18' }}
          >
            {/* turn chips strip for shift-click comparison */}
            {total <= 50 && (
              <div className="flex flex-wrap gap-0.5 max-h-12 overflow-y-auto">
                {turns.map((_, i) => {
                  const isCurrent = i === turnIdx
                  const isDiffBase = i === diffTurnIdx
                  const ann = annotationMap.get(i)
                  const annColor = ann ? TAG_COLORS[ann.tag as TurnAnnotationTag] : null
                  return (
                    <button
                      key={i}
                      onClick={(e) => handleTurnChipClick(i, e)}
                      title={`T${i + 1}${isDiffBase ? ' (diff baseline)' : ''}${ann ? ` — ${ann.tag}: ${ann.note}` : ''} — shift-click to set as comparison`}
                      className="text-[0.45rem] font-mono rounded px-1 py-0.5 transition-colors select-none relative"
                      style={{
                        background: isCurrent ? 'rgba(0,245,255,0.15)' : isDiffBase ? 'rgba(245,158,11,0.15)' : annColor ? `${annColor}10` : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${isCurrent ? 'rgba(0,245,255,0.4)' : isDiffBase ? 'rgba(245,158,11,0.4)' : annColor ? `${annColor}40` : 'rgba(255,255,255,0.06)'}`,
                        color: isCurrent ? '#22D3EE' : isDiffBase ? '#F59E0B' : annColor ?? '#334155',
                      }}
                    >
                      T{i + 1}
                    </button>
                  )
                })}
              </div>
            )}

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
                ← → keys · Space = play · D = compare · shift+click chip · Esc = back
              </div>
            </div>
          </div>
        </div>
      )}

      {/* annotation popover */}
      {annotateIdx !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setAnnotateIdx(null) }}
        >
          <div className="rounded-xl border border-white/10 w-full max-w-sm mx-4 flex flex-col" style={{ background: '#060d1a' }}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
              <span className="text-[0.65rem] font-mono font-bold text-slate-300">🏷 Annotate T{annotateIdx + 1}</span>
              <div className="flex-1" />
              <button onClick={() => setAnnotateIdx(null)} className="text-slate-600 hover:text-slate-300 text-xs">✕</button>
            </div>
            <div className="px-4 py-4 flex flex-col gap-3">
              {/* tag selector */}
              <div className="flex gap-1.5">
                {(['note', 'warning', 'bug'] as TurnAnnotationTag[]).map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setAnnotateTag(tag)}
                    className="flex-1 text-[0.6rem] font-mono px-2 py-1 rounded border transition-colors"
                    style={{
                      borderColor: annotateTag === tag ? `${TAG_COLORS[tag]}60` : '#374151',
                      color: annotateTag === tag ? TAG_COLORS[tag] : '#64748b',
                      background: annotateTag === tag ? `${TAG_COLORS[tag]}10` : 'transparent',
                    }}
                  >
                    {TAG_ICONS[tag]} {tag}
                  </button>
                ))}
              </div>
              <textarea
                value={annotateNote}
                onChange={(e) => setAnnotateNote(e.target.value.slice(0, 200))}
                placeholder="Note (max 200 chars)…"
                rows={3}
                autoFocus
                className="text-[0.65rem] font-mono bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-slate-500 resize-none"
              />
              <div className="flex items-center justify-between gap-2">
                <div className="text-[0.5rem] font-mono text-slate-700">{annotateNote.length}/200</div>
                <div className="flex gap-2">
                  {annotationMap.has(annotateIdx) && (
                    <button
                      onClick={() => deleteAnnotationForTurn(annotateIdx)}
                      className="text-[0.6rem] font-mono px-2 py-0.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                  <button onClick={() => setAnnotateIdx(null)} className="text-[0.6rem] font-mono px-2 py-0.5 rounded border border-slate-700 text-slate-500">
                    Cancel
                  </button>
                  <button
                    onClick={saveAnnotation}
                    disabled={annotateSaving}
                    className="text-[0.6rem] font-mono px-3 py-0.5 rounded border border-cyber-cyan/30 text-cyber-cyan hover:bg-cyber-cyan/10 transition-colors disabled:opacity-40"
                  >
                    {annotateSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
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

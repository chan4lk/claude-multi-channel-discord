'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import SubPageHeader from '../../components/SubPageHeader'
import type { TurnEntry, TurnsDetailResponse } from '../api/turns/[slug]/route'

// --- Simple LCS-based line diff ---
type DiffLine = { type: 'same' | 'add' | 'remove'; line: string }

function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length

  // LCS DP table (forward)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      result.push({ type: 'same', line: a[i] })
      i++
      j++
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ type: 'add', line: b[j] })
      j++
    } else {
      result.push({ type: 'remove', line: a[i] })
      i++
    }
  }
  return result
}

function toUnifiedPatch(a: string, b: string, diff: DiffLine[]): string {
  const lines: string[] = ['--- turn A', '+++ turn B']
  for (const d of diff) {
    if (d.type === 'same') lines.push(` ${d.line}`)
    else if (d.type === 'add') lines.push(`+${d.line}`)
    else lines.push(`-${d.line}`)
  }
  void a
  void b
  return lines.join('\n')
}

// --- Turn card ---
function TurnCard({
  turn,
  isSelected,
  selectionIdx,
  onClick,
}: {
  turn: TurnEntry
  isSelected: boolean
  selectionIdx: 0 | 1 | null
  onClick: (e: React.MouseEvent) => void
}) {
  const preview = turn.text.trim().slice(0, 120).replace(/\n+/g, ' ')
  const ts = turn.ts ? new Date(turn.ts).toLocaleTimeString() : ''

  return (
    <div
      onClick={onClick}
      className="rounded border px-3 py-2 cursor-pointer transition-all select-none"
      style={{
        borderColor: isSelected
          ? selectionIdx === 0
            ? '#EF4444'
            : '#10B981'
          : '#1f2937',
        background: isSelected
          ? selectionIdx === 0
            ? 'rgba(239,68,68,0.08)'
            : 'rgba(16,185,129,0.08)'
          : 'rgba(10,10,10,0.6)',
        boxShadow: isSelected
          ? `0 0 12px ${selectionIdx === 0 ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`
          : 'none',
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="text-[0.6rem] font-mono font-bold px-1 rounded"
          style={{
            background: isSelected
              ? selectionIdx === 0
                ? 'rgba(239,68,68,0.25)'
                : 'rgba(16,185,129,0.25)'
              : 'rgba(34,211,238,0.1)',
            color: isSelected
              ? selectionIdx === 0
                ? '#EF4444'
                : '#10B981'
              : '#22D3EE',
          }}
        >
          #{turn.index + 1}
        </span>
        {ts && (
          <span className="text-[0.55rem] font-mono text-slate-600">{ts}</span>
        )}
        {turn.toolCalls.length > 0 && (
          <span className="text-[0.55rem] font-mono text-purple-400/70">
            {turn.toolCalls.length} tool{turn.toolCalls.length !== 1 ? 's' : ''}
          </span>
        )}
        <span className="text-[0.55rem] font-mono text-slate-700 ml-auto">
          {turn.charCount} chars
        </span>
      </div>
      {preview ? (
        <p className="text-[0.68rem] font-mono text-slate-400 leading-relaxed line-clamp-2">
          {preview}
        </p>
      ) : (
        <p className="text-[0.65rem] font-mono text-slate-700 italic">
          (tool-only turn)
        </p>
      )}
    </div>
  )
}

// --- Diff view ---
function DiffView({
  turnA,
  turnB,
  onClose,
}: {
  turnA: TurnEntry
  turnB: TurnEntry
  onClose: () => void
}) {
  const diff = useMemo(() => lineDiff(turnA.text, turnB.text), [turnA, turnB])
  const added = diff.filter((d) => d.type === 'add').length
  const removed = diff.filter((d) => d.type === 'remove').length

  function copyDiff() {
    const patch = toUnifiedPatch(turnA.text, turnB.text, diff)
    navigator.clipboard.writeText(patch).catch(() => {})
  }

  function downloadPatch() {
    const patch = toUnifiedPatch(turnA.text, turnB.text, diff)
    const blob = new Blob([patch], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `turn-${turnA.index + 1}-vs-${turnB.index + 1}.patch`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'rgba(4,8,16,0.97)', backdropFilter: 'blur(4px)' }}
    >
      {/* Diff header */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 border-b shrink-0"
        style={{ borderColor: '#1f2937' }}
      >
        <button
          onClick={onClose}
          className="text-[0.65rem] font-mono text-slate-500 hover:text-cyan-400 transition-colors"
        >
          ← back
        </button>
        <span
          className="text-xs font-bold tracking-widest font-mono"
          style={{ fontFamily: 'Orbitron, monospace', color: '#22D3EE' }}
        >
          TURN DIFF
        </span>
        <span className="text-[0.65rem] font-mono text-slate-500">
          #{turnA.index + 1} → #{turnB.index + 1}
        </span>
        <span className="text-[0.65rem] font-mono text-green-400">+{added}</span>
        <span className="text-[0.65rem] font-mono text-red-400">-{removed}</span>
        <div className="flex-1" />
        <button
          onClick={copyDiff}
          className="text-[0.6rem] font-mono px-2 py-1 rounded border transition-colors"
          style={{ borderColor: '#374151', color: '#94A3B8' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#22D3EE'; (e.currentTarget as HTMLElement).style.color = '#22D3EE' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#374151'; (e.currentTarget as HTMLElement).style.color = '#94A3B8' }}
        >
          Copy diff
        </button>
        <button
          onClick={downloadPatch}
          className="text-[0.6rem] font-mono px-2 py-1 rounded border transition-colors"
          style={{ borderColor: '#374151', color: '#94A3B8' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#22D3EE'; (e.currentTarget as HTMLElement).style.color = '#22D3EE' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#374151'; (e.currentTarget as HTMLElement).style.color = '#94A3B8' }}
        >
          Download .patch
        </button>
      </div>

      {/* Diff lines */}
      <div className="flex-1 overflow-auto">
        <pre
          className="text-[0.7rem] font-mono leading-5 p-4 min-w-0"
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {diff.length === 0 ? (
            <span className="text-slate-600">No textual difference between these turns.</span>
          ) : (
            diff.map((d, i) => (
              <span
                key={i}
                style={{
                  display: 'block',
                  background:
                    d.type === 'add'
                      ? 'rgba(16,185,129,0.12)'
                      : d.type === 'remove'
                      ? 'rgba(239,68,68,0.12)'
                      : 'transparent',
                  color:
                    d.type === 'add'
                      ? '#34D399'
                      : d.type === 'remove'
                      ? '#F87171'
                      : '#64748B',
                  borderLeft: `2px solid ${
                    d.type === 'add' ? '#10B981' : d.type === 'remove' ? '#EF4444' : 'transparent'
                  }`,
                  paddingLeft: 8,
                  marginBottom: 1,
                }}
              >
                {d.type === 'add' ? '+' : d.type === 'remove' ? '-' : ' '}
                {d.line}
              </span>
            ))
          )}
        </pre>
      </div>
    </div>
  )
}

// --- Main page ---
function TurnDiffPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [slugList, setSlugList] = useState<string[]>([])
  const [selectedSlug, setSelectedSlug] = useState<string>(searchParams.get('slug') ?? '')
  const [turns, setTurns] = useState<TurnEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selectionA, setSelectionA] = useState<number | null>(
    searchParams.get('diffA') ? parseInt(searchParams.get('diffA')!) : null
  )
  const [selectionB, setSelectionB] = useState<number | null>(
    searchParams.get('diffB') ? parseInt(searchParams.get('diffB')!) : null
  )
  const [showDiff, setShowDiff] = useState(
    searchParams.get('diffA') !== null && searchParams.get('diffB') !== null
  )

  // Load project slugs
  useEffect(() => {
    fetch('/api/fleet')
      .then((r) => r.json())
      .then((d) => {
        const slugs = (d.projects ?? []).map((p: { slug: string }) => p.slug).sort()
        setSlugList(slugs)
        if (!selectedSlug && slugs.length > 0) setSelectedSlug(slugs[0])
      })
      .catch(() => {})
  }, [selectedSlug])

  // Load turns for selected slug
  const loadTurns = useCallback(() => {
    if (!selectedSlug) return
    setLoading(true)
    fetch(`/api/turns/${selectedSlug}?limit=50`)
      .then((r) => r.json())
      .then((d: TurnsDetailResponse) => setTurns(d.turns ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [selectedSlug])

  useEffect(() => {
    loadTurns()
  }, [loadTurns])

  // Sync URL params
  useEffect(() => {
    const params = new URLSearchParams()
    if (selectedSlug) params.set('slug', selectedSlug)
    if (selectionA !== null) params.set('diffA', String(selectionA))
    if (selectionB !== null) params.set('diffB', String(selectionB))
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [selectedSlug, selectionA, selectionB, router])

  function handleTurnClick(turn: TurnEntry, e: React.MouseEvent) {
    const idx = turn.index
    if (e.shiftKey) {
      // Second selection
      if (selectionA === null) {
        setSelectionA(idx)
      } else if (selectionA === idx) {
        setSelectionA(null)
        setSelectionB(null)
      } else {
        setSelectionB(idx)
      }
    } else {
      // First selection (clear second)
      if (selectionA === idx) {
        setSelectionA(null)
        setSelectionB(null)
      } else {
        setSelectionA(idx)
        setSelectionB(null)
      }
    }
  }

  function getSelectionIdx(turnIdx: number): 0 | 1 | null {
    if (selectionA === turnIdx) return 0
    if (selectionB === turnIdx) return 1
    return null
  }

  const turnA = selectionA !== null ? turns.find((t) => t.index === selectionA) : undefined
  const turnB = selectionB !== null ? turns.find((t) => t.index === selectionB) : undefined
  const canDiff = turnA !== undefined && turnB !== undefined

  if (showDiff && canDiff && turnA && turnB) {
    // Ensure A is the older one
    const [ta, tb] = turnA.index < turnB.index ? [turnA, turnB] : [turnB, turnA]
    return (
      <DiffView
        turnA={ta}
        turnB={tb}
        onClose={() => setShowDiff(false)}
      />
    )
  }

  return (
    <div className="min-h-dvh flex flex-col font-mono" style={{ background: '#0a0a0a' }}>
      <SubPageHeader title="TURN DIFF">
        {/* Project selector */}
        <select
          value={selectedSlug}
          onChange={(e) => {
            setSelectedSlug(e.target.value)
            setSelectionA(null)
            setSelectionB(null)
            setShowDiff(false)
          }}
          className="text-[0.65rem] font-mono px-2 py-1 rounded border bg-transparent"
          style={{ borderColor: '#374151', color: '#94A3B8', background: '#0a0a0a' }}
        >
          {slugList.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Diff button */}
        {canDiff && (
          <button
            onClick={() => setShowDiff(true)}
            className="text-[0.65rem] font-mono px-3 py-1 rounded border transition-all"
            style={{
              borderColor: '#22D3EE',
              color: '#22D3EE',
              background: 'rgba(34,211,238,0.1)',
              boxShadow: '0 0 8px rgba(34,211,238,0.2)',
            }}
          >
            Diff selected (#{(selectionA ?? 0) + 1} vs #{(selectionB ?? 0) + 1})
          </button>
        )}

        <button
          onClick={loadTurns}
          className="text-[0.6rem] font-mono px-2 py-1 rounded border transition-colors"
          style={{ borderColor: '#374151', color: '#6B7280' }}
        >
          ↺
        </button>
      </SubPageHeader>

      {/* Instruction bar */}
      <div
        className="px-4 py-1.5 border-b text-[0.6rem] font-mono"
        style={{ borderColor: '#1a1a1a', color: '#374151' }}
      >
        Click turn to select A (red) · Shift+click to select B (green) · Then &quot;Diff selected&quot;
      </div>

      <main className="flex-1 overflow-auto p-4">
        {loading && turns.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <span className="text-cyan-400/40 text-sm animate-pulse">Loading turns...</span>
          </div>
        ) : turns.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <span className="text-slate-600 text-sm">No turns found for {selectedSlug || 'this project'}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-w-3xl mx-auto">
            {turns.map((turn) => (
              <TurnCard
                key={turn.index}
                turn={turn}
                isSelected={selectionA === turn.index || selectionB === turn.index}
                selectionIdx={getSelectionIdx(turn.index)}
                onClick={(e) => handleTurnClick(turn, e)}
              />
            ))}
          </div>
        )}
      </main>

      <footer
        className="border-t px-4 py-1.5 flex items-center gap-4 shrink-0"
        style={{ borderColor: '#1f2937' }}
      >
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: 'rgba(239,68,68,0.4)', border: '1px solid #EF4444' }} />
          <span className="text-[0.58rem] text-slate-500">Turn A</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: 'rgba(16,185,129,0.4)', border: '1px solid #10B981' }} />
          <span className="text-[0.58rem] text-slate-500">Turn B</span>
        </div>
        <span className="ml-auto text-[0.55rem] font-mono text-slate-700">
          {turns.length} turns · {selectedSlug}
        </span>
      </footer>
    </div>
  )
}

export default function TurnDiffPage() {
  return (
    <Suspense fallback={
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading…</div>
      </div>
    }>
      <TurnDiffPageInner />
    </Suspense>
  )
}

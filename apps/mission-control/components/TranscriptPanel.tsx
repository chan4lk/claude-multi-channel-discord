'use client'

import { useEffect, useRef, useState } from 'react'
import GlassCard from './ui/GlassCard'
import type { TranscriptEntry, TranscriptResponse } from '../app/api/transcript/[slug]/route'

const TOOL_COLORS: Record<string, string> = {
  Bash:       '#F59E0B',
  Read:       '#00F5FF',
  Write:      '#4ADE80',
  Edit:       '#4ADE80',
  Grep:       '#A855F7',
  Agent:      '#F97316',
  WebFetch:   '#60A5FA',
  WebSearch:  '#60A5FA',
}

function toolColor(name: string): string {
  for (const [prefix, color] of Object.entries(TOOL_COLORS)) {
    if (name.startsWith(prefix)) return color
  }
  return '#64748b'
}

function EntryRow({ entry }: { entry: TranscriptEntry }) {
  if (entry.kind === 'tool_call') {
    const color = toolColor(entry.toolName ?? '')
    return (
      <div className="flex items-start gap-2 py-1 border-b border-slate-800/50">
        <span
          className="shrink-0 text-[0.55rem] font-mono font-bold px-1 py-0.5 rounded uppercase tracking-wider mt-0.5"
          style={{ color, background: `${color}18`, border: `1px solid ${color}30` }}
        >
          {(entry.toolName ?? 'tool').slice(0, 14)}
        </span>
        <span className="text-[0.55rem] font-mono text-slate-500 break-all leading-relaxed">
          {entry.content}
        </span>
      </div>
    )
  }

  if (entry.kind === 'tool_result') {
    return (
      <div className="flex items-start gap-2 py-1 border-b border-slate-800/50">
        <span className="shrink-0 text-[0.55rem] font-mono text-slate-700 mt-0.5">└─</span>
        <span className="text-[0.55rem] font-mono text-slate-600 break-all leading-relaxed italic">
          {entry.content}
        </span>
      </div>
    )
  }

  // text
  return (
    <div className="py-1.5 border-b border-slate-800/50">
      <span className="text-[0.6rem] font-mono text-slate-300 leading-relaxed whitespace-pre-wrap">{entry.content}</span>
    </div>
  )
}

interface Props {
  slugs: string[]
}

export default function TranscriptPanel({ slugs }: Props) {
  const [selectedSlug, setSelectedSlug] = useState<string>('')
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [userScrolled, setUserScrolled] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Pick first slug by default
  useEffect(() => {
    if (slugs.length > 0 && !selectedSlug) {
      setSelectedSlug(slugs[0]!)
    }
  }, [slugs, selectedSlug])

  async function fetchTranscript(slug: string) {
    if (!slug) return
    try {
      setLoading(true)
      const res = await fetch(`/api/transcript/${encodeURIComponent(slug)}?limit=20`)
      if (!res.ok) return
      const data: TranscriptResponse = await res.json()
      setEntries(data.entries)
      setCheckedAt(data.checkedAt)
    } catch {
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!selectedSlug) return
    setEntries([])
    setUserScrolled(false)
    fetchTranscript(selectedSlug)
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => fetchTranscript(selectedSlug), 5_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [selectedSlug])

  // Auto-scroll to bottom unless user scrolled up
  useEffect(() => {
    if (!userScrolled && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [entries, userScrolled])

  function handleScroll() {
    const el = listRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
    setUserScrolled(!atBottom)
  }

  return (
    <GlassCard className="flex flex-col" style={{ maxHeight: 340 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-cyber-cyan/10 shrink-0">
        <span className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-widest">Transcript</span>
        <select
          value={selectedSlug}
          onChange={(e) => setSelectedSlug(e.target.value)}
          className="cyber-input text-[0.6rem] px-1.5 py-0.5 ml-auto max-w-[140px]"
        >
          {slugs.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {loading && <span className="text-[0.55rem] font-mono text-cyber-amber/70 animate-pulse">loading…</span>}
        {userScrolled && (
          <button
            onClick={() => {
              setUserScrolled(false)
              listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
            }}
            className="text-[0.55rem] font-mono text-cyber-cyan/60 hover:text-cyber-cyan"
          >
            ↓ resume
          </button>
        )}
      </div>

      {/* Entry list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-0"
        onScroll={handleScroll}
      >
        {entries.length === 0 && !loading && (
          <div className="text-center py-6 text-slate-600 text-[0.6rem] font-mono">
            No transcript yet
          </div>
        )}
        {entries.map((entry, i) => <EntryRow key={i} entry={entry} />)}
      </div>

      {checkedAt && (
        <div className="px-3 py-1 text-[0.5rem] font-mono text-slate-700 border-t border-cyber-cyan/8 shrink-0">
          polled {new Date(checkedAt).toLocaleTimeString()} · 5s interval
        </div>
      )}
    </GlassCard>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'

interface MemoryRecord {
  id: string
  channel_slug: string | null
  type: string
  content: string
  created_at: string
  last_accessed_at: string
  access_count: number
}

const TYPE_COLORS: Record<string, string> = {
  decision: '#a78bfa',       // violet
  pattern: '#34d399',        // emerald
  coordination: '#f59e0b',   // amber
  channel_summary: '#00F5FF', // cyan
  general: '#94a3b8',        // slate
}

const ALL_TYPES = ['decision', 'pattern', 'coordination', 'channel_summary', 'general']

function formatRelative(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function TypeBadge({ type }: { type: string }) {
  const color = TYPE_COLORS[type] ?? '#94a3b8'
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[0.6rem] font-mono font-bold uppercase tracking-wider"
      style={{ color, border: `1px solid ${color}40`, background: `${color}12` }}
    >
      {type.replace('_', ' ')}
    </span>
  )
}

function MemoryCard({ mem, onForget }: { mem: MemoryRecord; onForget: (id: string) => void }) {
  const [forgetting, setForgetting] = useState(false)

  async function handleForget() {
    setForgetting(true)
    try {
      await fetch(`/api/memories/${encodeURIComponent(mem.id)}`, { method: 'DELETE' })
      onForget(mem.id)
    } catch {
      setForgetting(false)
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.18 }}
    >
      <GlassCard className="p-3 flex flex-col gap-2 h-full">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <TypeBadge type={mem.type} />
            {mem.channel_slug && (
              <span className="text-[0.6rem] font-mono text-cyber-cyan/70 bg-cyber-cyan/8 border border-cyber-cyan/20 px-1.5 py-0.5 rounded">
                {mem.channel_slug}
              </span>
            )}
          </div>
          <button
            onClick={handleForget}
            disabled={forgetting}
            className="text-[0.6rem] text-slate-600 hover:text-red-400 transition-colors shrink-0 font-mono disabled:opacity-40"
            title="Forget this memory"
          >
            {forgetting ? '…' : '✕'}
          </button>
        </div>

        <p className="text-[0.72rem] text-slate-300 leading-relaxed line-clamp-4 flex-1">
          {mem.content}
        </p>

        <div className="flex items-center justify-between text-[0.58rem] text-slate-600 font-mono mt-auto pt-1 border-t border-white/5">
          <span title={mem.id}>{mem.id.slice(0, 16)}…</span>
          <div className="flex items-center gap-2">
            <span>{mem.access_count}× accessed</span>
            <span>{formatRelative(mem.last_accessed_at)}</span>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

export default function MemoryPanel() {
  const [records, setRecords] = useState<MemoryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [slugFilter, setSlugFilter] = useState<string>('all')
  const [query, setQuery] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchMemories = useCallback(async () => {
    const params = new URLSearchParams()
    if (typeFilter !== 'all') params.set('type', typeFilter)
    if (slugFilter !== 'all') params.set('slug', slugFilter)
    if (query.trim()) params.set('q', query.trim())
    try {
      const res = await fetch(`/api/memories?${params}`)
      if (res.ok) setRecords(await res.json())
    } catch {}
    setLoading(false)
  }, [typeFilter, slugFilter, query])

  useEffect(() => {
    fetchMemories()
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(fetchMemories, 60_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchMemories])

  function handleForget(id: string) {
    setRecords((prev) => prev.filter((r) => r.id !== id))
  }

  const slugs = Array.from(new Set(records.map((r) => r.channel_slug).filter(Boolean) as string[])).sort()

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          placeholder="Search content…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[140px] bg-cyber-surface/60 border border-white/10 rounded px-2.5 py-1.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyber-cyan/40 font-mono"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-cyber-surface/60 border border-white/10 rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-cyber-cyan/40 font-mono"
        >
          <option value="all">All types</option>
          {ALL_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace('_', ' ')}</option>
          ))}
        </select>
        {slugs.length > 0 && (
          <select
            value={slugFilter}
            onChange={(e) => setSlugFilter(e.target.value)}
            className="bg-cyber-surface/60 border border-white/10 rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-cyber-cyan/40 font-mono"
          >
            <option value="all">All channels</option>
            {slugs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <span className="text-[0.6rem] text-slate-600 font-mono shrink-0">
          {records.length} memories
        </span>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-xs text-slate-600 font-mono py-6 text-center">loading…</div>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
          <div className="text-2xl opacity-30">✦</div>
          <p className="text-xs text-slate-600 font-mono">No memories yet</p>
          <p className="text-[0.6rem] text-slate-700 font-mono max-w-xs leading-relaxed">
            Memories are created automatically when an agent runs <span style={{ color: '#a78bfa' }}>memory distillation</span>.
            Check that <code className="text-slate-500">memory.db</code> exists in <code className="text-slate-500">MCD_CHANNELS_DIR</code>,
            or trigger distillation via Inject → <code className="text-slate-500">/memory distill</code>.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {records.map((m) => (
              <MemoryCard key={m.id} mem={m} onForget={handleForget} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

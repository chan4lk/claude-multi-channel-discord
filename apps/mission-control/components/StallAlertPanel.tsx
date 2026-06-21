'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useFleet } from './FleetContext'
import type { StallEntry, StallsResponse } from '../app/api/stalls/route'

const STALL_PROMPTS: Record<string, string> = {
  waiting: 'You appear to be waiting for operator input. If you have a pending question, please summarise it briefly and continue with the best available information.',
  blocked: 'You may be blocked on a task. Please review your current context, decide on the next concrete step, and proceed. If you are waiting for external input, note it and move to another task.',
  slow: 'Please check if you have any incomplete tasks or pending tool calls. Resume work on the most important item or reply with a status update.',
}

function suggestPrompt(reason: string, snippet: string | null): string {
  const lower = reason.toLowerCase()
  let base = STALL_PROMPTS.slow
  if (lower.includes('waiting') || lower.includes('operator')) base = STALL_PROMPTS.waiting
  else if (lower.includes('blocked') || lower.includes('question')) base = STALL_PROMPTS.blocked

  if (snippet) {
    return `${base}\n\nLast output: "${snippet.slice(0, 100)}..."`
  }
  return base
}

function formatAge(mins: number): string {
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`
  return `${mins}m`
}

interface StallRowProps {
  stall: StallEntry
  onDismiss: (slug: string) => void
}

function StallRow({ stall, onDismiss }: StallRowProps) {
  const isOld = stall.stallAgeMins > 30

  function handleInject() {
    const initialMessage = suggestPrompt(stall.stallReason, stall.snippet)
    window.dispatchEvent(
      new CustomEvent('mc:inject', { detail: { slug: stall.slug, initialMessage } })
    )
    onDismiss(stall.slug)
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      className={`flex flex-col gap-1.5 p-3 rounded border transition-colors ${
        isOld
          ? 'border-red-500/30 bg-red-500/5'
          : 'border-amber-500/20 bg-amber-500/5'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOld ? 'bg-red-400 animate-pulse' : 'bg-amber-400'}`}
        />
        <span className="text-xs font-bold font-mono text-slate-200">{stall.slug}</span>
        <span
          className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded"
          style={{
            color: isOld ? '#F87171' : '#FCD34D',
            background: isOld ? '#EF444420' : '#F59E0B20',
            border: `1px solid ${isOld ? '#EF444440' : '#F59E0B40'}`,
          }}
        >
          {formatAge(stall.stallAgeMins)} stalled
        </span>
        <div className="flex-1" />
        <button
          onClick={handleInject}
          className="text-[0.6rem] px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider transition-colors"
          style={{
            color: '#A855F7',
            border: '1px solid #A855F740',
            background: '#A855F712',
          }}
        >
          Inject
        </button>
      </div>
      <p className="text-[0.65rem] text-slate-400 pl-3.5">{stall.stallReason}</p>
      {stall.snippet && (
        <p className="text-[0.6rem] text-slate-500 pl-3.5 font-mono truncate" title={stall.snippet}>
          &ldquo;{stall.snippet}&rdquo;
        </p>
      )}
    </motion.div>
  )
}

export default function StallAlertPanel() {
  const { stalls: sseStalls, stalledAt: sseStalledAt, sseStatus } = useFleet()
  const [polledStalls, setPolledStalls] = useState<StallEntry[]>([])
  const [polledCheckedAt, setPolledCheckedAt] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Use SSE data when connected; fall back to REST polling when disconnected
  const stallSource = sseStatus === 'disconnected' ? polledStalls : sseStalls
  const checkedAt = sseStatus === 'disconnected' ? polledCheckedAt : sseStalledAt

  async function fetchStalls() {
    try {
      const res = await fetch('/api/stalls')
      if (!res.ok) return
      const data: StallsResponse = await res.json()
      setPolledStalls(data.stalls)
      setPolledCheckedAt(data.checkedAt)
    } catch {}
  }

  useEffect(() => {
    // Always fetch on mount for initial data; poll as fallback when SSE unavailable
    fetchStalls()
    intervalRef.current = setInterval(fetchStalls, 30_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  // Sync dismissed set when stall list changes
  const stalls = stallSource
  useEffect(() => {
    setDismissed((prev) => {
      const stillStalled = new Set(stalls.map((s) => s.slug))
      const next = new Set<string>()
      for (const slug of prev) {
        if (stillStalled.has(slug)) next.add(slug)
      }
      return next
    })
  }, [stalls])

  const visible = stalls.filter((s) => !dismissed.has(s.slug))
  const stallCount = visible.length

  function handleDismiss(slug: string) {
    setDismissed((prev) => new Set([...prev, slug]))
  }

  return (
    <div>
      {/* Header row */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-2 w-full text-left mb-2 group"
      >
        <span
          className="w-1.5 h-1.5 rounded-sm bg-red-400/70 shrink-0"
          style={{ clipPath: 'polygon(0 0,100% 0,100% 100%,0 100%)' }}
        />
        <h2 className="section-label flex items-center gap-2">
          Stall Alerts
          {stallCount > 0 && (
            <span
              className="px-1.5 py-0.5 rounded text-[0.6rem] font-mono font-bold animate-pulse"
              style={{ color: '#F87171', background: '#EF444420', border: '1px solid #EF444440' }}
            >
              {stallCount}
            </span>
          )}
        </h2>
        <div className="flex-1 h-px bg-gradient-to-r from-red-500/20 to-transparent" />
        <span className="text-[0.55rem] text-slate-600 font-mono group-hover:text-slate-400 transition-colors">
          {collapsed ? '▶' : '▼'}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="stall-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <GlassCard className="p-3">
              {stallCount === 0 ? (
                <div className="flex items-center justify-center gap-2 py-4">
                  <span
                    className="text-sm font-mono"
                    style={{ color: '#4ADE80', textShadow: '0 0 8px #4ADE8080' }}
                  >
                    No stalled channels ✓
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <AnimatePresence mode="popLayout">
                    {visible.map((stall) => (
                      <StallRow key={stall.slug} stall={stall} onDismiss={handleDismiss} />
                    ))}
                  </AnimatePresence>
                </div>
              )}
              {checkedAt && (
                <p className="text-[0.55rem] text-slate-600 font-mono mt-2 text-right">
                  checked {new Date(checkedAt).toLocaleTimeString()}
                </p>
              )}
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

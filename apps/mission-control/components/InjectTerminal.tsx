'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { FleetResponse, ProjectState } from '../app/api/fleet/route'

const HISTORY_KEY = 'mc_inject_history'
const MAX_HISTORY = 20

const STATE_COLORS: Record<ProjectState, string> = {
  idle: '#00F5FF',
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
}

interface HistoryEntry {
  slug: string
  message: string
  ts: number
}

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') } catch { return [] }
}

function saveHistory(entry: HistoryEntry) {
  try {
    const prev = loadHistory()
    const next = [entry, ...prev].slice(0, MAX_HISTORY)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {}
}

interface Props {
  initialSlug?: string
  onClose: () => void
}

export default function InjectTerminal({ initialSlug = '', onClose }: Props) {
  const [slug, setSlug] = useState(initialSlug)
  const [message, setMessage] = useState('')
  const [fleet, setFleet] = useState<FleetResponse | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const closeWithEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    setHistory(loadHistory())
    fetch('/api/fleet').then((r) => r.json()).then((d) => setFleet(d)).catch(() => {})
    window.addEventListener('keydown', closeWithEsc)
    textareaRef.current?.focus()
    return () => window.removeEventListener('keydown', closeWithEsc)
  }, [closeWithEsc])

  async function send() {
    if (!slug || !message.trim()) return
    setStatus('sending')
    setErrorMsg('')
    try {
      const res = await fetch('/api/inject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, message: message.trim() }),
      })
      if (res.ok) {
        const entry = { slug, message: message.trim(), ts: Date.now() }
        saveHistory(entry)
        setHistory(loadHistory())
        setStatus('ok')
        setMessage('')
        setTimeout(() => setStatus('idle'), 2000)
      } else {
        const j = await res.json().catch(() => ({}))
        setErrorMsg((j as { error?: string }).error ?? `HTTP ${res.status}`)
        setStatus('error')
        setTimeout(() => setStatus('idle'), 4000)
      }
    } catch (err) {
      setErrorMsg((err as Error).message)
      setStatus('error')
      setTimeout(() => setStatus('idle'), 4000)
    }
  }

  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      send()
    }
  }

  const slugProject = fleet?.projects.find((p) => p.slug === slug)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 8 }}
        transition={{ duration: 0.15 }}
        className="w-full max-w-lg rounded-xl border border-cyber-cyan/20 overflow-hidden shadow-2xl"
        style={{
          background: '#0D1421',
          boxShadow: '0 0 40px rgba(0,245,255,0.12), 0 25px 50px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
          <span className="text-xs font-mono font-bold text-cyber-cyan tracking-wider uppercase">
            ⟳ Inject Terminal
          </span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none">×</button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          {/* Slug selector */}
          <div>
            <label className="text-[0.6rem] text-slate-500 uppercase tracking-wider font-semibold mb-1.5 block">
              Project
            </label>
            <div className="flex gap-2">
              {fleet ? (
                <select
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="flex-1 bg-[#060d1a] border border-cyber-cyan/20 rounded px-2 py-1.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyber-cyan/50"
                >
                  <option value="">— select project —</option>
                  {fleet.projects.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.slug} [{p.state}]
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.trim())}
                  placeholder="project-slug"
                  className="flex-1 bg-[#060d1a] border border-cyber-cyan/20 rounded px-2 py-1.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyber-cyan/50"
                />
              )}
              {slugProject && (
                <span
                  className="self-center text-[0.6rem] font-mono font-bold uppercase px-1.5 py-0.5 rounded border shrink-0"
                  style={{
                    color: STATE_COLORS[slugProject.state],
                    borderColor: `${STATE_COLORS[slugProject.state]}40`,
                    background: `${STATE_COLORS[slugProject.state]}12`,
                  }}
                >
                  {slugProject.state}
                </span>
              )}
            </div>
          </div>

          {/* Message textarea */}
          <div>
            <label className="text-[0.6rem] text-slate-500 uppercase tracking-wider font-semibold mb-1.5 block">
              Message
            </label>
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={onTextareaKeyDown}
              placeholder="Enter prompt to inject into this project's Claude session…"
              rows={4}
              className="w-full bg-[#060d1a] border border-cyber-cyan/20 rounded p-3 text-sm text-slate-200 font-mono resize-y min-h-[100px] focus:outline-none focus:border-cyber-cyan/50 placeholder-slate-700"
            />
            <p className="text-[0.58rem] text-slate-600 font-mono mt-1">Ctrl+Enter to send · Esc to close</p>
          </div>

          {/* Status feedback */}
          <AnimatePresence mode="wait">
            {status === 'ok' && (
              <motion.div
                key="ok"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-xs text-green-400 font-mono text-center py-1"
              >
                Injected ✓
              </motion.div>
            )}
            {status === 'error' && (
              <motion.div
                key="err"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-xs text-red-400 font-mono bg-red-400/10 border border-red-400/20 rounded px-3 py-1.5"
              >
                Error: {errorMsg}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setHistoryOpen((v) => !v)}
              className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors font-mono"
            >
              History ({history.length})
            </button>
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors font-mono"
            >
              Cancel
            </button>
            <button
              onClick={send}
              disabled={!slug || !message.trim() || status === 'sending'}
              className="text-xs px-4 py-1.5 rounded font-mono font-bold transition-all disabled:opacity-40"
              style={{
                background: !slug || !message.trim() || status === 'sending' ? 'rgba(0,245,255,0.08)' : 'rgba(0,245,255,0.18)',
                color: '#00F5FF',
                border: '1px solid rgba(0,245,255,0.3)',
              }}
            >
              {status === 'sending' ? '…' : 'Send Inject'}
            </button>
          </div>

          {/* History panel */}
          <AnimatePresence>
            {historyOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="border-t border-white/8 pt-3 flex flex-col gap-1 max-h-40 overflow-y-auto">
                  {history.length === 0 ? (
                    <p className="text-xs text-slate-600 font-mono text-center py-2">No history yet</p>
                  ) : (
                    history.map((h, i) => (
                      <button
                        key={i}
                        onClick={() => { setSlug(h.slug); setMessage(h.message) }}
                        className="text-left flex items-start gap-2 px-2 py-1.5 rounded hover:bg-white/5 transition-colors"
                      >
                        <span className="text-[0.55rem] text-cyber-cyan font-mono shrink-0 mt-0.5">{h.slug}</span>
                        <span className="text-[0.65rem] text-slate-400 font-mono truncate flex-1">{h.message}</span>
                      </button>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  )
}

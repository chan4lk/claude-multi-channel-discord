'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import type { FleetResponse, FleetProject, ProjectState } from '../api/fleet/route'

const STATE_COLORS: Record<ProjectState, string> = {
  idle: '#00F5FF',
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
}

type DeliveryStatus = 'queued' | 'sent' | 'error'

interface DeliveryRow {
  slug: string
  status: DeliveryStatus
  error?: string
}

interface BroadcastHistoryItem {
  id: number
  ts: string
  message: string
  targets: string[]
  sentCount: number
  errorCount: number
}

interface BroadcastHistoryResponse {
  items: BroadcastHistoryItem[]
  nextCursor: number | null
}

const PRESETS = [
  { label: 'All', filter: (_: FleetProject) => true },
  { label: 'All Active', filter: (p: FleetProject) => p.state === 'active' },
  { label: 'All Stalled', filter: (p: FleetProject) => p.state === 'stalled' },
  { label: 'All Idle', filter: (p: FleetProject) => p.state === 'idle' },
] as const

type Tab = 'send' | 'history'

function BroadcastHistoryTab({ onResend }: { onResend: (message: string, targets: string[]) => void }) {
  const [items, setItems] = useState<BroadcastHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [deleting, setDeleting] = useState<Set<number>>(new Set())
  const [clearing, setClearing] = useState(false)

  const loadHistory = useCallback((cursor?: number) => {
    const url = cursor ? `/api/broadcast/history?cursor=${cursor}` : '/api/broadcast/history'
    fetch(url)
      .then((r) => r.json())
      .then((d: BroadcastHistoryResponse) => {
        setItems((prev) => cursor ? [...prev, ...d.items] : d.items)
        setNextCursor(d.nextCursor)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleDelete(id: number) {
    setDeleting((prev) => new Set(prev).add(id))
    try {
      await fetch(`/api/broadcast/history?id=${id}`, { method: 'DELETE' })
      setItems((prev) => prev.filter((item) => item.id !== id))
    } finally {
      setDeleting((prev) => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  async function handleClearAll() {
    setClearing(true)
    try {
      await fetch('/api/broadcast/history?all=1', { method: 'DELETE' })
      setItems([])
      setNextCursor(null)
    } finally {
      setClearing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-xs font-mono text-slate-600 animate-pulse">
        Loading history…
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-slate-600">
        <div className="text-3xl opacity-20">📡</div>
        <span className="text-xs font-mono">No broadcasts yet</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end mb-1">
        <button
          onClick={() => void handleClearAll()}
          disabled={clearing}
          className="text-[0.6rem] font-mono px-2 py-1 rounded border border-red-500/20 text-slate-600 hover:text-red-400 hover:border-red-500/40 transition-colors disabled:opacity-40"
        >
          {clearing ? 'Clearing…' : 'Clear history'}
        </button>
      </div>
      {items.map((item) => {
        const isExpanded = expanded.has(item.id)
        const isDeleting = deleting.has(item.id)
        const hasErrors = item.errorCount > 0
        return (
          <div
            key={item.id}
            className="rounded-lg border transition-colors"
            style={{
              borderColor: hasErrors ? 'rgba(239,68,68,0.2)' : 'rgba(0,245,255,0.1)',
              background: isExpanded ? 'rgba(0,245,255,0.03)' : 'rgba(0,245,255,0.01)',
            }}
          >
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer"
              onClick={() => toggleExpand(item.id)}
            >
              <span
                className="text-[0.5rem] font-mono text-slate-500 transition-transform shrink-0"
                style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block' }}
              >▶</span>
              <span className="text-[0.6rem] font-mono text-slate-500 shrink-0">
                {new Date(item.ts).toLocaleString()}
              </span>
              <span className="text-xs font-mono text-slate-300 flex-1 truncate">
                {item.message.slice(0, 80)}{item.message.length > 80 ? '…' : ''}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[0.6rem] font-mono text-green-400">{item.sentCount} sent</span>
                {hasErrors && <span className="text-[0.6rem] font-mono text-red-400">{item.errorCount} err</span>}
                <span className="text-[0.6rem] font-mono text-slate-600">{item.targets.length} targets</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onResend(item.message, item.targets) }}
                className="text-[0.6rem] font-mono text-slate-600 hover:text-cyber-cyan transition-colors px-1.5 py-0.5 rounded border border-transparent hover:border-cyber-cyan/30"
                title="Re-send"
              >
                ↺
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); void handleDelete(item.id) }}
                disabled={isDeleting}
                className="text-[0.6rem] font-mono text-slate-700 hover:text-red-400 transition-colors disabled:opacity-40 px-1"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
            {isExpanded && (
              <div className="px-4 pb-4 border-t border-cyber-cyan/6 pt-3 flex flex-col gap-3">
                <div>
                  <p className="text-[0.55rem] font-mono text-slate-600 uppercase tracking-wider mb-1">Message</p>
                  <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap break-words rounded p-2"
                    style={{ background: 'rgba(255,255,255,0.03)' }}>
                    {item.message}
                  </pre>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-[0.55rem] font-mono text-slate-600 uppercase tracking-wider mb-1">
                      Targets ({item.targets.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {item.targets.map((slug) => (
                        <span
                          key={slug}
                          className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded"
                          style={{ border: '1px solid rgba(0,245,255,0.2)', color: '#00F5FF', background: 'rgba(0,245,255,0.06)' }}
                        >
                          {slug}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => onResend(item.message, item.targets)}
                    className="text-[0.6rem] font-mono px-2.5 py-1.5 rounded border transition-colors shrink-0"
                    style={{ borderColor: 'rgba(0,245,255,0.25)', color: '#00F5FF', background: 'rgba(0,245,255,0.06)' }}
                  >
                    ↺ Re-send
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
      {nextCursor && (
        <button
          onClick={() => loadHistory(nextCursor)}
          className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors py-2 text-center border border-slate-800 rounded"
        >
          Load more
        </button>
      )}
    </div>
  )
}

export default function BroadcastPage() {
  const [fleet, setFleet] = useState<FleetResponse | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [delivery, setDelivery] = useState<DeliveryRow[] | null>(null)
  const [sending, setSending] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [tab, setTab] = useState<Tab>('send')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch('/api/fleet')
      .then((r) => r.json())
      .then((d: FleetResponse) => setFleet(d))
      .catch(() => {})
  }, [])

  function applyPreset(filter: (p: FleetProject) => boolean) {
    const slugs = (fleet?.projects ?? []).filter(filter).map((p) => p.slug)
    setSelected(new Set(slugs))
  }

  function toggleSlug(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  function previewMessage(slug: string): string {
    return message.replace(/\{\{slug\}\}/g, slug)
  }

  async function sendBroadcast() {
    const slugs = [...selected]
    setDelivery(slugs.map((slug) => ({ slug, status: 'queued' })))
    setSending(true)
    setShowConfirm(false)

    try {
      const res = await fetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slugs, message }),
      })
      const data = await res.json() as { results?: Array<{ slug: string; status: 'sent' | 'error'; error?: string }> }

      if (data.results) {
        setDelivery(
          data.results.map((r) => ({
            slug: r.slug,
            status: r.status as DeliveryStatus,
            error: r.error,
          }))
        )
      }
    } catch (err) {
      setDelivery(slugs.map((slug) => ({ slug, status: 'error', error: (err as Error).message })))
    } finally {
      setSending(false)
    }
  }

  function handleSend() {
    if (selected.size >= 5) {
      setShowConfirm(true)
    } else {
      void sendBroadcast()
    }
  }

  function handleResend(resendMessage: string, targets: string[]) {
    setMessage(resendMessage)
    if (fleet) {
      const validSlugs = new Set(fleet.projects.map((p) => p.slug))
      setSelected(new Set(targets.filter((s) => validSlugs.has(s))))
    } else {
      setSelected(new Set(targets))
    }
    setTab('send')
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const canSend = selected.size > 0 && message.trim().length > 0 && !sending

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-4">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            BROADCAST
          </h1>
          {fleet && (
            <span className="text-[0.6rem] font-mono text-slate-500">
              {fleet.projects.length} projects
            </span>
          )}
          <div className="flex-1" />
          {/* Tab switcher */}
          <div className="flex gap-1">
            {(['send', 'history'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="text-[0.6rem] font-mono px-2.5 py-1 rounded uppercase tracking-wider transition-colors"
                style={{
                  border: `1px solid ${tab === t ? '#00F5FF40' : '#334155'}`,
                  color: tab === t ? '#00F5FF' : '#64748b',
                  background: tab === t ? 'rgba(0,245,255,0.08)' : 'transparent',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </header>

      {tab === 'send' ? (
        <main className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-6xl mx-auto w-full">
          {/* Left: Project selector */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-mono text-slate-400 uppercase tracking-wider">Recipients</h2>
              <div className="flex gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(p.filter)}
                    className="text-[0.6rem] font-mono px-2 py-1 rounded border border-cyber-cyan/20 text-slate-400 hover:text-cyber-cyan hover:border-cyber-cyan/40 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div
              className="flex-1 rounded-lg border border-slate-800 overflow-y-auto"
              style={{ background: 'rgba(0,245,255,0.02)', maxHeight: 380 }}
            >
              {!fleet ? (
                <div className="flex items-center justify-center h-32 text-xs font-mono text-slate-600">Loading…</div>
              ) : fleet.projects.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-xs font-mono text-slate-600">No projects</div>
              ) : (
                fleet.projects.map((p) => {
                  const isSelected = selected.has(p.slug)
                  return (
                    <button
                      key={p.slug}
                      onClick={() => toggleSlug(p.slug)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left border-b border-slate-800/60 last:border-0 transition-colors"
                      style={{ background: isSelected ? 'rgba(0,245,255,0.05)' : 'transparent' }}
                    >
                      <div
                        className="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors"
                        style={{
                          borderColor: isSelected ? '#00F5FF' : '#334155',
                          background: isSelected ? '#00F5FF20' : 'transparent',
                        }}
                      >
                        {isSelected && <span className="text-[0.5rem] text-cyber-cyan font-bold">✓</span>}
                      </div>
                      <span className="text-xs font-mono text-slate-300 flex-1">{p.slug}</span>
                      <span
                        className="text-[0.55rem] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{
                          color: STATE_COLORS[p.state],
                          border: `1px solid ${STATE_COLORS[p.state]}40`,
                          background: `${STATE_COLORS[p.state]}12`,
                        }}
                      >
                        {p.state}
                      </span>
                    </button>
                  )
                })
              )}
            </div>

            <div className="text-[0.65rem] font-mono text-slate-500">
              {selected.size} of {fleet?.projects.length ?? 0} selected
            </div>
          </div>

          {/* Right: Composer + status */}
          <div className="flex flex-col gap-4">
            <h2 className="text-xs font-mono text-slate-400 uppercase tracking-wider">Message</h2>

            <div className="relative">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Enter message… use {{slug}} for per-project substitution"
                rows={8}
                className="w-full rounded-lg border border-slate-800 bg-transparent text-sm font-mono text-slate-200 placeholder-slate-700 p-3 resize-none focus:outline-none focus:border-cyber-cyan/40 transition-colors"
                style={{ background: 'rgba(0,245,255,0.02)' }}
              />
              {message.includes('{{slug}}') && selected.size > 0 && (
                <div className="mt-2 px-3 py-2 rounded border border-amber-500/20 text-[0.6rem] font-mono text-amber-400/70"
                  style={{ background: 'rgba(245,158,11,0.05)' }}>
                  Preview for <strong>{[...selected][0]}</strong>: {previewMessage([...selected][0])}
                </div>
              )}
            </div>

            <button
              onClick={handleSend}
              disabled={!canSend}
              className="w-full py-2.5 rounded font-mono text-sm font-bold uppercase tracking-widest transition-all"
              style={{
                background: canSend ? 'rgba(0,245,255,0.12)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${canSend ? '#00F5FF40' : '#334155'}`,
                color: canSend ? '#00F5FF' : '#475569',
                cursor: canSend ? 'pointer' : 'not-allowed',
              }}
            >
              {sending ? 'Sending…' : `Send to ${selected.size} project${selected.size !== 1 ? 's' : ''}`}
            </button>

            {/* Delivery status */}
            {delivery && (
              <div className="rounded-lg border border-slate-800 overflow-hidden" style={{ background: 'rgba(0,245,255,0.02)' }}>
                <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
                  <span className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider">Delivery Status</span>
                  <span className="text-[0.6rem] font-mono text-slate-600">
                    {delivery.filter((r) => r.status === 'sent').length}/{delivery.length} sent
                  </span>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {delivery.map((row) => (
                    <div key={row.slug} className="flex items-center gap-3 px-3 py-2 border-b border-slate-800/50 last:border-0">
                      <span className="text-xs font-mono text-slate-400 flex-1">{row.slug}</span>
                      <span
                        className="text-[0.6rem] font-mono font-bold uppercase"
                        style={{
                          color: row.status === 'sent' ? '#4ADE80' : row.status === 'error' ? '#EF4444' : '#F59E0B',
                        }}
                      >
                        {row.status}
                      </span>
                      {row.error && (
                        <span className="text-[0.55rem] font-mono text-slate-600 truncate max-w-[120px]" title={row.error}>
                          {row.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>
      ) : (
        <main className="flex-1 overflow-auto p-6 max-w-4xl mx-auto w-full">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-mono text-slate-400 uppercase tracking-wider">Broadcast History</h2>
            <span className="text-[0.55rem] font-mono text-slate-600">Most recent first · click to expand</span>
          </div>
          <BroadcastHistoryTab onResend={handleResend} />
        </main>
      )}

      {/* Confirm dialog */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="rounded-xl border border-cyber-cyan/20 p-6 max-w-sm w-full mx-4"
            style={{ background: '#0D1421', boxShadow: '0 0 40px rgba(0,245,255,0.1)' }}
          >
            <h3 className="text-sm font-mono font-bold text-slate-200 mb-2">Confirm Broadcast</h3>
            <p className="text-xs font-mono text-slate-400 mb-4">
              Send to <strong className="text-cyber-cyan">{selected.size} projects</strong>?
              This will inject your message into each selected session.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2 rounded border border-slate-700 text-xs font-mono text-slate-400 hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void sendBroadcast()}
                className="flex-1 py-2 rounded text-xs font-mono font-bold text-cyber-cyan transition-colors"
                style={{ background: 'rgba(0,245,255,0.12)', border: '1px solid #00F5FF40' }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-cyber-cyan/8 px-6 py-2">
        <p className="text-[0.55rem] font-mono text-slate-600">
          Broadcast injects message into each project&apos;s active tmux session · {`{{slug}}`} is replaced per-project
        </p>
      </footer>
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { DeepDiveResponse, GoalStatus } from '../app/api/projects/[slug]/deepdive/route'

const GOAL_STATUS_COLORS: Record<GoalStatus['status'], string> = {
  active: '#22D3EE',
  paused: '#F59E0B',
  completed: '#4ADE80',
}

interface Props {
  slug: string
  onClose: () => void
}

export default function DeepDiveDrawer({ slug, onClose }: Props) {
  const [data, setData] = useState<DeepDiveResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [injectText, setInjectText] = useState('[OPERATOR] ')
  const [injectStatus, setInjectStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/projects/${slug}/deepdive`)
      .then((r) => r.json())
      .then((d: DeepDiveResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [slug])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleInject() {
    if (!injectText.trim()) return
    setInjectStatus('sending')
    try {
      const res = await fetch(`/api/inject/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: injectText }),
      })
      setInjectStatus(res.ok ? 'ok' : 'error')
      if (res.ok) setTimeout(() => setInjectStatus('idle'), 2000)
    } catch {
      setInjectStatus('error')
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className="fixed right-0 top-0 h-full z-50 flex flex-col"
        style={{
          width: 480,
          background: '#070e1c',
          borderLeft: '1px solid rgba(34,211,238,0.15)',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-cyber-cyan/12">
          <div>
            <h2
              className="text-sm font-black tracking-widest text-cyber-cyan"
              style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}
            >
              DEEP DIVE
            </h2>
            <p className="text-[0.6rem] font-mono text-slate-500 mt-0.5">{slug}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-cyber-cyan transition-colors text-xl font-bold leading-none"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-cyber-cyan/40 text-xs font-mono animate-pulse">LOADING…</span>
          </div>
        ) : !data ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-red-400/60 text-xs font-mono">FAILED TO LOAD</span>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

            {/* Goal */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[0.6rem] font-mono font-bold tracking-widest text-slate-500 uppercase">Goal</h3>
                {data.goal && (
                  <span
                    className="text-[0.55rem] font-mono font-bold px-2 py-0.5 rounded-full border"
                    style={{
                      color: GOAL_STATUS_COLORS[data.goal.status],
                      borderColor: GOAL_STATUS_COLORS[data.goal.status] + '50',
                      background: GOAL_STATUS_COLORS[data.goal.status] + '12',
                    }}
                  >
                    {data.goal.status.toUpperCase()}
                  </span>
                )}
              </div>
              {data.goal ? (
                <p className="text-[0.7rem] font-mono text-slate-300 leading-relaxed">
                  {data.goal.text}
                </p>
              ) : (
                <p className="text-[0.65rem] font-mono text-slate-600 italic">No GOAL.md found</p>
              )}
            </section>

            {/* Recent Turns */}
            <section>
              <h3 className="text-[0.6rem] font-mono font-bold tracking-widest text-slate-500 uppercase mb-2">Recent Turns</h3>
              {data.turns.length === 0 ? (
                <p className="text-[0.65rem] font-mono text-slate-600 italic">No turns found</p>
              ) : (
                <div className="space-y-2">
                  {data.turns.map((turn, i) => (
                    <div
                      key={i}
                      className="rounded px-3 py-2"
                      style={{
                        background: turn.role === 'human' ? '#0f172a' : '#0a1628',
                        border: `1px solid ${turn.role === 'human' ? '#334155' : 'rgba(34,211,238,0.15)'}`,
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-[0.55rem] font-mono font-bold"
                          style={{ color: turn.role === 'human' ? '#94A3B8' : '#22D3EE' }}
                        >
                          {turn.role.toUpperCase()}
                        </span>
                        {turn.timestamp && (
                          <span className="text-[0.5rem] font-mono text-slate-600">
                            {new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                      <p className="text-[0.65rem] font-mono text-slate-400 leading-relaxed truncate">
                        {turn.text}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Memory */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[0.6rem] font-mono font-bold tracking-widest text-slate-500 uppercase">Memory</h3>
                <Link
                  href={`/knowledge?slug=${slug}`}
                  className="text-[0.55rem] font-mono text-purple-400/60 hover:text-purple-400 transition-colors"
                >
                  View All →
                </Link>
              </div>
              {data.memories.length === 0 ? (
                <p className="text-[0.65rem] font-mono text-slate-600 italic">No memory files found</p>
              ) : (
                <div className="space-y-1.5">
                  {data.memories.map((m, i) => (
                    <div key={i} className="rounded px-3 py-2 bg-purple-950/20 border border-purple-800/20">
                      <p className="text-[0.65rem] font-mono text-purple-300 font-bold">{m.title}</p>
                      <p className="text-[0.6rem] font-mono text-slate-500 mt-0.5 truncate">{m.firstLine}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Proposals */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[0.6rem] font-mono font-bold tracking-widest text-slate-500 uppercase">Active Proposals</h3>
                <Link
                  href={`/pipeline?slug=${slug}`}
                  className="text-[0.55rem] font-mono text-amber-400/60 hover:text-amber-400 transition-colors"
                >
                  View All →
                </Link>
              </div>
              {data.proposals.length === 0 ? (
                <p className="text-[0.65rem] font-mono text-slate-600 italic">No proposals found</p>
              ) : (
                <div className="space-y-1.5">
                  {data.proposals.map((p, i) => (
                    <div key={i} className="rounded px-3 py-2 bg-amber-950/20 border border-amber-800/20">
                      <p className="text-[0.65rem] font-mono text-amber-300 font-bold truncate">{p.title}</p>
                      <p className="text-[0.55rem] font-mono text-slate-600 mt-0.5">{p.status}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Quick Inject */}
            <section>
              <h3 className="text-[0.6rem] font-mono font-bold tracking-widest text-slate-500 uppercase mb-2">Quick Inject</h3>
              <textarea
                value={injectText}
                onChange={(e) => setInjectText(e.target.value)}
                rows={3}
                className="w-full rounded px-3 py-2 text-[0.7rem] font-mono text-slate-300 resize-none outline-none"
                style={{
                  background: '#0f172a',
                  border: '1px solid rgba(34,211,238,0.2)',
                  color: '#cbd5e1',
                }}
                placeholder="[OPERATOR] message to inject…"
              />
              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={handleInject}
                  disabled={injectStatus === 'sending'}
                  className="px-4 py-1.5 rounded text-[0.65rem] font-mono font-bold tracking-wider transition-all"
                  style={{
                    background: injectStatus === 'ok' ? '#4ADE8020' : 'rgba(34,211,238,0.12)',
                    border: `1px solid ${injectStatus === 'ok' ? '#4ADE80' : injectStatus === 'error' ? '#F87171' : 'rgba(34,211,238,0.4)'}`,
                    color: injectStatus === 'ok' ? '#4ADE80' : injectStatus === 'error' ? '#F87171' : '#22D3EE',
                  }}
                >
                  {injectStatus === 'sending' ? 'SENDING…' : injectStatus === 'ok' ? '✓ SENT' : injectStatus === 'error' ? '✗ ERROR' : 'SEND'}
                </button>
                {injectStatus === 'error' && (
                  <span className="text-[0.6rem] font-mono text-red-400/70">Inject endpoint not available</span>
                )}
              </div>
            </section>

          </div>
        )}

        <div className="border-t border-cyber-cyan/10 px-5 py-2 text-[0.55rem] font-mono text-slate-700">
          Press ESC to close
        </div>
      </div>
    </>
  )
}

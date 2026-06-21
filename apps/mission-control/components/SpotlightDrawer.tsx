'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import type { SpotlightResponse } from '../app/api/spotlight/[slug]/route'

const STATE_COLOR: Record<string, string> = {
  idle: '#00F5FF',
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
}

const PHASE_BADGE: Record<string, { label: string; color: string }> = {
  propose: { label: 'PROPOSE', color: '#F59E0B' },
  plan:    { label: 'PLAN',    color: '#3B82F6' },
  build:   { label: 'BUILD',   color: '#F97316' },
  verify:  { label: 'VERIFY',  color: '#A78BFA' },
  pr:      { label: 'PR',      color: '#4ADE80' },
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

function staleness(checkedAt: string): boolean {
  try { return Date.now() - new Date(checkedAt).getTime() > 60000 } catch { return false }
}

export default function SpotlightDrawer() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const slug = searchParams.get('spotlight')
  const [data, setData] = useState<SpotlightResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [stale, setStale] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback((s: string) => {
    setLoading(true)
    fetch(`/api/spotlight/${encodeURIComponent(s)}`)
      .then((r) => r.json())
      .then((d: SpotlightResponse) => { setData(d); setStale(false) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!slug) { setData(null); return }
    load(slug)
    timerRef.current = setInterval(() => {
      load(slug)
      if (data) setStale(staleness(data.checkedAt))
    }, 30000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [slug, load]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('spotlight')
    const qs = params.toString()
    router.push(pathname + (qs ? `?${qs}` : ''))
  }, [router, pathname, searchParams])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && slug) close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slug, close])

  function fireInject() {
    if (!slug) return
    window.dispatchEvent(new CustomEvent('mc:inject', { detail: { slug } }))
  }

  function fireStop() {
    if (!slug) return
    window.dispatchEvent(new CustomEvent('mc:inject', { detail: { slug, initialMessage: '/stop' } }))
    close()
  }

  const stateColor = data ? (STATE_COLOR[data.state] ?? '#64748B') : '#64748B'

  return (
    <AnimatePresence>
      {slug && (
        <>
          {/* backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }}
            onClick={close}
          />

          {/* drawer — right side on desktop, bottom sheet on mobile */}
          <motion.div
            key="drawer"
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed right-0 top-0 bottom-0 z-50 flex flex-col overflow-y-auto"
            style={{
              width: 'min(400px, 100vw)',
              background: '#060d18',
              borderLeft: '1px solid #1e3a5f',
              boxShadow: '-8px 0 40px rgba(0,0,0,0.7)',
            }}
          >
            {/* header */}
            <div
              className="flex items-center justify-between px-4 py-3 sticky top-0 z-10 border-b"
              style={{ background: '#060d18', borderColor: '#1e3a5f' }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: stateColor, boxShadow: `0 0 6px ${stateColor}80` }}
                />
                <span className="font-mono text-sm font-bold" style={{ color: stateColor }}>
                  {slug}
                </span>
                {stale && (
                  <span className="text-[0.55rem] font-mono px-1 rounded" style={{ background: '#1e3a5f', color: '#F59E0B' }}>
                    STALE
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {loading && <span className="text-[0.6rem] font-mono" style={{ color: '#334155' }}>↻</span>}
                <button
                  onClick={close}
                  className="text-xs font-mono rounded px-1.5 py-0.5 border transition-colors"
                  style={{ color: '#64748B', borderColor: '#1e3a5f', background: 'transparent' }}
                >
                  ✕
                </button>
              </div>
            </div>

            {data && (
              <div className="flex flex-col gap-4 p-4 flex-1">
                {/* goal */}
                {data.goalText && (
                  <Section title="Goal" icon="◎">
                    <p className="text-[0.7rem] font-mono" style={{ color: '#94A3B8' }}>{data.goalText}</p>
                  </Section>
                )}

                {/* specclaw */}
                {data.specclaw && (
                  <Section title="Active Change" icon="⬒">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[0.7rem] font-mono" style={{ color: '#CBD5E1' }}>
                        {data.specclaw.changeName}
                      </span>
                      {(() => {
                        const badge = PHASE_BADGE[data.specclaw!.phase]
                        return badge ? (
                          <span
                            className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded"
                            style={{ background: `${badge.color}20`, color: badge.color, border: `1px solid ${badge.color}40` }}
                          >
                            {badge.label}
                          </span>
                        ) : null
                      })()}
                    </div>
                    {data.specclaw.tasksTotal > 0 && (
                      <div className="mt-1.5">
                        <div className="flex justify-between text-[0.55rem] font-mono mb-1" style={{ color: '#475569' }}>
                          <span>tasks</span>
                          <span>{data.specclaw.tasksDone}/{data.specclaw.tasksTotal}</span>
                        </div>
                        <div className="h-1 rounded-full overflow-hidden" style={{ background: '#0d1525' }}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.round(data.specclaw.tasksDone / Math.max(1, data.specclaw.tasksTotal) * 100)}%`,
                              background: '#A78BFA',
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </Section>
                )}

                {/* transcript */}
                {data.transcriptEntries.length > 0 && (
                  <Section title="Recent Transcript" icon="≡">
                    <div className="flex flex-col gap-1.5">
                      {data.transcriptEntries.map((e, i) => (
                        <div key={i} className="rounded px-2 py-1.5" style={{ background: '#0a1020' }}>
                          <div
                            className="text-[0.55rem] font-mono uppercase tracking-widest mb-0.5"
                            style={{ color: e.role === 'assistant' ? '#22D3EE' : '#64748B' }}
                          >
                            {e.role}
                          </div>
                          <div className="text-[0.65rem] font-mono leading-relaxed" style={{ color: '#94A3B8' }}>
                            {e.content.length > 180 ? e.content.slice(0, 180) + '…' : e.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* memory */}
                <Section title={`Memory (${data.memoryCount})`} icon="💭">
                  {data.memories.length === 0 ? (
                    <div className="text-[0.65rem] font-mono" style={{ color: '#334155' }}>no memories</div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {data.memories.map((m, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-[0.65rem] font-mono">
                          <span style={{ color: '#A855F7' }}>◈</span>
                          <span style={{ color: '#94A3B8' }}>{m.content}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                {/* git */}
                {data.git.branch && (
                  <Section title="Git" icon="⎇">
                    <div className="text-[0.65rem] font-mono space-y-0.5">
                      <div><span style={{ color: '#475569' }}>branch: </span><span style={{ color: '#22D3EE' }}>{data.git.branch}</span></div>
                      {data.git.lastCommitSha && (
                        <div>
                          <span style={{ color: '#475569' }}>commit: </span>
                          <span style={{ color: '#4ADE80' }}>{data.git.lastCommitSha}</span>
                          {data.git.lastCommitMessage && (
                            <span style={{ color: '#64748B' }}> — {data.git.lastCommitMessage.slice(0, 60)}</span>
                          )}
                        </div>
                      )}
                      {data.git.lastCommitDate && (
                        <div style={{ color: '#334155' }}>{fmtDate(data.git.lastCommitDate)}</div>
                      )}
                    </div>
                  </Section>
                )}

                {/* schedules */}
                {data.schedules.length > 0 && (
                  <Section title="Schedules" icon="⏱">
                    <div className="flex flex-col gap-1.5">
                      {data.schedules.map((s) => (
                        <div key={s.id} className="rounded px-2 py-1.5 text-[0.65rem] font-mono" style={{ background: '#0a1020' }}>
                          <div className="flex items-center gap-1.5">
                            <span style={{ color: s.enabled ? '#4ADE80' : '#334155' }}>●</span>
                            <span style={{ color: '#94A3B8' }}>{s.at}</span>
                            {s.lastRunAt && (
                              <span style={{ color: '#334155' }}>· last {fmtDate(s.lastRunAt)}</span>
                            )}
                          </div>
                          <div className="mt-0.5" style={{ color: '#475569' }}>{s.prompt}</div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* quick actions */}
                <div className="flex gap-2 mt-auto pt-2 border-t" style={{ borderColor: '#1e3a5f' }}>
                  <button
                    onClick={fireInject}
                    className="flex-1 text-xs font-mono rounded px-3 py-2 border transition-colors"
                    style={{ borderColor: '#22D3EE40', color: '#22D3EE', background: '#22D3EE10' }}
                  >
                    ⌨ Inject
                  </button>
                  <button
                    onClick={fireStop}
                    className="flex-1 text-xs font-mono rounded px-3 py-2 border transition-colors"
                    style={{ borderColor: '#EF444440', color: '#EF4444', background: '#EF444410' }}
                  >
                    ⏹ Stop
                  </button>
                </div>
              </div>
            )}

            {!data && !loading && slug && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-[0.65rem] font-mono text-center" style={{ color: '#334155' }}>
                  <div className="text-2xl mb-2">◎</div>
                  no data for <span style={{ color: '#22D3EE' }}>{slug}</span>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="flex items-center gap-1.5 text-[0.6rem] font-mono uppercase tracking-widest mb-1.5"
        style={{ color: '#334155' }}
      >
        <span>{icon}</span>
        <span>{title}</span>
      </div>
      {children}
    </div>
  )
}

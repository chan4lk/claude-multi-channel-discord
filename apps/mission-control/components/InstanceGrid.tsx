'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PulseRing from './ui/PulseRing'
import Sparkline from './ui/Sparkline'
import TokenBudgetGauge from './TokenBudgetGauge'
import HealthScoreRing from './HealthScoreRing'
import type { FleetProject } from '../app/api/fleet/route'
import type { HealthScore } from '../app/api/health/[slug]/route'

interface InstanceEntry {
  instance_id: string
  host: string
  user: string
  api_key: string
  last_seen: string | null
  created_at: string
  activeSlugs: string[]
  lastActivity: string | null
}

interface EventEntry {
  id: string
  ts: number
  type: string
  instance_id: string
  payload: Record<string, unknown>
}

interface Props {
  events?: EventEntry[]
  filterSlugs?: Set<string> | null
  fleetProjects?: FleetProject[]
}

type Status = 'active' | 'stale' | 'stuck'

function getStatus(lastSeen: string | null, stuckInstances: Set<string>, instanceId: string): Status {
  if (stuckInstances.has(instanceId)) return 'stuck'
  if (!lastSeen) return 'stale'
  return Date.now() - new Date(lastSeen).getTime() < 5 * 60 * 1000 ? 'active' : 'stale'
}

function formatRelative(ts: string | null): string {
  if (!ts) return 'never'
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function getSparklineData(instanceId: string, events: EventEntry[]): number[] {
  const now = Date.now()
  const buckets = new Array(6).fill(0)
  for (const ev of events) {
    if (ev.instance_id !== instanceId) continue
    const age = now - ev.ts
    if (age > 60_000) continue
    const bucket = Math.floor(age / 10_000)
    if (bucket < 6) buckets[5 - bucket]++
  }
  return buckets
}

interface WatchdogBadgeProps {
  slug: string
  fleetProjects: FleetProject[]
}

function WatchdogBadge({ slug, fleetProjects }: WatchdogBadgeProps) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(id)
  }, [])

  const project = fleetProjects.find((p) => p.slug === slug)
  if (!project || project.state !== 'active') return null

  const thresholdMs = project.stuckThresholdMinutes * 60_000
  const ageMs = project.ageMins * 60_000
  const remainingMs = thresholdMs - ageMs
  if (remainingMs <= 0) return null

  const remainingMins = Math.ceil(remainingMs / 60_000)
  const pct = remainingMs / thresholdMs

  let color: string
  if (pct > 0.5) color = '#4ADE80'
  else if (pct > 0.2) color = '#F59E0B'
  else color = '#EF4444'

  const pulse = pct < 0.2

  return (
    <span
      className={`text-[0.55rem] font-mono px-1 py-0.5 rounded shrink-0 ${pulse ? 'animate-pulse' : ''}`}
      style={{ color, border: `1px solid ${color}40`, background: `${color}15` }}
      title={`Watchdog fires in ~${remainingMins}m (threshold: ${project.stuckThresholdMinutes}m)`}
    >
      ⏱{remainingMins}m
    </span>
  )
}

function SlugAnnotation({ slug }: { slug: string }) {
  const [note, setNote] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch(`/api/projects/${slug}/annotation`)
      .then((r) => r.json())
      .then((d: { note: string | null }) => setNote(d.note ?? null))
      .catch(() => {})
  }, [slug])

  const save = useCallback(async (value: string) => {
    const trimmed = value.trim()
    await fetch(`/api/projects/${slug}/annotation`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: trimmed }),
    })
    setNote(trimmed || null)
    setEditing(false)
  }, [slug])

  if (editing) {
    return (
      <div className="mt-1">
        <textarea
          ref={inputRef}
          autoFocus
          className="w-full text-[0.6rem] font-mono bg-slate-900/80 border border-cyber-cyan/30 rounded px-2 py-1 text-slate-300 resize-none outline-none focus:border-cyber-cyan/60"
          rows={2}
          maxLength={500}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => save(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(draft) }
            if (e.key === 'Escape') { setEditing(false) }
          }}
          placeholder="Add a note… (Enter to save, Esc to cancel)"
        />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 mt-0.5">
      {note && (
        <span className="text-[0.6rem] font-mono text-slate-500 truncate max-w-[120px]" title={note}>
          {note.slice(0, 60)}{note.length > 60 ? '…' : ''}
        </span>
      )}
      <button
        onClick={() => { setDraft(note ?? ''); setEditing(true) }}
        className="text-[0.55rem] text-slate-600 hover:text-cyber-cyan transition-colors shrink-0"
        title={note ? 'Edit note' : 'Add note'}
      >
        {note ? '✎' : '＋'}
      </button>
    </div>
  )
}

export default function InstanceGrid({ events = [], filterSlugs = null, fleetProjects = [] }: Props) {
  const [instances, setInstances] = useState<InstanceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [healthScores, setHealthScores] = useState<Record<string, HealthScore>>({})

  const stuckInstances = new Set<string>(
    events
      .filter((e) => e.type === 'watchdog' && typeof e.payload['killed'] === 'boolean' && e.payload['killed'])
      .map((e) => e.instance_id)
  )

  async function fetchInstances() {
    try {
      const res = await fetch('/api/instances')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setInstances(await res.json())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load instances')
    } finally {
      setLoading(false)
    }
  }

  async function fetchHealth() {
    try {
      const res = await fetch('/api/health')
      if (!res.ok) return
      const data = await res.json() as { projects: HealthScore[] }
      const map: Record<string, HealthScore> = {}
      for (const h of data.projects) map[h.slug] = h
      setHealthScores(map)
    } catch { /* non-critical */ }
  }

  useEffect(() => {
    fetchInstances()
    fetchHealth()
    const interval = setInterval(() => { fetchInstances(); fetchHealth() }, 30_000)
    return () => clearInterval(interval)
  }, [])

  if (loading) return <div className="text-slate-500 text-sm py-4 text-center">Loading instances…</div>
  if (error) return <div className="text-cyber-crimson text-sm py-4 text-center">Error: {error}</div>
  if (instances.length === 0) return <div className="text-slate-500 text-sm py-4 text-center">No instances registered.</div>

  const visibleInstances = filterSlugs
    ? instances.filter((inst) => inst.activeSlugs?.some((slug) => filterSlugs.has(slug)))
    : instances

  if (visibleInstances.length === 0 && filterSlugs) {
    return <div className="text-slate-500 text-sm py-4 text-center">No instances active for this fleet state.</div>
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      <AnimatePresence>
        {visibleInstances.map((inst) => {
          const status = getStatus(inst.last_seen, stuckInstances, inst.instance_id)
          const sparkData = getSparklineData(inst.instance_id, events)
          return (
            <motion.div
              key={inst.instance_id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
            >
              <PulseRing status={status}>
                <GlassCard className="px-4 py-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-sm font-bold text-cyber-cyan truncate"
                      title={inst.host}
                      style={{ fontFamily: 'JetBrains Mono, monospace' }}
                    >
                      {inst.host}
                    </span>
                    <span
                      className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-semibold ${
                        status === 'active'
                          ? 'bg-cyber-cyan/10 text-cyber-cyan'
                          : status === 'stuck'
                          ? 'bg-cyber-crimson/20 text-cyber-crimson'
                          : 'bg-slate-700 text-slate-400'
                      }`}
                    >
                      {inst.lastActivity ? inst.lastActivity.replace(/_/g, ' ') : status}
                    </span>
                  </div>
                  {inst.activeSlugs && inst.activeSlugs.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {inst.activeSlugs.slice(0, 3).map((slug) => (
                        <div key={slug} className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1">
                          <button
                            title={`Inject into ${slug}`}
                            onClick={() => window.dispatchEvent(new CustomEvent('mc:inject', { detail: { slug } }))}
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyber-cyan/10 text-cyber-cyan/70 border border-cyber-cyan/20 hover:bg-cyber-cyan/20 hover:text-cyber-cyan transition-colors cursor-pointer"
                          >
                            {slug} ⟳
                          </button>
                          {fleetProjects.length > 0 && (
                            <WatchdogBadge slug={slug} fleetProjects={fleetProjects} />
                          )}
                          {(() => {
                            const fleetProject = fleetProjects.find((p) => p.slug === slug)
                            const health = healthScores[slug]
                            return (
                              <>
                                {fleetProject?.monthlyTokenBudget && (
                                  <TokenBudgetGauge
                                    used={fleetProject.monthlyTokensUsed ?? 0}
                                    budget={fleetProject.monthlyTokenBudget}
                                    size={28}
                                  />
                                )}
                                {health && (
                                  <HealthScoreRing
                                    score={health.score}
                                    insufficientData={health.insufficientData}
                                    recency={health.recency}
                                    stallRate={health.stallRate}
                                    efficiency={health.efficiency}
                                    freshness={health.freshness}
                                    size={28}
                                  />
                                )}
                              </>
                            )
                          })()}
                          </div>
                          <SlugAnnotation slug={slug} />
                        </div>
                      ))}
                      {inst.activeSlugs.length > 3 && (
                        <span className="text-[10px] text-slate-600">
                          +{inst.activeSlugs.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                  <span className="text-xs text-slate-400 truncate" title={inst.user}>
                    {inst.user || '—'}
                  </span>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-slate-600 font-mono" title={inst.instance_id}>
                      {inst.instance_id.slice(0, 8)}
                    </span>
                    <Sparkline data={sparkData} width={72} height={20} />
                    <span className="text-xs text-slate-500">
                      {formatRelative(inst.last_seen)}
                    </span>
                  </div>
                </GlassCard>
              </PulseRing>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

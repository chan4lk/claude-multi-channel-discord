'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PulseRing from './ui/PulseRing'
import Sparkline from './ui/Sparkline'

interface FleetProjectData {
  slug: string
  state: string
  lastReplyMs: number | null
  stuckThresholdMinutes: number
}

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
}

type Status = 'active' | 'stale' | 'stuck'

function WatchdogBadge({ lastReplyMs, stuckThresholdMinutes }: { lastReplyMs: number; stuckThresholdMinutes: number }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const thresholdMs = stuckThresholdMinutes * 60_000
  const remaining = thresholdMs - (now - lastReplyMs)
  if (remaining <= 0) return null

  const pct = remaining / thresholdMs
  const totalSecs = Math.ceil(remaining / 1000)
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  const label = `${mins}:${String(secs).padStart(2, '0')}`

  const color =
    pct < 0.2
      ? 'text-cyber-crimson animate-pulse'
      : pct < 0.5
      ? 'text-amber-400'
      : 'text-cyber-cyan/60'

  return (
    <span
      className={`text-[9px] font-mono shrink-0 ${color}`}
      title={`Watchdog: ${label} remaining`}
    >
      ⏱{label}
    </span>
  )
}

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

export default function InstanceGrid({ events = [], filterSlugs = null }: Props) {
  const [instances, setInstances] = useState<InstanceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fleetMap, setFleetMap] = useState<Map<string, FleetProjectData>>(new Map())

  // Track instances that received watchdog/kill events
  const stuckInstances = new Set<string>(
    events
      .filter((e) => e.type === 'watchdog' && typeof e.payload['killed'] === 'boolean' && e.payload['killed'])
      .map((e) => e.instance_id)
  )

  async function fetchFleet() {
    try {
      const res = await fetch('/api/fleet')
      if (!res.ok) return
      const data = await res.json()
      const map = new Map<string, FleetProjectData>()
      for (const p of (data.projects ?? []) as FleetProjectData[]) {
        map.set(p.slug, p)
      }
      setFleetMap(map)
    } catch {}
  }

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

  useEffect(() => {
    fetchInstances()
    fetchFleet()
    const interval = setInterval(() => { fetchInstances(); fetchFleet() }, 30_000)
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
                      {inst.activeSlugs.slice(0, 3).map((slug) => {
                        const fp = fleetMap.get(slug)
                        const showBadge = fp?.state === 'active' && fp.lastReplyMs !== null
                        return (
                          <div key={slug} className="flex items-center gap-1">
                            <button
                              title={`Inject into ${slug}`}
                              onClick={() => window.dispatchEvent(new CustomEvent('mc:inject', { detail: { slug } }))}
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyber-cyan/10 text-cyber-cyan/70 border border-cyber-cyan/20 hover:bg-cyber-cyan/20 hover:text-cyber-cyan transition-colors cursor-pointer"
                            >
                              {slug} ⟳
                            </button>
                            {showBadge && (
                              <WatchdogBadge lastReplyMs={fp!.lastReplyMs!} stuckThresholdMinutes={fp!.stuckThresholdMinutes} />
                            )}
                          </div>
                        )
                      })}
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

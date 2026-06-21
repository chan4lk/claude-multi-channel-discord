'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PulseRing from './ui/PulseRing'
import Sparkline from './ui/Sparkline'
import TokenBudgetGauge from './TokenBudgetGauge'
import HealthScoreRing from './HealthScoreRing'
import type { FleetProject } from '../app/api/fleet/route'
import type { HealthScore } from '../app/api/health/[slug]/route'

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

interface MemoryModalProps {
  slug: string
  onClose: () => void
}

function MemoryModal({ slug, onClose }: MemoryModalProps) {
  const [content, setContent] = useState<string | null>(null)
  const [sizeBytes, setSizeBytes] = useState(0)
  const [lastModified, setLastModified] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [distilling, setDistilling] = useState(false)
  const [distillMsg, setDistillMsg] = useState<string | null>(null)

  function load() {
    setLoading(true)
    fetch(`/api/memory/${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d: { content?: string; sizeBytes?: number; lastModified?: string; error?: string }) => {
        if (d.error) { setContent(null) } else {
          setContent(d.content ?? '')
          setSizeBytes(d.sizeBytes ?? 0)
          setLastModified(d.lastModified ?? null)
        }
      })
      .catch(() => setContent(null))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [slug])

  async function distill() {
    setDistilling(true)
    setDistillMsg(null)
    try {
      const r = await fetch(`/api/memory/${encodeURIComponent(slug)}/distill`, { method: 'POST' })
      const d = await r.json() as { ok?: boolean; error?: string; content?: string; sizeBytes?: number; lastModified?: string; durationMs?: number }
      if (d.ok) {
        setDistillMsg(`✓ Distilled in ${((d.durationMs ?? 0) / 1000).toFixed(1)}s`)
        if (d.content) {
          setContent(d.content)
          setSizeBytes(d.sizeBytes ?? 0)
          setLastModified(d.lastModified ?? null)
        } else {
          load()
        }
      } else {
        setDistillMsg(`✗ ${d.error ?? 'failed'}`)
      }
    } catch (e) {
      setDistillMsg(`✗ ${e instanceof Error ? e.message : 'network error'}`)
    } finally {
      setDistilling(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-lg border"
        style={{ background: '#0f172a', borderColor: '#a78bfa40' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#a78bfa20' }}>
          <div className="flex items-center gap-2">
            <span style={{ color: '#a78bfa' }} className="text-sm font-mono font-bold">💭 {slug}/MEMORY.md</span>
            {sizeBytes > 0 && (
              <span className="text-[0.6rem] font-mono text-slate-500">{fmtBytes(sizeBytes)}</span>
            )}
            {lastModified && (
              <span className="text-[0.6rem] font-mono text-slate-600" title={lastModified}>
                · {new Date(lastModified).toLocaleDateString()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {distillMsg && (
              <span className={`text-[0.65rem] font-mono ${distillMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>
                {distillMsg}
              </span>
            )}
            <button
              onClick={distill}
              disabled={distilling}
              className="text-[0.65rem] font-mono px-2 py-1 rounded border transition-colors disabled:opacity-50"
              style={{ color: '#a78bfa', borderColor: '#a78bfa40', background: '#a78bfa15' }}
            >
              {distilling ? '⏳ Distilling…' : '✦ Distill now'}
            </button>
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-300 text-lg leading-none px-1"
            >
              ×
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="text-slate-500 text-sm text-center py-8">Loading…</div>
          ) : content === null ? (
            <div className="text-slate-500 text-sm text-center py-8">MEMORY.md not found</div>
          ) : (
            <pre className="text-[0.7rem] font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">{content}</pre>
          )}
        </div>
      </motion.div>
    </div>
  )
}

function SpotlightButton({ slug }: { slug: string }) {
  const router = useRouter()
  function open(e: React.MouseEvent) {
    e.stopPropagation()
    router.push(`?spotlight=${encodeURIComponent(slug)}`)
  }
  return (
    <button
      title={`Spotlight ${slug}`}
      onClick={open}
      className="text-[10px] font-mono px-1 py-0.5 rounded transition-colors"
      style={{ color: 'rgb(168 139 250 / 0.5)', background: 'transparent', lineHeight: 1 }}
    >
      ◎
    </button>
  )
}

function MemoryChip({ slug, sizeBytes }: { slug: string; sizeBytes: number }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        title={`MEMORY.md · ${fmtBytes(sizeBytes)} — click to view`}
        onClick={() => setOpen(true)}
        className="text-[0.55rem] font-mono px-1 py-0.5 rounded shrink-0 transition-colors"
        style={{ color: '#a78bfa', background: '#a78bfa15', border: '1px solid #a78bfa40' }}
      >
        💭{fmtBytes(sizeBytes)}
      </button>
      <AnimatePresence>
        {open && <MemoryModal slug={slug} onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  )
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

function ContextUsageGauge({ pct, size }: { pct: number; size: number }) {
  const r = (size - 4) / 2
  const circ = 2 * Math.PI * r
  const stroke = circ * (1 - pct / 100)
  const color = pct >= 90 ? '#EF4444' : pct >= 80 ? '#F59E0B' : '#A78BFA'
  return (
    <span title={`Context: ${pct}% full`} className="relative cursor-default">
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={3} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={3}
          strokeDasharray={circ} strokeDashoffset={stroke}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-[0.45rem] font-bold font-mono"
        style={{ color, transform: 'none' }}
      >
        {pct}
      </span>
    </span>
  )
}

function ContextFillEtaBadge({ etaMinutes, tokensPerTurn, headroom }: { etaMinutes: number; tokensPerTurn?: number; headroom?: number }) {
  const color = etaMinutes < 20 ? '#EF4444' : etaMinutes < 60 ? '#F59E0B' : '#4ADE80'
  let label: string
  if (etaMinutes >= 60) {
    const h = Math.floor(etaMinutes / 60)
    const m = etaMinutes % 60
    label = m > 0 ? `ctx ~${h}h ${m}m` : `ctx ~${h}h`
  } else {
    label = `ctx ~${etaMinutes}m`
  }
  const tooltip = tokensPerTurn != null && headroom != null
    ? `Context fill ETA: ${label}\nVelocity: ${tokensPerTurn.toLocaleString()} tokens/turn\nHeadroom: ${headroom.toLocaleString()} tokens`
    : `Context fill ETA: ${label}`
  return (
    <span
      title={tooltip}
      className="text-[0.5rem] font-mono font-bold px-1 py-0.5 rounded border cursor-default"
      style={{ color, borderColor: `${color}40`, background: `${color}12` }}
    >
      ⏱ {label}
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

const GOAL_STATUS_COLORS: Record<string, string> = {
  active: '#a78bfa',
  paused: '#94a3b8',
  completed: '#4ADE80',
}

type GoalStatus = 'active' | 'paused' | 'completed'

function GoalChip({ slug, initialText, initialStatus }: { slug: string; initialText?: string; initialStatus?: GoalStatus }) {
  const [goalText, setGoalText] = useState<string | null>(initialText ?? null)
  const [goalStatus, setGoalStatus] = useState<GoalStatus>(initialStatus ?? 'active')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftStatus, setDraftStatus] = useState<GoalStatus>('active')

  useEffect(() => {
    fetch(`/api/projects/${encodeURIComponent(slug)}/goal`)
      .then((r) => r.json())
      .then((d: { goalText: string | null; goalStatus: GoalStatus | null }) => {
        setGoalText(d.goalText ?? null)
        setGoalStatus(d.goalStatus ?? 'active')
      })
      .catch(() => {})
  }, [slug])

  const save = useCallback(async () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      await fetch(`/api/projects/${encodeURIComponent(slug)}/goal`, { method: 'DELETE' })
      setGoalText(null)
    } else {
      await fetch(`/api/projects/${encodeURIComponent(slug)}/goal`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, status: draftStatus }),
      })
      setGoalText(trimmed)
      setGoalStatus(draftStatus)
    }
    setEditing(false)
  }, [slug, draft, draftStatus])

  const openEditor = useCallback(() => {
    setDraft(goalText ?? '')
    setDraftStatus(goalStatus)
    setEditing(true)
  }, [goalText, goalStatus])

  if (editing) {
    const statuses: GoalStatus[] = ['active', 'paused', 'completed']
    return (
      <div className="mt-0.5 flex flex-col gap-1">
        <textarea
          autoFocus
          className="w-full text-[0.6rem] font-mono bg-slate-900/80 border border-purple-500/30 rounded px-2 py-1 text-slate-300 resize-none outline-none focus:border-purple-500/60"
          rows={2}
          maxLength={500}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save() }
            if (e.key === 'Escape') { setEditing(false) }
          }}
          placeholder="Goal… (Enter=save, blank=delete)"
        />
        <div className="flex items-center gap-1">
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setDraftStatus(s)}
              className="text-[0.5rem] font-mono px-1.5 py-0.5 rounded transition-colors"
              style={draftStatus === s
                ? { color: GOAL_STATUS_COLORS[s], background: `${GOAL_STATUS_COLORS[s]}20`, border: `1px solid ${GOAL_STATUS_COLORS[s]}60` }
                : { color: '#64748b', background: 'transparent', border: '1px solid #64748b40' }
              }
            >
              {s}
            </button>
          ))}
          <button
            onClick={() => void save()}
            className="text-[0.5rem] font-mono px-1.5 py-0.5 rounded ml-auto transition-colors"
            style={{ color: '#4ADE80', background: '#4ADE8015', border: '1px solid #4ADE8040' }}
          >
            save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="text-[0.5rem] font-mono text-slate-600 hover:text-slate-400 px-1 transition-colors"
          >
            esc
          </button>
        </div>
      </div>
    )
  }

  const color = GOAL_STATUS_COLORS[goalStatus] ?? GOAL_STATUS_COLORS.active

  return (
    <div className="flex items-center gap-1 mt-0.5">
      {goalText && (
        <span
          className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded truncate max-w-[120px]"
          style={{ color, background: `${color}15`, border: `1px solid ${color}30` }}
          title={`Goal (${goalStatus}): ${goalText}`}
        >
          🎯 {goalText.slice(0, 35)}{goalText.length > 35 ? '…' : ''}
        </span>
      )}
      <button
        onClick={openEditor}
        className="text-[0.55rem] text-slate-600 hover:text-cyber-cyan transition-colors shrink-0"
        title={goalText ? 'Edit goal' : 'Add goal'}
      >
        {goalText ? '✎' : '🎯'}
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
                          {(() => {
                            const fp = fleetProjects.find((p) => p.slug === slug)
                            const bs = fp?.budgetStatus
                            const budgetColor = bs === 'exhausted' ? '#94a3b8'
                              : bs === 'critical' ? '#EF4444'
                              : bs === 'warning' ? '#F59E0B'
                              : null
                            const budgetTitle = bs === 'exhausted' ? 'Budget exhausted — messages queued'
                              : bs === 'critical' ? 'Budget critical (≥80%)'
                              : bs === 'warning' ? 'Budget warning (≥50%)'
                              : `Inject into ${slug}`
                            return (
                              <>
                                <button
                                  title={budgetTitle + ' (Ctrl+click: audit log)'}
                                  onClick={(e) => {
                                    if (e.ctrlKey || e.metaKey) {
                                      window.open(`/audit?slug=${encodeURIComponent(slug)}`, '_blank')
                                    } else {
                                      window.dispatchEvent(new CustomEvent('mc:inject', { detail: { slug } }))
                                    }
                                  }}
                                  className="text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors cursor-pointer"
                                  style={budgetColor
                                    ? { color: budgetColor, background: `${budgetColor}20`, border: `1px solid ${budgetColor}50` }
                                    : { color: 'rgb(103 232 249 / 0.7)', background: 'rgb(103 232 249 / 0.1)', border: '1px solid rgb(103 232 249 / 0.2)' }
                                  }
                                >
                                  {slug} ⟳
                                </button>
                                <a
                                  href={`/projects/${encodeURIComponent(slug)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={`Timeline for ${slug}`}
                                  className="text-[10px] font-mono px-1 py-0.5 rounded transition-colors"
                                  style={{ color: 'rgb(103 232 249 / 0.4)', background: 'transparent', lineHeight: 1 }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  ⧉
                                </a>
                                <SpotlightButton slug={slug} />
                                {fp?.queuedCount != null && fp.queuedCount > 0 && (
                                  <span
                                    className="text-[0.55rem] font-mono px-1 py-0.5 rounded shrink-0"
                                    style={{ color: '#94a3b8', background: '#94a3b820', border: '1px solid #94a3b840' }}
                                    title={`${fp.queuedCount} message(s) queued for next month`}
                                  >
                                    ⏳{fp.queuedCount}
                                  </span>
                                )}
                              </>
                            )
                          })()}
                          {fleetProjects.length > 0 && (
                            <WatchdogBadge slug={slug} fleetProjects={fleetProjects} />
                          )}
                          {(() => {
                            const fp = fleetProjects.find((p) => p.slug === slug)
                            if (!fp?.memoryStatus?.exists) return null
                            return <MemoryChip slug={slug} sizeBytes={fp.memoryStatus.sizeBytes} />
                          })()}
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
                                {(fleetProject?.contextUsagePct ?? 0) > 60 && (
                                  <ContextUsageGauge pct={fleetProject!.contextUsagePct!} size={28} />
                                )}
                                {fleetProject?.contextFillEtaMinutes != null && (
                                  <ContextFillEtaBadge etaMinutes={fleetProject.contextFillEtaMinutes} />
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
                          {(() => {
                            const fp = fleetProjects.find((p) => p.slug === slug)
                            return (
                              <GoalChip
                                slug={slug}
                                initialText={fp?.goalText}
                                initialStatus={fp?.goalStatus as GoalStatus | undefined}
                              />
                            )
                          })()}
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

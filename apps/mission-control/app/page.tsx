'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import EventFeed from '../components/EventFeed'
import InstanceGrid from '../components/InstanceGrid'
import MemoryPanel from '../components/MemoryPanel'
import SchedulerTable from '../components/SchedulerTable'
import ScheduleTimeline from '../components/ScheduleTimeline'
import SchedulerCalendar from '../components/SchedulerCalendar'
import SpecclawPipeline from '../components/SpecclawPipeline'
import StallAlertPanel from '../components/StallAlertPanel'
import TranscriptPanel from '../components/TranscriptPanel'
import CountBadge from '../components/ui/CountBadge'
import NavDropdown from '../components/NavDropdown'
import AdvisorTile from '../components/AdvisorTile'
import { useFleet } from '../components/FleetContext'
import type { FleetResponse, ProjectState } from './api/fleet/route'
import type { WhatsAppResponse } from './api/whatsapp/route'

interface McEventEntry {
  id: string
  ts: number
  type: string
  instance_id: string
  payload: Record<string, unknown>
}

interface InstanceRow {
  instance_id: string
  last_seen: string | null
}

function isHealthy(lastSeen: string | null): boolean {
  if (!lastSeen) return false
  return Date.now() - new Date(lastSeen).getTime() < 5 * 60 * 1000
}

// === P62: Section visibility controls ===
const SECTION_KEYS = ['instances', 'stalls', 'advisor', 'pipeline', 'memories', 'scheduler', 'events'] as const
type SectionKey = typeof SECTION_KEYS[number]
const SECTION_LABELS: Record<SectionKey, string> = {
  instances: 'Instances',
  stalls: 'Stall Alerts',
  advisor: 'Fleet Advisor',
  pipeline: 'Specclaw Pipeline',
  memories: 'Memories',
  scheduler: 'Scheduler',
  events: 'Event Feed',
}
const ALL_VISIBLE = Object.fromEntries(SECTION_KEYS.map((k) => [k, true])) as Record<SectionKey, boolean>
const LS_SECTIONS_KEY = 'mc-dashboard-sections'

// === P95: Dashboard Mode Presets ===
const LS_PRESETS_KEY = 'mc-dashboard-presets'
const LS_ACTIVE_PRESET_KEY = 'mc-dashboard-active-preset'

const BUILT_IN_PRESETS: Record<string, Record<SectionKey, boolean>> = {
  Triage:  { instances: true,  stalls: true,  advisor: true,  pipeline: false, memories: false, scheduler: false, events: false },
  Review:  { instances: false, stalls: false, advisor: false, pipeline: true,  memories: false, scheduler: true,  events: true  },
  Ambient: { instances: true,  stalls: false, advisor: false, pipeline: false, memories: false, scheduler: false, events: true  },
}

function sectionsEqual(a: Record<SectionKey, boolean>, b: Record<SectionKey, boolean>): boolean {
  return SECTION_KEYS.every((k) => a[k] === b[k])
}

function loadCustomPresets(): Record<string, Record<SectionKey, boolean>> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(LS_PRESETS_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, Record<SectionKey, boolean>>
  } catch {
    return {}
  }
}

function loadActivePreset(): string {
  if (typeof window === 'undefined') return ''
  try {
    return localStorage.getItem(LS_ACTIVE_PRESET_KEY) ?? ''
  } catch {
    return ''
  }
}

function PresetSwitcher({
  sections,
  onApply,
}: {
  sections: Record<SectionKey, boolean>
  onApply: (s: Record<SectionKey, boolean>, name: string) => void
}) {
  const [customPresets, setCustomPresets] = useState<Record<string, Record<SectionKey, boolean>>>({})
  const [activePreset, setActivePreset] = useState<string>('')
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const saveInputRef = useRef<HTMLInputElement>(null)

  // Load from localStorage on mount
  useEffect(() => {
    setCustomPresets(loadCustomPresets())
    setActivePreset(loadActivePreset())
  }, [])

  // Focus input when popover opens
  useEffect(() => {
    if (saveOpen) setTimeout(() => saveInputRef.current?.focus(), 50)
  }, [saveOpen])

  const allPresets: Record<string, Record<SectionKey, boolean>> = { ...BUILT_IN_PRESETS, ...customPresets }

  // Determine which preset (if any) matches current sections
  const matchedPreset = Object.keys(allPresets).find((name) => sectionsEqual(sections, allPresets[name])) ?? ''

  function applyPreset(name: string) {
    const layout = allPresets[name]
    if (!layout) return
    setActivePreset(name)
    try { localStorage.setItem(LS_ACTIVE_PRESET_KEY, name) } catch {}
    onApply(layout, name)
  }

  function savePreset() {
    const name = saveName.trim()
    if (!name) return
    const updated = { ...customPresets, [name]: { ...sections } }
    setCustomPresets(updated)
    setActivePreset(name)
    try {
      localStorage.setItem(LS_PRESETS_KEY, JSON.stringify(updated))
      localStorage.setItem(LS_ACTIVE_PRESET_KEY, name)
    } catch {}
    setSaveName('')
    setSaveOpen(false)
  }

  function deletePreset(name: string) {
    const updated = { ...customPresets }
    delete updated[name]
    setCustomPresets(updated)
    try { localStorage.setItem(LS_PRESETS_KEY, JSON.stringify(updated)) } catch {}
    if (activePreset === name) {
      setActivePreset('')
      try { localStorage.removeItem(LS_ACTIVE_PRESET_KEY) } catch {}
    }
  }

  const isCustom = (name: string) => !(name in BUILT_IN_PRESETS)
  const showCustomLabel = !matchedPreset

  return (
    <div className="flex items-center gap-1 shrink-0">
      {/* Preset pills */}
      <div
        className="flex items-center gap-1 rounded-full border border-cyber-cyan/15 bg-cyber-bg/60 px-1.5 py-0.5"
        style={{ boxShadow: '0 0 10px rgba(0,245,255,0.04)' }}
      >
        {Object.keys(allPresets).map((name) => {
          const isActive = matchedPreset === name
          return (
            <div key={name} className="flex items-center gap-0.5">
              <button
                onClick={() => applyPreset(name)}
                className="relative text-[0.55rem] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full transition-all"
                style={{
                  color: isActive ? '#00F5FF' : '#64748b',
                  background: isActive ? 'rgba(0,245,255,0.12)' : 'transparent',
                  border: isActive ? '1px solid rgba(0,245,255,0.4)' : '1px solid transparent',
                }}
                title={`Apply "${name}" preset`}
              >
                {name}
              </button>
              {isCustom(name) && (
                <button
                  onClick={() => deletePreset(name)}
                  className="text-[0.5rem] text-slate-600 hover:text-red-400 transition-colors leading-none -ml-1 pr-0.5"
                  title={`Delete "${name}" preset`}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
        {showCustomLabel && (
          <span className="text-[0.55rem] font-mono uppercase tracking-widest px-2 py-0.5 text-slate-500 italic">
            Custom
          </span>
        )}
      </div>

      {/* Save layout button */}
      <div className="relative">
        <button
          onClick={() => setSaveOpen((v) => !v)}
          className="text-xs font-mono w-5 h-5 flex items-center justify-center rounded-full border transition-colors"
          style={{
            borderColor: saveOpen ? 'rgba(0,245,255,0.4)' : '#1e3a5f',
            color: saveOpen ? '#00F5FF' : '#64748b',
            background: saveOpen ? 'rgba(0,245,255,0.08)' : 'transparent',
          }}
          title="Save current layout as preset"
        >
          ⊕
        </button>
        {saveOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setSaveOpen(false)} />
            <div
              className="absolute right-0 top-full mt-2 z-40 rounded-lg border border-cyber-cyan/20 bg-cyber-surface/95 backdrop-blur-md p-3 w-48 shadow-2xl"
              style={{ boxShadow: '0 0 24px rgba(0,245,255,0.08)' }}
            >
              <div className="text-[0.55rem] uppercase tracking-widest text-slate-500 mb-2 font-semibold">
                Save Layout
              </div>
              <input
                ref={saveInputRef}
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') savePreset(); if (e.key === 'Escape') setSaveOpen(false) }}
                placeholder="Preset name…"
                className="w-full bg-cyber-bg border border-cyber-cyan/20 rounded px-2 py-1 text-xs font-mono text-slate-200 placeholder-slate-600 outline-none focus:border-cyber-cyan/50 mb-2"
              />
              <button
                onClick={savePreset}
                disabled={!saveName.trim()}
                className="w-full text-[0.6rem] font-mono uppercase tracking-widest py-1 rounded transition-colors"
                style={{
                  background: saveName.trim() ? 'rgba(0,245,255,0.12)' : 'rgba(71,85,105,0.2)',
                  color: saveName.trim() ? '#00F5FF' : '#475569',
                  border: saveName.trim() ? '1px solid rgba(0,245,255,0.3)' : '1px solid #1e3a5f',
                }}
              >
                Save layout
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function loadVisibility(): Record<SectionKey, boolean> {
  if (typeof window === 'undefined') return ALL_VISIBLE
  try {
    const raw = localStorage.getItem(LS_SECTIONS_KEY)
    if (!raw) return ALL_VISIBLE
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(SECTION_KEYS.map((k) => [k, parsed[k] !== false])) as Record<SectionKey, boolean>
  } catch {
    return ALL_VISIBLE
  }
}

function SectionsPopover({
  open,
  onClose,
  sections,
  onToggle,
}: {
  open: boolean
  onClose: () => void
  sections: Record<SectionKey, boolean>
  onToggle: (k: SectionKey) => void
}) {
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className="absolute right-0 top-full mt-2 z-40 rounded-lg border border-cyber-cyan/20 bg-cyber-surface/95 backdrop-blur-md p-3 min-w-[190px] shadow-2xl"
        style={{ boxShadow: '0 0 24px rgba(0,245,255,0.08)' }}
      >
        <div className="text-[0.55rem] uppercase tracking-widest text-slate-500 mb-2.5 font-semibold px-1">
          Dashboard Sections
        </div>
        {SECTION_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => onToggle(key)}
            className="w-full flex items-center justify-between gap-3 px-2 py-1.5 rounded hover:bg-cyber-cyan/5 transition-colors text-left"
          >
            <span className="text-xs text-slate-300 font-mono">{SECTION_LABELS[key]}</span>
            <span
              className="w-7 h-3.5 rounded-full transition-colors relative flex-shrink-0"
              style={{ background: sections[key] ? 'rgba(0,245,255,0.3)' : 'rgba(71,85,105,0.5)' }}
            >
              <span
                className="absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all"
                style={{
                  background: sections[key] ? '#00F5FF' : '#64748b',
                  left: sections[key] ? '14px' : '2px',
                }}
              />
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

function AnimatedSection({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          style={{ overflow: 'hidden' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// === P63: Fleet state sparklines ===
const MAX_SPARK_SAMPLES = 20

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) {
    return (
      <svg width={40} height={14} style={{ display: 'block' }}>
        <circle cx={20} cy={7} r={1.5} fill={color} opacity={0.6} />
      </svg>
    )
  }
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 38 + 1
    const y = 12 - (v / max) * 10
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg width={40} height={14} style={{ display: 'block' }}>
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.8}
      />
    </svg>
  )
}

function getStalledSparkColor(data: number[]): string {
  if (data.length < 3) return '#EF4444'
  const last3 = data.slice(-3)
  return last3[2] - last3[0] < 0 ? '#4ADE80' : '#EF4444'
}

// === Shared UI ===

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="w-2 h-2 rounded-sm bg-cyber-cyan/60 shrink-0" style={{ clipPath: 'polygon(0 0,100% 0,100% 100%,0 100%)' }} />
      <h2 className="section-label">{label}</h2>
      <div className="flex-1 h-px bg-gradient-to-r from-cyber-cyan/20 to-transparent" />
    </div>
  )
}

const STATE_COLORS: Record<ProjectState, string> = {
  idle: '#00F5FF',
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
}

const STATE_LABELS: Record<ProjectState, string> = {
  idle: 'Idle',
  active: 'Active',
  stalled: 'Stalled',
  autonomous: 'Auto',
}

interface FleetBadgeProps {
  state: ProjectState
  count: number
  active: boolean
  onClick: () => void
  sparkData?: number[]
}

function FleetBadge({ state, count, active, onClick, sparkData }: FleetBadgeProps) {
  const color = STATE_COLORS[state]
  const isStalled = state === 'stalled' && count > 0
  const sparkColor = state === 'stalled' && sparkData ? getStalledSparkColor(sparkData) : color

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 cursor-pointer rounded px-1 transition-opacity"
      style={{ opacity: active ? 1 : 0.6 }}
      title={`Filter by ${state}`}
    >
      <span
        className={`text-xl font-bold font-mono tabular-nums ${isStalled ? 'animate-pulse' : ''}`}
        style={{ color }}
      >
        {count}
      </span>
      <span
        className="text-[0.6rem] uppercase tracking-widest font-semibold"
        style={{ color, opacity: 0.8 }}
      >
        {STATE_LABELS[state]}
      </span>
      {sparkData && <MiniSparkline data={sparkData} color={sparkColor} />}
    </button>
  )
}

const EMPTY_FLEET: FleetResponse = { idle: 0, active: 0, stalled: 0, autonomous: 0, projects: [] }

function TokenBurnGauge() {
  const [data, setData] = useState<{ tokensPerMin: number; activeProjects: number } | null>(null)
  const [lastUpdated, setLastUpdated] = useState(0)

  useEffect(() => {
    async function fetch_() {
      try {
        const res = await fetch('/api/burn-rate')
        if (res.ok) {
          const d = await res.json()
          setData(d)
          setLastUpdated(Date.now())
        }
      } catch {}
    }
    fetch_()
    const id = setInterval(fetch_, 5_000)
    return () => clearInterval(id)
  }, [])

  const tpm = data?.tokensPerMin ?? 0
  const stale = data === null || Date.now() - lastUpdated > 30_000

  // color zones: green <500, amber 500–2000, red >2000
  const color = stale ? '#475569' : tpm < 500 ? '#4ADE80' : tpm < 2000 ? '#F59E0B' : '#EF4444'
  const pct = Math.min(1, tpm / 3000)
  const barWidth = Math.round(pct * 60)  // max 60px

  const label = stale ? '—' : tpm >= 1000 ? `${(tpm / 1000).toFixed(1)}k` : String(Math.round(tpm))

  return (
    <div
      className="flex flex-col gap-0.5 shrink-0 hidden xl:flex"
      title={data ? `${Math.round(tpm)} tok/min over last 5 min (${data.activeProjects} active projects)` : 'Token burn rate (loading)'}
    >
      <div className="flex items-center gap-1">
        <span className="text-[0.55rem] font-mono" style={{ color: '#475569' }}>⚡</span>
        <span className="text-[0.7rem] font-mono font-bold tabular-nums" style={{ color }}>{label}</span>
        <span className="text-[0.45rem] font-mono text-slate-600">tok/m</span>
      </div>
      <div className="h-1 w-[60px] rounded-full overflow-hidden" style={{ background: '#1e293b' }}>
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{ width: barWidth, background: color, boxShadow: stale ? 'none' : `0 0 4px ${color}80` }}
        />
      </div>
    </div>
  )
}

function DashboardClient() {
  const [events, setEvents] = useState<McEventEntry[]>([])
  const [instances, setInstances] = useState<InstanceRow[]>([])
  const [whatsapp, setWhatsapp] = useState<WhatsAppResponse | null>(null)
  const { fleet: contextFleet, sseStatus } = useFleet()
  const fleet = contextFleet ?? EMPTY_FLEET
  const [fleetFilter, setFleetFilter] = useState<ProjectState | null>(null)
  const [scheduleView, setScheduleView] = useState<'table' | 'timeline' | 'calendar'>('timeline')
  const [showTranscript, setShowTranscript] = useState(false)
  const [eventsPerMin, setEventsPerMin] = useState(0)
  const [uptime, setUptime] = useState(0)
  const mountTime = useRef(Date.now())
  const recentEvents = useRef<number[]>([])

  // P62: section visibility
  const [sections, setSections] = useState<Record<SectionKey, boolean>>(ALL_VISIBLE)
  const [sectionsOpen, setSectionsOpen] = useState(false)

  useEffect(() => { setSections(loadVisibility()) }, [])

  function toggleSection(key: SectionKey) {
    setSections((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      try {
        localStorage.setItem(LS_SECTIONS_KEY, JSON.stringify(next))
        localStorage.removeItem(LS_ACTIVE_PRESET_KEY)
      } catch {}
      return next
    })
  }

  function applyPresetSections(layout: Record<SectionKey, boolean>) {
    setSections(layout)
    try { localStorage.setItem(LS_SECTIONS_KEY, JSON.stringify(layout)) } catch {}
  }

  const hiddenCount = SECTION_KEYS.filter((k) => !sections[k]).length

  // P63: fleet state history for sparklines (sampled every 30s)
  const [fleetHistory, setFleetHistory] = useState<Record<ProjectState, number[]>>({
    idle: [], active: [], stalled: [], autonomous: [],
  })
  useEffect(() => {
    const sample = () => {
      setFleetHistory((prev) => ({
        idle: [...prev.idle.slice(-(MAX_SPARK_SAMPLES - 1)), fleet.idle],
        active: [...prev.active.slice(-(MAX_SPARK_SAMPLES - 1)), fleet.active],
        stalled: [...prev.stalled.slice(-(MAX_SPARK_SAMPLES - 1)), fleet.stalled],
        autonomous: [...prev.autonomous.slice(-(MAX_SPARK_SAMPLES - 1)), fleet.autonomous],
      }))
    }
    sample()
    const id = setInterval(sample, 30_000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet.idle, fleet.active, fleet.stalled, fleet.autonomous])

  useEffect(() => {
    async function fetchInstances() {
      try {
        const res = await fetch('/api/instances')
        if (res.ok) setInstances(await res.json())
      } catch {}
    }
    fetchInstances()
    const interval = setInterval(fetchInstances, 30_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    async function fetchWhatsApp() {
      try {
        const res = await fetch('/api/whatsapp')
        if (res.ok) setWhatsapp(await res.json())
      } catch {}
    }
    fetchWhatsApp()
    const interval = setInterval(fetchWhatsApp, 60_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setUptime(Math.floor((Date.now() - mountTime.current) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 60_000
      recentEvents.current = recentEvents.current.filter((t) => t > cutoff)
      setEventsPerMin(recentEvents.current.length)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleEvent = useCallback((entry: McEventEntry) => {
    recentEvents.current.push(Date.now())
    setEvents((prev) => [entry, ...prev].slice(0, 200))
  }, [])

  const healthy = instances.filter((i) => isHealthy(i.last_seen)).length
  const degraded = instances.length - healthy

  const filteredSlugs = fleetFilter
    ? new Set(fleet.projects.filter((p) => p.state === fleetFilter).map((p) => p.slug))
    : null

  function handleFleetBadgeClick(state: ProjectState) {
    setFleetFilter((prev) => (prev === state ? null : state))
  }

  function formatUptime(s: number): string {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${sec}s`
    return `${sec}s`
  }

  const FLEET_STATES: ProjectState[] = ['idle', 'active', 'stalled', 'autonomous']

  return (
    <div className="min-h-dvh">
      {/* HUD Header */}
      <header className="relative z-50 border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-4">
        {/* Bottom-edge glow line */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1
              className="text-2xl font-black tracking-[0.18em] text-cyber-cyan neon-cyan"
              style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}
            >
              MISSION CONTROL
            </h1>
            <div className="flex items-center gap-3 mt-0.5">
              <p className="text-[0.6rem] text-slate-500 uppercase tracking-[0.25em]">
                MCD Observability Dashboard
              </p>
              <NavDropdown />
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 flex-wrap justify-end">
            {/* Preset switcher (P95) */}
            <PresetSwitcher sections={sections} onApply={applyPresetSections} />

            {/* Sections toggle (P62) — always visible, first */}
            <div className="relative shrink-0">
              <button
                onClick={() => setSectionsOpen((v) => !v)}
                className="flex items-center gap-1 cursor-pointer rounded px-2 py-1 border transition-colors"
                style={{
                  borderColor: sectionsOpen ? 'rgba(0,245,255,0.4)' : '#1e3a5f',
                  color: sectionsOpen ? '#00F5FF' : '#64748b',
                  background: sectionsOpen ? 'rgba(0,245,255,0.08)' : 'transparent',
                }}
                title="Customize dashboard sections"
              >
                <span className="text-xs font-mono">⊞</span>
                <span className="text-[0.6rem] uppercase tracking-widest font-mono">
                  Sections{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}
                </span>
              </button>
              <SectionsPopover
                open={sectionsOpen}
                onClose={() => setSectionsOpen(false)}
                sections={sections}
                onToggle={toggleSection}
              />
            </div>

            {/* Fleet state badges with sparklines (P63) */}
            <div className="flex items-center gap-3 sm:gap-4 border-l border-cyber-cyan/10 pl-2 sm:pl-4 shrink-0">
              {FLEET_STATES.map((state) => (
                <FleetBadge
                  key={state}
                  state={state}
                  count={fleet[state]}
                  active={fleetFilter === null || fleetFilter === state}
                  onClick={() => handleFleetBadgeClick(state)}
                  sparkData={fleetHistory[state]}
                />
              ))}
            </div>
            {/* WhatsApp badge — only when configured */}
            {whatsapp?.enabled && (
              <div
                className="flex flex-col items-center gap-0.5 cursor-pointer rounded px-1 shrink-0"
                title={`WhatsApp: ${whatsapp.status} · ${whatsapp.projectCount} project${whatsapp.projectCount !== 1 ? 's' : ''}`}
                onClick={() => {
                  const url = new URL(window.location.href)
                  url.searchParams.set('platform', 'whatsapp')
                  window.history.pushState({}, '', url.toString())
                }}
              >
                <span
                  className={`text-xl font-bold font-mono tabular-nums ${whatsapp.status === 'pairing' ? 'animate-pulse' : ''}`}
                  style={{
                    color: whatsapp.status === 'connected' ? '#4ADE80' : whatsapp.status === 'pairing' ? '#F59E0B' : '#EF4444',
                  }}
                >
                  {whatsapp.projectCount}
                </span>
                <span
                  className="text-[0.6rem] uppercase tracking-widest font-semibold"
                  style={{
                    color: whatsapp.status === 'connected' ? '#4ADE80' : whatsapp.status === 'pairing' ? '#F59E0B' : '#EF4444',
                    opacity: 0.8,
                  }}
                >
                  WA
                </span>
              </div>
            )}
            {/* Convergence gauge (P120) */}
            {fleet.avgConvergence != null && (
              <div
                className="flex flex-col items-center gap-0.5 shrink-0 hidden sm:flex"
                title={`Fleet Convergence Score: ${fleet.avgConvergence}/100 — ratio of goal-advancing turns in last 24h`}
              >
                <svg width="32" height="32" viewBox="0 0 32 32">
                  <circle cx="16" cy="16" r="13" fill="none" stroke="rgba(100,116,139,0.2)" strokeWidth="3" />
                  <circle
                    cx="16" cy="16" r="13"
                    fill="none"
                    stroke={fleet.avgConvergence >= 60 ? '#4ADE80' : fleet.avgConvergence >= 30 ? '#F59E0B' : '#EF4444'}
                    strokeWidth="3"
                    strokeDasharray={`${(fleet.avgConvergence / 100) * 81.68} 81.68`}
                    strokeLinecap="round"
                    transform="rotate(-90 16 16)"
                    style={{ transition: 'stroke-dasharray 0.8s ease' }}
                  />
                  <text x="16" y="20" textAnchor="middle" fill="white" fontSize="9" fontFamily="monospace" fontWeight="bold">
                    {fleet.avgConvergence}
                  </text>
                </svg>
                <span className="text-[0.55rem] uppercase tracking-widest font-mono text-slate-400">CNV</span>
              </div>
            )}
            {/* Token burn rate gauge (P107) */}
            <TokenBurnGauge />
            {/* MC instance counters — hidden on small screens to reduce clutter */}
            <CountBadge value={instances.length} label="Instances" color="#00F5FF" className="shrink-0 hidden lg:flex" />
            <CountBadge value={eventsPerMin} label="Events/min" color="#00F5FF" className="shrink-0 hidden xl:flex" />
            <CountBadge value={healthy} label="Healthy" color="#4ADE80" className="shrink-0 hidden lg:flex" />
            <CountBadge value={degraded} label="Degraded" color="#EF4444" className="shrink-0 hidden lg:flex" />
            <div
              className="flex flex-col items-center gap-0.5 shrink-0"
              title={`SSE: ${sseStatus}`}
            >
              <span
                className={`w-3 h-3 rounded-full ${
                  sseStatus === 'connected' ? 'bg-cyber-cyan' :
                  sseStatus === 'reconnecting' ? 'bg-cyber-amber animate-pulse' :
                  'bg-slate-600'
                }`}
              />
              <span className="text-[0.6rem] text-slate-500 uppercase tracking-widest">SSE</span>
            </div>
          </div>
        </div>
      </header>

      <motion.main
        className="px-4 sm:px-6 py-6"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        {/* Responsive grid — stacks on mobile, 2-col on lg, 3-col on xl */}
        <div className="grid gap-5 grid-cols-1 lg:grid-cols-2 xl:grid-cols-[1fr_1fr_360px]">
          {/* Col 1: Instances + Stall Alerts */}
          <div className="flex flex-col gap-5">
            <AnimatedSection visible={sections.instances}>
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-sm bg-cyber-cyan/60 shrink-0" style={{ clipPath: 'polygon(0 0,100% 0,100% 100%,0 100%)' }} />
                  <h2 className="section-label">{fleetFilter ? `Instances — ${fleetFilter}` : 'Instances'}</h2>
                  <div className="flex-1 h-px bg-gradient-to-r from-cyber-cyan/20 to-transparent" />
                  <button
                    onClick={() => setShowTranscript((v) => !v)}
                    className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded border transition-colors"
                    style={{
                      color: showTranscript ? '#00F5FF' : '#475569',
                      borderColor: showTranscript ? '#00F5FF40' : '#334155',
                      background: showTranscript ? '#00F5FF12' : 'transparent',
                    }}
                  >
                    ◈ Transcript
                  </button>
                </div>
                <InstanceGrid events={events} filterSlugs={filteredSlugs} fleetProjects={fleet.projects} />
              </section>
              {showTranscript && fleet.projects.length > 0 && (
                <section className="mt-5">
                  <TranscriptPanel slugs={fleet.projects.map((p) => p.slug)} />
                </section>
              )}
            </AnimatedSection>
            <AnimatedSection visible={sections.stalls}>
              <section>
                <StallAlertPanel />
              </section>
            </AnimatedSection>
          </div>

          {/* Col 2: Scheduler + Fleet Advisor */}
          <div className="flex flex-col gap-5 min-w-0 overflow-hidden">
            <AnimatedSection visible={sections.scheduler}>
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-sm bg-cyber-cyan/60 shrink-0" style={{ clipPath: 'polygon(0 0,100% 0,100% 100%,0 100%)' }} />
                  <h2 className="section-label">Scheduler</h2>
                  <div className="flex-1 h-px bg-gradient-to-r from-cyber-cyan/20 to-transparent" />
                  <div className="flex rounded overflow-hidden border border-cyber-cyan/20 shrink-0">
                    {(['timeline', 'table', 'calendar'] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setScheduleView(v)}
                        className={`text-[10px] px-2 py-0.5 font-mono uppercase tracking-wider transition-colors ${
                          scheduleView === v
                            ? 'bg-cyber-cyan/20 text-cyber-cyan'
                            : 'text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                {scheduleView === 'timeline'
                  ? <ScheduleTimeline events={events} />
                  : scheduleView === 'calendar'
                  ? <SchedulerCalendar events={events} />
                  : <SchedulerTable events={events} />
                }
              </section>
            </AnimatedSection>
            <AnimatedSection visible={sections.advisor}>
              <section>
                <SectionLabel label="Fleet Advisor" />
                <AdvisorTile />
              </section>
            </AnimatedSection>
          </div>

          {/* Col 3: Event Feed (360px at xl, full-width at lg) */}
          <AnimatedSection visible={sections.events}>
            <section className="xl:col-span-1 lg:col-span-2">
              <SectionLabel label="Event Feed" />
              <EventFeed onEvent={handleEvent} />
            </section>
          </AnimatedSection>

          {/* Bottom row: Memories + Specclaw Pipeline */}
          <div className="col-span-full grid grid-cols-1 md:grid-cols-2 gap-5">
            <AnimatedSection visible={sections.memories}>
              <section>
                <SectionLabel label="Memories" />
                <MemoryPanel />
              </section>
            </AnimatedSection>
            <AnimatedSection visible={sections.pipeline}>
              <section>
                <SectionLabel label="Specclaw Pipeline" />
                <SpecclawPipeline events={events} />
              </section>
            </AnimatedSection>
          </div>
        </div>
      </motion.main>
    </div>
  )
}

export default function Page() {
  return <DashboardClient />
}

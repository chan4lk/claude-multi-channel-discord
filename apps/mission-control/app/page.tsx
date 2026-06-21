'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import EventFeed from '../components/EventFeed'
import InstanceGrid from '../components/InstanceGrid'
import MemoryPanel from '../components/MemoryPanel'
import SchedulerTable from '../components/SchedulerTable'
import ScheduleTimeline from '../components/ScheduleTimeline'
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
}

function FleetBadge({ state, count, active, onClick }: FleetBadgeProps) {
  const color = STATE_COLORS[state]
  const isStalled = state === 'stalled' && count > 0

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
    </button>
  )
}

const EMPTY_FLEET: FleetResponse = { idle: 0, active: 0, stalled: 0, autonomous: 0, projects: [] }

function DashboardClient() {
  const [events, setEvents] = useState<McEventEntry[]>([])
  const [instances, setInstances] = useState<InstanceRow[]>([])
  const [whatsapp, setWhatsapp] = useState<WhatsAppResponse | null>(null)
  const { fleet: contextFleet, sseStatus } = useFleet()
  const fleet = contextFleet ?? EMPTY_FLEET
  const [fleetFilter, setFleetFilter] = useState<ProjectState | null>(null)
  const [scheduleView, setScheduleView] = useState<'table' | 'timeline'>('timeline')
  const [showTranscript, setShowTranscript] = useState(false)
  const [eventsPerMin, setEventsPerMin] = useState(0)
  const [uptime, setUptime] = useState(0)
  const mountTime = useRef(Date.now())
  const recentEvents = useRef<number[]>([])

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

  // Slugs matching the current fleet filter
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
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-4">
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

          <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
            {/* Fleet state badges */}
            <div className="flex items-center gap-3 sm:gap-5 border-r border-cyber-cyan/10 pr-4 sm:pr-6">
              {FLEET_STATES.map((state) => (
                <FleetBadge
                  key={state}
                  state={state}
                  count={fleet[state]}
                  active={fleetFilter === null || fleetFilter === state}
                  onClick={() => handleFleetBadgeClick(state)}
                />
              ))}
            </div>
            {/* WhatsApp badge — only when configured */}
            {whatsapp?.enabled && (
              <div
                className="flex flex-col items-center gap-0.5 cursor-pointer rounded px-1"
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
            {/* MC instance counters */}
            <CountBadge value={instances.length} label="Instances" color="#00F5FF" />
            <CountBadge value={eventsPerMin} label="Events/min" color="#00F5FF" />
            <CountBadge value={healthy} label="Healthy" color="#4ADE80" />
            <CountBadge value={degraded} label="Degraded" color="#EF4444" />
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-xl font-bold font-mono text-slate-400 tabular-nums">
                {formatUptime(uptime)}
              </span>
              <span className="text-[0.6rem] text-slate-500 uppercase tracking-widest">Uptime</span>
            </div>
            <div
              className="flex flex-col items-center gap-0.5"
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
              <section>
                <TranscriptPanel slugs={fleet.projects.map((p) => p.slug)} />
              </section>
            )}
            <section>
              <StallAlertPanel />
            </section>
          </div>

          {/* Col 2: Scheduler + Fleet Advisor */}
          <div className="flex flex-col gap-5">
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-sm bg-cyber-cyan/60 shrink-0" style={{ clipPath: 'polygon(0 0,100% 0,100% 100%,0 100%)' }} />
                <h2 className="section-label">Scheduler</h2>
                <div className="flex-1 h-px bg-gradient-to-r from-cyber-cyan/20 to-transparent" />
                <div className="flex rounded overflow-hidden border border-cyber-cyan/20 shrink-0">
                  {(['timeline', 'table'] as const).map((v) => (
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
                : <SchedulerTable events={events} />
              }
            </section>
            <section>
              <SectionLabel label="Fleet Advisor" />
              <AdvisorTile />
            </section>
          </div>

          {/* Col 3: Event Feed (360px at xl, full-width at lg) */}
          <section className="xl:col-span-1 lg:col-span-2">
            <SectionLabel label="Event Feed" />
            <EventFeed onEvent={handleEvent} />
          </section>

          {/* Bottom row: Specclaw Pipeline + Memories */}
          <div className="col-span-full grid grid-cols-1 md:grid-cols-2 gap-5">
            <section>
              <SectionLabel label="Specclaw Pipeline" />
              <SpecclawPipeline events={events} />
            </section>
            <section>
              <SectionLabel label="Memories" />
              <MemoryPanel />
            </section>
          </div>
        </div>
      </motion.main>
    </div>
  )
}

export default function Page() {
  return <DashboardClient />
}

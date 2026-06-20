'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import EventFeed from '../components/EventFeed'
import InstanceGrid from '../components/InstanceGrid'
import MemoryPanel from '../components/MemoryPanel'
import SchedulerTable from '../components/SchedulerTable'
import SpecclawPipeline from '../components/SpecclawPipeline'
import CountBadge from '../components/ui/CountBadge'
import type { FleetResponse, ProjectState } from './api/fleet/route'

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

function DashboardClient() {
  const [events, setEvents] = useState<McEventEntry[]>([])
  const [instances, setInstances] = useState<InstanceRow[]>([])
  const [fleet, setFleet] = useState<FleetResponse>({ idle: 0, active: 0, stalled: 0, autonomous: 0, projects: [] })
  const [fleetFilter, setFleetFilter] = useState<ProjectState | null>(null)
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
    async function fetchFleet() {
      try {
        const res = await fetch('/api/fleet')
        if (res.ok) setFleet(await res.json())
      } catch {}
    }
    fetchFleet()
    const interval = setInterval(fetchFleet, 30_000)
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
            <p className="text-[0.6rem] text-slate-500 mt-0.5 uppercase tracking-[0.25em]">
              MCD Observability Dashboard
            </p>
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
          </div>
        </div>
      </header>

      <motion.main
        className="px-4 sm:px-6 py-6"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        {/* Responsive grid — stacks on mobile */}
        <div className="grid gap-5 grid-cols-1 lg:grid-cols-2 xl:grid-cols-[1fr_1fr_360px]">
          {/* Left column */}
          <div className="flex flex-col gap-5">
            <section>
              <SectionLabel label={fleetFilter ? `Instances — ${fleetFilter}` : 'Instances'} />
              <InstanceGrid events={events} filterSlugs={filteredSlugs} />
            </section>
            <section>
              <SectionLabel label="Specclaw Pipeline" />
              <SpecclawPipeline events={events} />
            </section>
            <section>
              <SectionLabel label="Memories" />
              <MemoryPanel />
            </section>
          </div>

          {/* Middle column */}
          <section className="lg:col-span-1">
            <SectionLabel label="Scheduler" />
            <SchedulerTable events={events} />
          </section>

          {/* Right column — event feed */}
          <section className="xl:col-span-1 lg:col-span-2">
            <SectionLabel label="Event Feed" />
            <EventFeed onEvent={handleEvent} />
          </section>
        </div>
      </motion.main>
    </div>
  )
}

export default function Page() {
  return <DashboardClient />
}

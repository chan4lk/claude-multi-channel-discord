'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import EventFeed from '../components/EventFeed'
import InstanceGrid from '../components/InstanceGrid'
import MemoryPanel from '../components/MemoryPanel'
import SchedulerTable from '../components/SchedulerTable'
import SpecclawPipeline from '../components/SpecclawPipeline'
import CountBadge from '../components/ui/CountBadge'

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

function DashboardClient() {
  const [events, setEvents] = useState<McEventEntry[]>([])
  const [instances, setInstances] = useState<InstanceRow[]>([])
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

  function formatUptime(s: number): string {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${sec}s`
    return `${sec}s`
  }

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

          <div className="flex items-center gap-6 sm:gap-8">
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
              <SectionLabel label="Instances" />
              <InstanceGrid events={events} />
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

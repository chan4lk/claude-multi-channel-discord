'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import EventFeed from '../components/EventFeed'
import InstanceGrid from '../components/InstanceGrid'
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

function DashboardClient() {
  const [events, setEvents] = useState<McEventEntry[]>([])
  const [instances, setInstances] = useState<InstanceRow[]>([])
  const [eventsPerMin, setEventsPerMin] = useState(0)
  const [uptime, setUptime] = useState(0)
  const mountTime = useRef(Date.now())
  const recentEvents = useRef<number[]>([])

  // Fetch instances for HUD
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

  // Uptime ticker
  useEffect(() => {
    const interval = setInterval(() => {
      setUptime(Math.floor((Date.now() - mountTime.current) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Events/min calculator
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 60_000
      recentEvents.current = recentEvents.current.filter((t) => t > cutoff)
      setEventsPerMin(recentEvents.current.length)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // Called by EventFeed for each live SSE event
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
    <div className="min-h-screen">
      {/* HUD Header */}
      <header className="border-b border-cyber-cyan/10 bg-cyber-surface/60 backdrop-blur-sm px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-cyber-cyan" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              MISSION CONTROL
            </h1>
            <p className="text-xs text-slate-400 mt-0.5 uppercase tracking-widest">MCD Observability Dashboard</p>
          </div>
          <div className="flex items-center gap-8">
            <CountBadge value={instances.length} label="Instances" color="#00F5FF" />
            <CountBadge value={eventsPerMin} label="Events/min" color="#00F5FF" />
            <CountBadge value={healthy} label="Healthy" color="#4ADE80" />
            <CountBadge value={degraded} label="Degraded" color="#EF4444" />
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-xl font-bold font-mono text-slate-400">{formatUptime(uptime)}</span>
              <span className="text-xs text-slate-500 uppercase tracking-wider">Uptime</span>
            </div>
          </div>
        </div>
      </header>

      <motion.main
        className="px-6 py-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        {/* CSS Grid layout */}
        <div
          className="grid gap-6"
          style={{
            gridTemplateAreas: `
              "instances feed"
              "pipeline  feed"
              "scheduler scheduler"
            `,
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: 'auto auto auto',
          }}
        >
          <section style={{ gridArea: 'instances' }}>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Instances</h2>
            <InstanceGrid events={events} />
          </section>

          <section style={{ gridArea: 'pipeline' }}>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Specclaw Pipeline</h2>
            <SpecclawPipeline events={events} />
          </section>

          <section style={{ gridArea: 'feed' }}>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Event Feed</h2>
            <EventFeed onEvent={handleEvent} />
          </section>

          <section style={{ gridArea: 'scheduler' }}>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Scheduler</h2>
            <SchedulerTable events={events} />
          </section>
        </div>
      </motion.main>
    </div>
  )
}

export default function Page() {
  return <DashboardClient />
}

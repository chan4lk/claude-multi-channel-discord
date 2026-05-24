'use client'

import { useEffect, useRef, useState } from 'react'
import EventFeed from '../components/EventFeed'
import InstanceGrid from '../components/InstanceGrid'
import SchedulerTable from '../components/SchedulerTable'
import SpecclawPipeline from '../components/SpecclawPipeline'

interface McEventEntry {
  id: string
  ts: number
  type: string
  instance_id: string
  payload: Record<string, unknown>
}

let _counter = 0
function nextId(): string {
  return String(++_counter)
}

function DashboardClient() {
  const [events, setEvents] = useState<McEventEntry[]>([])
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource('/api/events')
    esRef.current = es

    function handleEvent(e: MessageEvent) {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(e.data)
      } catch {
        parsed = { raw: e.data }
      }

      const entry: McEventEntry = {
        id: nextId(),
        ts: typeof parsed['ts'] === 'number' ? parsed['ts'] : Date.now(),
        type:
          typeof parsed['type'] === 'string' ? parsed['type'] : e.type || 'unknown',
        instance_id:
          typeof parsed['instance_id'] === 'string' ? parsed['instance_id'] : '',
        payload: parsed,
      }

      setEvents((prev: McEventEntry[]) => [entry, ...prev].slice(0, 100))
    }

    es.onmessage = handleEvent

    const extraTypes = [
      'spawn',
      'stop',
      'reply',
      'error_event',
      'progress',
      'watchdog',
      'specclaw_status_changed',
      'scheduler_fired',
    ]
    for (const t of extraTypes) {
      es.addEventListener(t, (e) => handleEvent(e as MessageEvent))
    }

    return () => {
      es.close()
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <h1 className="text-2xl font-bold tracking-tight text-white">Mission Control</h1>
        <p className="text-sm text-gray-400 mt-0.5">MCD Observability Dashboard</p>
      </header>

      <main className="px-6 py-6 flex flex-col gap-8">
        {/* Two-column grid at lg+ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column: InstanceGrid + SpecclawPipeline */}
          <div className="flex flex-col gap-6">
            <section>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Instances
              </h2>
              <InstanceGrid />
            </section>

            <section>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Specclaw Pipeline
              </h2>
              <SpecclawPipeline events={events} />
            </section>
          </div>

          {/* Right column: EventFeed */}
          <section>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Event Feed
            </h2>
            <EventFeed />
          </section>
        </div>

        {/* Below grid: SchedulerTable */}
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Scheduler
          </h2>
          <SchedulerTable events={events} />
        </section>
      </main>
    </div>
  )
}

export default function Page() {
  return <DashboardClient />
}

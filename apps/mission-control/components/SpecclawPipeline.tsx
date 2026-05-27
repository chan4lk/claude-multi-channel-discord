'use client'

import { useEffect, useState } from 'react'
import GlassCard from './ui/GlassCard'

interface McEventEntry {
  id: string
  ts: number
  type: string
  instance_id: string
  payload: Record<string, unknown>
}

interface Props {
  events: McEventEntry[]
}

interface ApiChangeRow {
  name: string
  phase: string
  tasksDone: number
  tasksTotal: number
  status: string
}

interface ApiProjectRow {
  slug: string
  changes: ApiChangeRow[]
}

interface PipelineRow {
  key: string
  slug: string
  name: string
  phase: string
  tasksDone: number
  tasksTotal: number
  ts: number
}

const PHASES = ['propose', 'plan', 'build', 'verify', 'pr']

function phaseIndex(phase: string): number {
  const i = PHASES.indexOf(phase)
  return i >= 0 ? i : 0
}

function detectPhase(statusMd: string): number {
  const s = statusMd.toLowerCase()
  if (s.includes(' pr') || s.startsWith('pr') || s.includes('\npr')) return 4
  if (s.includes('verify')) return 3
  if (s.includes('build')) return 2
  if (s.includes('plan')) return 1
  return 0
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export default function SpecclawPipeline({ events }: Props) {
  const [apiRows, setApiRows] = useState<PipelineRow[]>([])

  useEffect(() => {
    async function fetchSpecclaw() {
      try {
        const res = await fetch('/api/specclaw')
        if (!res.ok) return
        const data: ApiProjectRow[] = await res.json()
        const rows: PipelineRow[] = []
        for (const proj of data) {
          for (const ch of proj.changes) {
            rows.push({
              key: `${proj.slug}::${ch.name}`,
              slug: proj.slug,
              name: ch.name,
              phase: ch.phase,
              tasksDone: ch.tasksDone,
              tasksTotal: ch.tasksTotal,
              ts: Date.now(),
            })
          }
        }
        setApiRows(rows)
      } catch {
        // ignore fetch errors
      }
    }
    fetchSpecclaw()
    const id = setInterval(fetchSpecclaw, 30_000)
    return () => clearInterval(id)
  }, [])

  // Fall back to event-stream data if API returned nothing
  const statusEvents = events.filter((ev) => ev.type === 'specclaw_status_changed')
  const eventRows: PipelineRow[] = []
  if (apiRows.length === 0 && statusEvents.length > 0) {
    const seen = new Set<string>()
    for (const ev of statusEvents) {
      const slug = typeof ev.payload['slug'] === 'string' ? ev.payload['slug'] : '(unknown)'
      const key = `${ev.instance_id}::${slug}`
      if (seen.has(key)) continue
      seen.add(key)
      const rawMd = ev.payload['statusMd']
      const statusMd = typeof rawMd === 'string' ? rawMd : JSON.stringify(rawMd ?? '')
      eventRows.push({
        key,
        slug: ev.instance_id.slice(0, 8),
        name: slug,
        phase: PHASES[detectPhase(statusMd)] ?? 'build',
        tasksDone: 0,
        tasksTotal: 0,
        ts: ev.ts,
      })
    }
  }

  const rows = apiRows.length > 0 ? apiRows : eventRows

  if (rows.length === 0) {
    return (
      <GlassCard className="p-4">
        <div className="text-slate-500 text-sm py-4 text-center">No specclaw activity.</div>
      </GlassCard>
    )
  }

  return (
    <GlassCard className="flex flex-col gap-3 p-4">
      {rows.map((row) => {
        const activePhase = phaseIndex(row.phase)
        return (
          <div key={row.key} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-slate-500 shrink-0">{row.slug}</span>
              <span className="text-sm font-semibold text-purple-300 truncate">{row.name}</span>
              {row.tasksTotal > 0 && (
                <span className="text-xs text-slate-500 ml-auto shrink-0">
                  {row.tasksDone}/{row.tasksTotal}
                </span>
              )}
              {row.tasksTotal === 0 && (
                <span className="ml-auto text-xs text-slate-500 shrink-0">{formatTime(row.ts)}</span>
              )}
            </div>
            <div className="flex gap-1">
              {PHASES.map((phase, i) => {
                const isDone = i < activePhase
                const isActive = i === activePhase
                return (
                  <div
                    key={phase}
                    className={`flex-1 rounded px-1.5 py-1 text-center text-xs font-semibold relative overflow-hidden ${
                      isDone
                        ? 'bg-cyber-cyan/20 text-cyber-cyan'
                        : isActive
                        ? 'bg-cyber-cyan/10 text-cyber-cyan border border-cyber-cyan/40 animate-glow-sweep bg-[length:200%_100%] bg-gradient-to-r from-cyber-cyan/5 via-cyber-cyan/30 to-cyber-cyan/5'
                        : 'bg-slate-800/50 text-slate-600'
                    }`}
                  >
                    {isDone ? '✓ ' : ''}{phase}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </GlassCard>
  )
}

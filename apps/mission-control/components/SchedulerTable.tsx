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

interface ScheduleApiRow {
  id: string
  chatId: string
  slug: string
  at: string
  prompt: string
  enabled: boolean
  lastRunAt: string | null
  runCount: number
  maxRuns: number | null
}

function parseJobTime(at: string): { hour: number; minute: number } | null {
  const match = at.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  return { hour: parseInt(match[1], 10), minute: parseInt(match[2], 10) }
}

function secondsUntilNext(hour: number, minute: number): number {
  const now = new Date()
  const next = new Date(now)
  next.setHours(hour, minute, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  return Math.floor((next.getTime() - now.getTime()) / 1000)
}

function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatTime(ts: string | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function useCountdowns(rows: ScheduleApiRow[]): Record<string, number> {
  const [countdowns, setCountdowns] = useState<Record<string, number>>({})

  useEffect(() => {
    function compute() {
      const next: Record<string, number> = {}
      for (const row of rows) {
        const parsed = parseJobTime(row.at)
        next[row.id] = parsed ? secondsUntilNext(parsed.hour, parsed.minute) : -1
      }
      setCountdowns(next)
    }
    compute()
    const id = setInterval(compute, 1000)
    return () => clearInterval(id)
  }, [rows])

  return countdowns
}

export default function SchedulerTable({ events }: Props) {
  const [rows, setRows] = useState<ScheduleApiRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchSchedules() {
      try {
        const res = await fetch('/api/schedules')
        if (res.ok) {
          const data: ScheduleApiRow[] = await res.json()
          setRows(data)
        }
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }
    fetchSchedules()
    const id = setInterval(fetchSchedules, 60_000)
    return () => clearInterval(id)
  }, [])

  // Update lastRunAt from live scheduler_fired events
  useEffect(() => {
    const fired = events.filter((ev) => ev.type === 'scheduler_fired')
    if (fired.length === 0) return
    setRows((prev) =>
      prev.map((row) => {
        const match = fired.find((ev) => {
          const chatId = typeof ev.payload['chatId'] === 'string' ? ev.payload['chatId'] : String(ev.payload['chatId'] ?? '')
          return chatId === row.chatId
        })
        if (!match) return row
        return { ...row, lastRunAt: new Date(match.ts).toISOString(), runCount: row.runCount + 1 }
      })
    )
  }, [events])

  const countdowns = useCountdowns(rows)

  if (loading) {
    return (
      <GlassCard className="p-4">
        <div className="text-slate-500 text-sm py-4 text-center">Loading schedules…</div>
      </GlassCard>
    )
  }

  if (rows.length === 0) {
    return (
      <GlassCard className="p-4">
        <div className="text-slate-500 text-sm py-4 text-center">No scheduler activity.</div>
      </GlassCard>
    )
  }

  return (
    <GlassCard className="overflow-x-auto p-4">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-cyber-cyan/10">
            <th className="pb-2 pr-4 font-medium">Project</th>
            <th className="pb-2 pr-4 font-medium">Job</th>
            <th className="pb-2 pr-4 font-medium">Next Fire</th>
            <th className="pb-2 pr-4 font-medium">Last Run</th>
            <th className="pb-2 pr-4 font-medium">Runs</th>
            <th className="pb-2 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const secs = countdowns[row.id] ?? -1
            return (
              <tr
                key={row.id}
                className="border-b border-cyber-cyan/5 hover:bg-white/5 transition-colors"
              >
                <td className="py-2 pr-4 font-mono text-xs text-cyber-cyan truncate max-w-[120px]" title={row.slug}>
                  {row.slug}
                </td>
                <td className="py-2 pr-4 text-cyber-amber text-xs truncate max-w-[160px]" title={`at ${row.at}`}>
                  {row.at}
                </td>
                <td className="py-2 pr-4">
                  {secs >= 0 ? (
                    <span className="font-mono text-xs text-cyber-cyan bg-cyber-cyan/10 px-2 py-0.5 rounded">
                      {formatCountdown(secs)}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-600">—</span>
                  )}
                </td>
                <td className="py-2 pr-4 text-xs text-slate-400 font-mono">
                  {formatTime(row.lastRunAt)}
                </td>
                <td className="py-2 pr-4 text-xs text-slate-400 font-mono">
                  {row.runCount}{row.maxRuns != null ? `/${row.maxRuns}` : ''}
                </td>
                <td className="py-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      !row.enabled
                        ? 'bg-cyber-amber/10 text-cyber-amber'
                        : 'bg-cyber-cyan/10 text-cyber-cyan'
                    }`}
                  >
                    {row.enabled ? 'enabled' : 'paused'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </GlassCard>
  )
}

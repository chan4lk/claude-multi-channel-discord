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

interface SchedulerRow {
  instance_id: string
  chatId: string
  jobId: string
  paused: boolean
  ts: number
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function parseJobTime(jobId: string): { hour: number; minute: number } | null {
  const match = jobId.match(/(\d{1,2}):(\d{2})/)
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
  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m`
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

function useCountdowns(rows: SchedulerRow[]): Record<string, number> {
  const [countdowns, setCountdowns] = useState<Record<string, number>>({})

  useEffect(() => {
    function compute() {
      const next: Record<string, number> = {}
      for (const row of rows) {
        const parsed = parseJobTime(row.jobId)
        const key = `${row.instance_id}::${row.chatId}`
        next[key] = parsed
          ? secondsUntilNext(parsed.hour, parsed.minute)
          : -1
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
  const firedEvents = events.filter((ev) => ev.type === 'scheduler_fired')

  if (firedEvents.length === 0) {
    return (
      <GlassCard className="p-4">
        <div className="text-slate-500 text-sm py-4 text-center">No scheduler activity.</div>
      </GlassCard>
    )
  }

  const seen = new Set<string>()
  const rows: SchedulerRow[] = []

  for (const ev of firedEvents) {
    const chatId =
      typeof ev.payload['chatId'] === 'string'
        ? ev.payload['chatId']
        : String(ev.payload['chatId'] ?? '(unknown)')
    const key = `${ev.instance_id}::${chatId}`
    if (seen.has(key)) continue
    seen.add(key)

    const jobId =
      typeof ev.payload['jobId'] === 'string'
        ? ev.payload['jobId']
        : String(ev.payload['jobId'] ?? '—')

    const paused = ev.payload['paused'] === true

    rows.push({ instance_id: ev.instance_id, chatId, jobId, paused, ts: ev.ts })
  }

  const countdowns = useCountdowns(rows)

  return (
    <GlassCard className="overflow-x-auto p-4">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-cyber-cyan/10">
            <th className="pb-2 pr-4 font-medium">Instance</th>
            <th className="pb-2 pr-4 font-medium">Chat ID</th>
            <th className="pb-2 pr-4 font-medium">Job</th>
            <th className="pb-2 pr-4 font-medium">Next Fire</th>
            <th className="pb-2 pr-4 font-medium">Last Fired</th>
            <th className="pb-2 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = `${row.instance_id}::${row.chatId}`
            const secs = countdowns[key] ?? -1
            return (
              <tr
                key={key}
                className="border-b border-cyber-cyan/5 hover:bg-white/5 transition-colors"
              >
                <td className="py-2 pr-4 font-mono text-xs text-slate-500">
                  {row.instance_id.slice(0, 8)}
                </td>
                <td className="py-2 pr-4 font-mono text-xs text-slate-300 truncate max-w-[140px]" title={row.chatId}>
                  {row.chatId}
                </td>
                <td className="py-2 pr-4 text-cyber-amber text-xs truncate max-w-[160px]" title={row.jobId}>
                  {row.jobId}
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
                  {formatTime(row.ts)}
                </td>
                <td className="py-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      row.paused
                        ? 'bg-cyber-amber/10 text-cyber-amber'
                        : 'bg-cyber-cyan/10 text-cyber-cyan'
                    }`}
                  >
                    {row.paused ? 'paused' : 'active'}
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

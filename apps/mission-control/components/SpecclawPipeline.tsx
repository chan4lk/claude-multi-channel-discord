'use client'

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

interface PipelineRow {
  instance_id: string
  slug: string
  statusMd: string
  ts: number
}

const PHASES = ['propose', 'plan', 'build', 'verify', 'pr']

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
  const statusEvents = events.filter((ev) => ev.type === 'specclaw_status_changed')

  if (statusEvents.length === 0) {
    return (
      <GlassCard className="p-4">
        <div className="text-slate-500 text-sm py-4 text-center">No specclaw activity.</div>
      </GlassCard>
    )
  }

  const seen = new Set<string>()
  const rows: PipelineRow[] = []

  for (const ev of statusEvents) {
    const slug = typeof ev.payload['slug'] === 'string' ? ev.payload['slug'] : '(unknown)'
    const key = `${ev.instance_id}::${slug}`
    if (seen.has(key)) continue
    seen.add(key)

    const rawMd = ev.payload['statusMd']
    const statusMd = typeof rawMd === 'string' ? rawMd : JSON.stringify(rawMd ?? '')

    rows.push({ instance_id: ev.instance_id, slug, statusMd, ts: ev.ts })
  }

  return (
    <GlassCard className="flex flex-col gap-3 p-4">
      {rows.map((row) => {
        const activePhase = detectPhase(row.statusMd)
        return (
          <div key={`${row.instance_id}::${row.slug}`} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-slate-500 shrink-0">
                {row.instance_id.slice(0, 8)}
              </span>
              <span className="text-sm font-semibold text-purple-300 truncate">
                {row.slug}
              </span>
              <span className="ml-auto text-xs text-slate-500 shrink-0">{formatTime(row.ts)}</span>
            </div>

            {/* Horizontal progress track */}
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

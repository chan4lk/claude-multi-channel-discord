'use client'

import { useEffect, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { CalendarDay, CalendarResponse } from '../api/metrics/calendar/route'

function cellColor(turns: number): string {
  if (turns === 0) return '#0d1117'
  if (turns <= 5) return '#0e4429'
  if (turns <= 20) return '#006d32'
  if (turns <= 50) return '#26a641'
  return '#22D3EE'
}

interface TooltipState {
  x: number
  y: number
  day: CalendarDay
}

interface PanelState {
  day: CalendarDay
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function buildWeekGrid(days: CalendarDay[]): (CalendarDay | null)[][] {
  if (days.length === 0) return []
  const today = isoToday()
  const todayDate = new Date(today)
  const endDow = todayDate.getDay() // 0=Sun

  // Build a full 52-week grid ending today
  const weeks: (CalendarDay | null)[][] = []
  const dayMap = new Map<string, CalendarDay>()
  for (const d of days) dayMap.set(d.day, d)

  // Last cell = today; first cell = 364 days ago
  // Grid: 52 cols (weeks) × 7 rows (Sun–Sat)
  // col 51 ends on today; col 51 has (today) at row=endDow

  for (let col = 0; col < 52; col++) {
    const week: (CalendarDay | null)[] = []
    for (let row = 0; row < 7; row++) {
      // days from today for this cell
      const daysFromToday = (51 - col) * 7 + (endDow - row)
      if (daysFromToday < 0) {
        week.push(null)
        continue
      }
      const d = new Date(todayDate)
      d.setDate(d.getDate() - daysFromToday)
      const iso = d.toISOString().slice(0, 10)
      week.push(dayMap.get(iso) ?? { day: iso, totalTurns: 0, perProject: [] })
    }
    weeks.push(week)
  }

  return weeks  // weeks[col][row]
}

function monthLabels(weeks: (CalendarDay | null)[][]): { col: number; label: string }[] {
  const labels: { col: number; label: string }[] = []
  let lastMonth = ''
  for (let col = 0; col < weeks.length; col++) {
    // use row 1 (Mon) as representative
    const cell = weeks[col][1]
    if (!cell) continue
    const month = cell.day.slice(0, 7) // YYYY-MM
    if (month !== lastMonth) {
      const [, m] = month.split('-')
      const monthName = new Date(`${month}-01`).toLocaleString('default', { month: 'short' })
      labels.push({ col, label: monthName })
      lastMonth = month
    }
  }
  return labels
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function CalendarPage() {
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [panel, setPanel] = useState<PanelState | null>(null)
  const today = isoToday()

  useEffect(() => {
    async function load() {
      try {
        const r = await fetch('/api/metrics/calendar')
        if (r.ok) setData(await r.json() as CalendarResponse)
      } catch { /* ignore */ } finally {
        setLoading(false)
      }
    }
    load()
    const id = setInterval(load, 30 * 60_000)
    return () => clearInterval(id)
  }, [])

  const weeks = data ? buildWeekGrid(data.days) : []
  const monthLbls = monthLabels(weeks)

  const CELL = 13
  const GAP = 2
  const STEP = CELL + GAP

  return (
    <div className="min-h-screen bg-[#030712] text-slate-300 font-mono">
      <SubPageHeader title="FLEET ACTIVITY CALENDAR">
        {data && (
          <span className="text-[0.55rem] text-slate-600">52 weeks · refreshes 30 min</span>
        )}
      </SubPageHeader>

      <div className="p-4 sm:p-6">
        {loading && (
          <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
            Loading calendar…
          </div>
        )}

        {!loading && weeks.length === 0 && (
          <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
            No activity data found
          </div>
        )}

        {!loading && weeks.length > 0 && (
          <div className="overflow-x-auto">
            <svg
              width={weeks.length * STEP + 30}
              height={7 * STEP + 24}
              style={{ display: 'block' }}
            >
              {/* Month labels */}
              {monthLbls.map(({ col, label }) => (
                <text
                  key={`ml-${col}`}
                  x={30 + col * STEP}
                  y={10}
                  fill="#475569"
                  fontSize={9}
                  fontFamily="monospace"
                >
                  {label}
                </text>
              ))}

              {/* Day-of-week labels */}
              {[1, 3, 5].map((row) => (
                <text
                  key={`dow-${row}`}
                  x={0}
                  y={16 + row * STEP + CELL / 2 + 3}
                  fill="#374151"
                  fontSize={8}
                  fontFamily="monospace"
                >
                  {DOW_LABELS[row].slice(0, 2)}
                </text>
              ))}

              {/* Cells */}
              {weeks.map((week, col) =>
                week.map((cell, row) => {
                  if (!cell) return null
                  const x = 30 + col * STEP
                  const y = 16 + row * STEP
                  const isToday = cell.day === today
                  return (
                    <g key={`${col}-${row}`}>
                      <rect
                        x={x}
                        y={y}
                        width={CELL}
                        height={CELL}
                        rx={2}
                        fill={cellColor(cell.totalTurns)}
                        stroke={isToday ? '#F59E0B' : 'transparent'}
                        strokeWidth={isToday ? 1.5 : 0}
                        style={{ cursor: cell.totalTurns > 0 ? 'pointer' : 'default' }}
                        onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, day: cell })}
                        onMouseLeave={() => setTooltip(null)}
                        onClick={() => { if (cell.totalTurns > 0) setPanel({ day: cell }) }}
                      />
                    </g>
                  )
                })
              )}
            </svg>

            {/* Legend */}
            <div className="flex items-center gap-2 mt-3 text-[0.55rem] text-slate-600">
              <span>Less</span>
              {[0, 3, 10, 30, 60].map((t) => (
                <span
                  key={t}
                  className="inline-block w-3 h-3 rounded-sm"
                  style={{ background: cellColor(t) }}
                />
              ))}
              <span>More</span>
              <span className="ml-4 flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-sm border border-amber-400" style={{ background: '#0d1117' }} />
                Today
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border border-white/10 px-3 py-2 text-[0.6rem]"
          style={{ left: tooltip.x + 12, top: tooltip.y - 60, background: '#0d1b2e' }}
        >
          <div className="text-slate-400 mb-1">{tooltip.day.day}</div>
          <div className="text-cyber-cyan font-bold">{tooltip.day.totalTurns} turns</div>
          {tooltip.day.perProject.slice(0, 3).map((p) => (
            <div key={p.slug} className="text-slate-500 mt-0.5">{p.slug}: {p.turns}</div>
          ))}
          {tooltip.day.perProject.length > 3 && (
            <div className="text-slate-700 mt-0.5">+{tooltip.day.perProject.length - 3} more</div>
          )}
          {tooltip.day.totalTurns > 0 && (
            <div className="text-slate-700 mt-1">Click to expand →</div>
          )}
        </div>
      )}

      {/* Side panel */}
      {panel && (
        <div
          className="fixed inset-y-0 right-0 w-72 bg-[#080f1c] border-l border-cyber-cyan/15 z-40 flex flex-col"
          style={{ boxShadow: '-4px 0 24px rgba(0,0,0,0.6)' }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <span className="text-[0.7rem] font-bold text-cyber-cyan tracking-widest">{panel.day.day}</span>
            <button
              onClick={() => setPanel(null)}
              className="text-slate-600 hover:text-slate-400 text-sm"
            >
              ✕
            </button>
          </div>
          <div className="px-4 py-3 border-b border-white/5">
            <div className="text-[0.6rem] text-slate-500">Total turns</div>
            <div className="text-xl font-bold text-cyber-cyan">{panel.day.totalTurns}</div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <div className="text-[0.55rem] text-slate-600 uppercase tracking-widest mb-2">By project</div>
            {panel.day.perProject.map((p) => {
              const pct = panel.day.totalTurns > 0 ? (p.turns / panel.day.totalTurns) * 100 : 0
              return (
                <div key={p.slug} className="mb-2">
                  <div className="flex justify-between text-[0.6rem] mb-0.5">
                    <span className="text-slate-400 truncate max-w-[160px]">{p.slug}</span>
                    <span className="text-slate-500 shrink-0 ml-2">{p.turns}</span>
                  </div>
                  <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: '#22D3EE' }}
                    />
                  </div>
                </div>
              )
            })}
            {panel.day.perProject.length === 0 && (
              <div className="text-slate-600 text-[0.6rem]">No project data</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

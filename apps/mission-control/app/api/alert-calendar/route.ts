import { getAlertCalendar } from '../../../src/db'

export const dynamic = 'force-dynamic'

export interface AlertCalendarCell {
  count: number
  byType: Record<string, number>
}

export interface AlertCalendarResponse {
  // grid[dow][hour] — dow 0=Sunday…6=Saturday, hour 0–23
  grid: AlertCalendarCell[][]
  total: number
  max: number
  busiest: { dow: number; hour: number; count: number } | null
}

const DAYS_BACK = 30

export async function GET(): Promise<Response> {
  const sinceTs = Math.floor(Date.now() / 1000) - DAYS_BACK * 86400
  // Exclude acknowledged alerts so the heatmap counts only open signal (P196).
  const cells = getAlertCalendar(sinceTs, false)

  const grid: AlertCalendarCell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ count: 0, byType: {} as Record<string, number> }))
  )
  let total = 0
  let max = 0
  let busiest: { dow: number; hour: number; count: number } | null = null

  for (const c of cells) {
    if (c.dow < 0 || c.dow > 6 || c.hour < 0 || c.hour > 23) continue
    const cell = grid[c.dow][c.hour]
    cell.count += c.count
    cell.byType[c.alert_type] = (cell.byType[c.alert_type] ?? 0) + c.count
    total += c.count
  }
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const n = grid[d][h].count
      if (n > max) max = n
      if (busiest == null || n > busiest.count) busiest = { dow: d, hour: h, count: n }
    }
  }
  if (busiest && busiest.count === 0) busiest = null

  return Response.json({ grid, total, max, busiest } satisfies AlertCalendarResponse)
}

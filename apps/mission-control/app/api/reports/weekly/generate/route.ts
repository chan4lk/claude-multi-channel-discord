import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export async function POST(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })

  // Fetch the weekly report via internal call
  const baseUrl = process.env.NEXTAUTH_URL ?? `http://localhost:${process.env.PORT ?? 3000}`
  let report: unknown
  try {
    const res = await fetch(`${baseUrl}/api/reports/weekly`)
    if (!res.ok) throw new Error(`weekly API returned ${res.status}`)
    report = await res.json()
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }

  const reportData = report as { weekStart?: string; weekEnd?: string }
  const weekLabel = reportData.weekStart
    ? `${reportData.weekStart.slice(0, 7)}-W${getISOWeek(reportData.weekStart)}`
    : new Date().toISOString().slice(0, 10)

  const reportsDir = path.join(mcdDir, 'reports')
  fs.mkdirSync(reportsDir, { recursive: true })

  const filePath = path.join(reportsDir, `${weekLabel}.json`)
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8')

  return Response.json({ ok: true, savedTo: filePath, weekLabel })
}

function getISOWeek(dateStr: string): string {
  const d = new Date(dateStr)
  const dayOfYear = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86400000) + 1
  const weekNum = Math.ceil(dayOfYear / 7)
  return String(weekNum).padStart(2, '0')
}

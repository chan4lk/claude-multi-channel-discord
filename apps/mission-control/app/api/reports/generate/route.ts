import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

function getISOWeek(dateStr: string): string {
  const d = new Date(dateStr)
  const dayOfYear = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86400000) + 1
  return String(Math.ceil(dayOfYear / 7)).padStart(2, '0')
}

export async function POST(req: Request): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return new Response(
      `data: ${JSON.stringify({ type: 'error', message: 'MCD_CHANNELS_DIR not set' })}\n\ndata: ${JSON.stringify({ type: 'done' })}\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } },
    )
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? `http://localhost:${process.env.PORT ?? 3000}`

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      function send(data: Record<string, unknown>) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        send({ type: 'status', message: 'Fetching fleet metrics…' })
        const res = await fetch(`${baseUrl}/api/reports/weekly`)
        if (!res.ok) throw new Error(`weekly API returned ${res.status}`)
        const report = await res.json() as { weekStart?: string; weekEnd?: string; weekLabel?: string; generatedAt?: string; fleet?: Record<string, unknown>; projects?: unknown[] }

        send({ type: 'status', message: 'Saving report…' })

        const weekLabel = report.weekStart
          ? `${report.weekStart.slice(0, 7)}-W${getISOWeek(report.weekStart)}`
          : new Date().toISOString().slice(0, 10)

        const reportsDir = path.join(mcdDir, 'reports')
        fs.mkdirSync(reportsDir, { recursive: true })

        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const fileName = `${weekLabel}-ondemand-${ts}.json`
        const filePath = path.join(reportsDir, fileName)

        const saved = { ...report, source: 'on-demand', weekLabel, savedAt: new Date().toISOString() }
        fs.writeFileSync(filePath, JSON.stringify(saved, null, 2), 'utf-8')

        send({ type: 'done', fileName, weekLabel, savedAt: saved.savedAt })
      } catch (err) {
        send({ type: 'error', message: String(err) })
        send({ type: 'done' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

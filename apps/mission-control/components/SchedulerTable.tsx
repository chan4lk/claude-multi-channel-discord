'use client'

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
  ts: number
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export default function SchedulerTable({ events }: Props) {
  const firedEvents = events.filter((ev) => ev.type === 'scheduler_fired')

  if (firedEvents.length === 0) {
    return (
      <div className="text-gray-500 text-sm py-4 text-center">No scheduler activity.</div>
    )
  }

  // Derive latest row per (instance_id, chatId) pair — events are newest-first
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

    rows.push({
      instance_id: ev.instance_id,
      chatId,
      jobId,
      ts: ev.ts,
    })
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-700">
            <th className="pb-2 pr-4 font-medium">Instance</th>
            <th className="pb-2 pr-4 font-medium">Chat ID</th>
            <th className="pb-2 pr-4 font-medium">Job ID</th>
            <th className="pb-2 font-medium">Last Fired</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.instance_id}::${row.chatId}`}
              className="border-b border-gray-800 hover:bg-gray-900 transition-colors"
            >
              <td className="py-2 pr-4 font-mono text-xs text-gray-500">
                {row.instance_id.slice(0, 8)}
              </td>
              <td className="py-2 pr-4 font-mono text-xs text-gray-300 truncate max-w-[140px]" title={row.chatId}>
                {row.chatId}
              </td>
              <td className="py-2 pr-4 text-yellow-300 text-xs truncate max-w-[160px]" title={row.jobId}>
                {row.jobId}
              </td>
              <td className="py-2 text-xs text-gray-400 font-mono">
                {formatTime(row.ts)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

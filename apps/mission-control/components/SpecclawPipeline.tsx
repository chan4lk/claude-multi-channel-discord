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

interface PipelineRow {
  instance_id: string
  slug: string
  statusMd: string
  ts: number
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
      <div className="text-gray-500 text-sm py-4 text-center">No specclaw activity.</div>
    )
  }

  // Derive latest row per (instance_id, slug) pair — events are newest-first
  const seen = new Set<string>()
  const rows: PipelineRow[] = []

  for (const ev of statusEvents) {
    const slug = typeof ev.payload['slug'] === 'string' ? ev.payload['slug'] : '(unknown)'
    const key = `${ev.instance_id}::${slug}`
    if (seen.has(key)) continue
    seen.add(key)

    const rawMd = ev.payload['statusMd']
    const statusMd =
      typeof rawMd === 'string'
        ? rawMd.slice(0, 100)
        : JSON.stringify(rawMd ?? '').slice(0, 100)

    rows.push({
      instance_id: ev.instance_id,
      slug,
      statusMd,
      ts: ev.ts,
    })
  }

  return (
    <div className="flex flex-col gap-1">
      {rows.map((row) => (
        <div
          key={`${row.instance_id}::${row.slug}`}
          className="rounded bg-gray-900 border border-gray-700 px-3 py-2 flex flex-col gap-0.5 hover:border-gray-500 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-gray-500 shrink-0">
              {row.instance_id.slice(0, 8)}
            </span>
            <span className="text-sm font-semibold text-purple-300 truncate" title={row.slug}>
              {row.slug}
            </span>
            <span className="ml-auto text-xs text-gray-500 shrink-0">{formatTime(row.ts)}</span>
          </div>
          <p className="text-xs text-gray-400 truncate font-mono" title={row.statusMd}>
            {row.statusMd || <span className="italic text-gray-600">(no statusMd)</span>}
          </p>
        </div>
      ))}
    </div>
  )
}

'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import SubPageHeader from '../../components/SubPageHeader'
import type { MemoryOrphanReportResponse, OrphanFile } from '../api/memory-orphan-report/route'

const AGE_FILTERS = [
  { label: 'All ages', minDays: 0 },
  { label: '7d+', minDays: 7 },
  { label: '30d+', minDays: 30 },
  { label: '90d+', minDays: 90 },
]

function relAge(ageDays: number): string {
  if (ageDays === 0) return 'today'
  if (ageDays === 1) return '1d ago'
  if (ageDays < 30) return `${ageDays}d ago`
  if (ageDays < 365) return `${Math.floor(ageDays / 30)}mo ago`
  return `${Math.floor(ageDays / 365)}y ago`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="font-mono text-[0.5rem] px-2 py-0.5 rounded border border-white/10 text-slate-500 hover:text-white hover:border-white/30 transition-colors"
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? '✓' : 'copy'}
    </button>
  )
}

function OrphanRow({ orphan }: { orphan: OrphanFile }) {
  return (
    <tr className="border-b border-white/5 hover:bg-white/2">
      <td className="px-3 py-2">
        <span className="font-mono text-[0.6rem] text-cyan-400">{orphan.project}</span>
      </td>
      <td className="px-3 py-2 max-w-[160px]">
        <span className="font-mono text-xs text-white truncate block" title={orphan.file}>
          {orphan.file.replace(/\.md$/, '')}
        </span>
        {orphan.snippet && (
          <span className="font-mono text-[0.5rem] text-slate-500 truncate block" title={orphan.snippet}>
            {orphan.snippet}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <span className="font-mono text-[0.6rem] text-slate-400">{relAge(orphan.ageDays)}</span>
      </td>
      <td className="px-3 py-2 text-right">
        <span className="font-mono text-[0.6rem] text-slate-400">{orphan.wordCount}</span>
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-2 items-center">
          <CopyButton text={`memory/${orphan.file}`} />
          <a
            href={`/memory-link-graph?project=${encodeURIComponent(orphan.project)}`}
            className="font-mono text-[0.5rem] px-2 py-0.5 rounded border border-purple-500/20 text-purple-400 hover:border-purple-400/50 transition-colors"
          >
            graph ↗
          </a>
        </div>
      </td>
    </tr>
  )
}

function OrphanReportInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [data, setData] = useState<MemoryOrphanReportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const projectFilter = searchParams.get('project') ?? 'all'
  const minDaysParam = parseInt(searchParams.get('minDays') ?? '0', 10)
  const minDays = isNaN(minDaysParam) ? 0 : minDaysParam

  const load = useCallback(() => {
    fetch('/api/memory-orphan-report')
      .then((r) => r.json())
      .then((d) => setData(d as MemoryOrphanReportResponse))
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  function setParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (value === 'all' || value === '0') p.delete(key)
    else p.set(key, value)
    router.replace(`?${p.toString()}`, { scroll: false })
  }

  const allProjects = data ? [...new Set(data.orphans.map((o) => o.project))].sort() : []

  const filtered = data
    ? data.orphans.filter(
        (o) =>
          (projectFilter === 'all' || o.project === projectFilter) &&
          o.ageDays >= minDays,
      )
    : []

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-white/5">
        <SubPageHeader title="Memory Orphan Report">
          {data && (
            <div className="flex gap-4 font-mono text-[0.6rem] text-slate-400">
              <span>
                Orphans: <span className="text-amber-400">{filtered.length}</span>
                {projectFilter === 'all' && (
                  <> / {data.totalFiles} ({data.orphanRate}%)</>
                )}
              </span>
              <span className="text-slate-600">{data.generatedAt.slice(0, 19).replace('T', ' ')}</span>
            </div>
          )}
        </SubPageHeader>
      </div>

      <div className="p-6">
        {error && <p className="font-mono text-red-400 text-xs mb-4">{error}</p>}
        {!data && !error && <p className="font-mono text-slate-500 text-xs">Loading…</p>}

        {data && (
          <>
            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-6">
              {/* Project filter */}
              <div className="flex items-center gap-2">
                <span className="font-mono text-[0.55rem] text-slate-500">Project:</span>
                <select
                  value={projectFilter}
                  onChange={(e) => setParam('project', e.target.value)}
                  className="font-mono text-[0.6rem] bg-slate-900 border border-white/10 rounded px-2 py-1 text-white"
                >
                  <option value="all">All ({data.orphans.length})</option>
                  {allProjects.map((p) => (
                    <option key={p} value={p}>
                      {p} ({data.orphans.filter((o) => o.project === p).length})
                    </option>
                  ))}
                </select>
              </div>

              {/* Age filter */}
              <div className="flex items-center gap-2">
                <span className="font-mono text-[0.55rem] text-slate-500">Min age:</span>
                <div className="flex gap-1">
                  {AGE_FILTERS.map((f) => {
                    const active = f.minDays === minDays
                    return (
                      <button
                        key={f.minDays}
                        onClick={() => setParam('minDays', String(f.minDays))}
                        className="font-mono text-[0.55rem] px-2 py-1 rounded border transition-colors"
                        style={{
                          background: active ? 'rgba(34,211,238,0.1)' : 'rgba(255,255,255,0.03)',
                          borderColor: active ? '#22D3EE55' : 'rgba(255,255,255,0.08)',
                          color: active ? '#22D3EE' : '#64748B',
                        }}
                      >
                        {f.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="text-center py-16">
                <div className="font-mono text-2xl mb-2">✓</div>
                <p className="font-mono text-slate-400 text-sm">No orphaned memory files found.</p>
                <p className="font-mono text-slate-600 text-xs mt-1">All memory files have at least one [[link]] connection.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/8">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10 text-left">
                      <th className="px-3 py-2 font-mono text-[0.55rem] text-slate-500 uppercase tracking-wider">Project</th>
                      <th className="px-3 py-2 font-mono text-[0.55rem] text-slate-500 uppercase tracking-wider">File</th>
                      <th className="px-3 py-2 font-mono text-[0.55rem] text-slate-500 uppercase tracking-wider text-right">Age</th>
                      <th className="px-3 py-2 font-mono text-[0.55rem] text-slate-500 uppercase tracking-wider text-right">Words</th>
                      <th className="px-3 py-2 font-mono text-[0.55rem] text-slate-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((o) => (
                      <OrphanRow key={o.id} orphan={o} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function MemoryOrphanReportPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 text-white p-6 font-mono text-slate-500 text-xs">Loading…</div>}>
      <OrphanReportInner />
    </Suspense>
  )
}

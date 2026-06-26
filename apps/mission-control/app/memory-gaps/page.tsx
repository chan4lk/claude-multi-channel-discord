'use client'

import { useEffect, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { MemoryGapsResponse, MemoryGapProject, MemoryType } from '../api/memory-gaps/route'

const TYPES: MemoryType[] = ['user', 'feedback', 'project', 'reference']
type SortKey = 'gap' | 'slug' | 'files' | MemoryType

function Check({ present }: { present: boolean }) {
  return (
    <span style={{ color: present ? '#22C55E' : '#EF4444' }} className="font-mono text-sm">
      {present ? '✓' : '✗'}
    </span>
  )
}

function SortButton({
  col, current, onClick,
}: { col: SortKey; current: SortKey; onClick: () => void }) {
  const active = col === current
  return (
    <button
      onClick={onClick}
      className="text-[0.5rem] font-mono uppercase tracking-wider transition-colors"
      style={{ color: active ? '#22D3EE' : '#475569' }}
    >
      {col} {active ? '▼' : ''}
    </button>
  )
}

export default function MemoryGapsPage() {
  const [data, setData] = useState<MemoryGapsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeOnly, setActiveOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('gap')

  useEffect(() => {
    fetch('/api/memory-gaps')
      .then((r) => r.json())
      .then((d: MemoryGapsResponse) => { setData(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [])

  const projects = (data?.projects ?? [])
    .filter((p) => !activeOnly || p.isActive)
    .slice()
    .sort((a, b) => {
      switch (sortKey) {
        case 'gap': return b.gapCount - a.gapCount
        case 'slug': return a.slug.localeCompare(b.slug)
        case 'files': return b.totalFiles - a.totalFiles
        default: return (b.typeCounts[sortKey] ?? 0) - (a.typeCounts[sortKey] ?? 0)
      }
    })

  const allCovered = projects.length > 0 && projects.every((p) => p.gapCount === 0)

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Memory Coverage Gap Detector">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Projects missing canonical memory types · sorted by gap count
        </span>
      </SubPageHeader>

      {loading && <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>}
      {error && <div className="text-center py-20 text-red-500 font-mono text-sm">{error}</div>}

      {!loading && !error && (
        <div className="max-w-5xl mx-auto">
          {/* Controls */}
          <div className="flex items-center gap-4 mb-5">
            <label className="flex items-center gap-2 cursor-pointer text-[0.6rem] font-mono text-slate-400">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(e) => setActiveOnly(e.target.checked)}
                className="accent-cyan-400"
              />
              Active projects only (transcript &lt; 7d)
            </label>
            <span className="text-[0.5rem] font-mono text-slate-600">
              {projects.length} project{projects.length !== 1 ? 's' : ''}
            </span>
          </div>

          {allCovered ? (
            <div className="text-center py-20 text-green-400 font-mono text-sm">
              All projects fully covered — no memory gaps detected ✓
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              No projects found
            </div>
          ) : (
            <div className="rounded-lg border border-white/5 overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.02)' }}>
              <table className="w-full text-[0.55rem] font-mono">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left px-3 py-2">
                      <SortButton col="slug" current={sortKey} onClick={() => setSortKey('slug')} />
                    </th>
                    <th className="px-2 py-2 text-center">
                      <span className="text-[0.5rem] font-mono text-slate-500 uppercase">active</span>
                    </th>
                    <th className="px-2 py-2 text-center">
                      <span className="text-[0.5rem] font-mono text-slate-500 uppercase">mem dir</span>
                    </th>
                    {TYPES.map((t) => (
                      <th key={t} className="px-2 py-2 text-center">
                        <SortButton col={t} current={sortKey} onClick={() => setSortKey(t)} />
                      </th>
                    ))}
                    <th className="px-2 py-2 text-center">
                      <SortButton col="files" current={sortKey} onClick={() => setSortKey('files')} />
                    </th>
                    <th className="px-2 py-2 text-center">
                      <SortButton col="gap" current={sortKey} onClick={() => setSortKey('gap')} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.slug}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                      style={{ opacity: p.isActive ? 1 : 0.55 }}>
                      <td className="px-3 py-1.5 text-slate-300 max-w-[140px] truncate">{p.slug}</td>
                      <td className="px-2 py-1.5 text-center">
                        {p.isActive
                          ? <span className="text-green-400">●</span>
                          : <span className="text-slate-700">○</span>}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <Check present={p.hasMemoryDir} />
                      </td>
                      {TYPES.map((t) => (
                        <td key={t} className="px-2 py-1.5 text-center">
                          {p.hasMemoryDir ? (
                            <Check present={p.typeCounts[t] > 0} />
                          ) : (
                            <span className="text-slate-700">—</span>
                          )}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-center text-slate-500">{p.totalFiles}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span style={{
                          color: p.gapCount === 0 ? '#22C55E' : p.gapCount >= 4 ? '#EF4444' : '#F59E0B',
                          fontWeight: p.gapCount > 0 ? 'bold' : 'normal',
                        }}>
                          {p.gapCount}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && (
            <div className="text-[0.5rem] font-mono text-slate-700 text-right mt-3">
              Generated {new Date(data.generatedAt).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

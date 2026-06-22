'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { MemoryAuditResponse, MemoryEntry, MemoryType } from '../api/memory-audit/route'

const TYPE_COLOR: Record<MemoryType, string> = {
  user: '#22D3EE',
  feedback: '#F59E0B',
  project: '#4ADE80',
  reference: '#A78BFA',
  unknown: '#6B7280',
}

const TYPE_ICON: Record<MemoryType, string> = {
  user: '◈',
  feedback: '◎',
  project: '◱',
  reference: '⊞',
  unknown: '?',
}

const ALL_TYPES: Array<MemoryType | 'all'> = ['all', 'user', 'feedback', 'project', 'reference', 'unknown']

type SortKey = 'lastModified' | 'project' | 'name' | 'type'

function formatAge(ms: number): string {
  const diff = Date.now() - ms
  const days = Math.floor(diff / 86_400_000)
  const hours = Math.floor(diff / 3_600_000)
  const mins = Math.floor(diff / 60_000)
  if (days >= 1) return `${days}d ago`
  if (hours >= 1) return `${hours}h ago`
  return `${mins}m ago`
}

function Drawer({
  entry,
  onClose,
}: {
  entry: MemoryEntry
  onClose: () => void
}) {
  const color = TYPE_COLOR[entry.type]
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col border-l"
        style={{
          width: 'min(520px, 90vw)',
          background: '#060b12',
          borderColor: `${color}25`,
          boxShadow: `-16px 0 48px rgba(0,0,0,0.8)`,
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{ borderColor: `${color}20` }}
        >
          <div>
            <div className="flex items-center gap-2">
              <span style={{ color, fontSize: '0.9rem' }}>{TYPE_ICON[entry.type]}</span>
              <span className="text-sm font-bold font-mono text-slate-100">{entry.name}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded uppercase tracking-widest"
                style={{ background: `${color}18`, color }}
              >
                {entry.type}
              </span>
              <span className="text-[0.55rem] font-mono text-slate-500">{entry.project}</span>
              <span className="text-[0.55rem] font-mono text-slate-600">{entry.filename}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200 transition-colors text-lg leading-none ml-4 shrink-0"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-3 border-b shrink-0" style={{ borderColor: `${color}15` }}>
          <div className="text-[0.6rem] uppercase tracking-widest text-slate-600 mb-1">Description</div>
          <p className="text-xs text-slate-400 font-mono">
            {entry.description || <span className="text-slate-600 italic">No description</span>}
          </p>
        </div>

        <div className="px-5 py-2 border-b shrink-0 flex items-center gap-4" style={{ borderColor: `${color}15` }}>
          <div className="text-[0.55rem] text-slate-600">
            Modified: <span className="text-slate-400">{new Date(entry.lastModifiedMs).toLocaleString()}</span>
          </div>
          {entry.isStale && (
            <span className="text-[0.55rem] text-amber-500" title="Not updated in 30+ days">
              🕐 stale
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="text-[0.6rem] uppercase tracking-widest text-slate-600 mb-2">Memory Body</div>
          <pre
            className="text-[0.65rem] font-mono text-slate-300 whitespace-pre-wrap leading-relaxed"
            style={{ wordBreak: 'break-word' }}
          >
            {entry.body || <span className="text-slate-600 italic">Empty body</span>}
          </pre>
        </div>
      </div>
    </>
  )
}

export default function MemoryAuditPage() {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState('')
  const [typeFilter, setTypeFilter] = useState<MemoryType | 'all'>('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('lastModified')
  const [sortAsc, setSortAsc] = useState(false)
  const [selected, setSelected] = useState<MemoryEntry | null>(null)
  const searchDebounce = useRef<ReturnType<typeof setTimeout>>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const loadData = useCallback(() => {
    setLoading(true)
    fetch('/api/memory-audit')
      .then((r) => r.json())
      .then((data: MemoryAuditResponse) => {
        setEntries(data.entries)
        setLastUpdated(new Date().toLocaleTimeString())
      })
      .catch(() => {/* ignore */})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadData()
    const id = setInterval(loadData, 120_000)
    return () => clearInterval(id)
  }, [loadData])

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => setDebouncedSearch(search), 250)
  }, [search])

  const filtered = useMemo(() => {
    let result = entries
    if (typeFilter !== 'all') result = result.filter((e) => e.type === typeFilter)
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.project.toLowerCase().includes(q)
      )
    }
    result = [...result].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'lastModified') cmp = a.lastModifiedMs - b.lastModifiedMs
      else if (sortKey === 'project') cmp = a.project.localeCompare(b.project)
      else if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'type') cmp = a.type.localeCompare(b.type)
      return sortAsc ? cmp : -cmp
    })
    return result
  }, [entries, typeFilter, debouncedSearch, sortKey, sortAsc])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v)
    else { setSortKey(key); setSortAsc(false) }
  }

  const SortIcon = ({ k }: { k: SortKey }) => (
    <span className="text-[0.5rem]" style={{ color: sortKey === k ? '#22D3EE' : '#374151' }}>
      {sortKey === k ? (sortAsc ? '↑' : '↓') : '⇅'}
    </span>
  )

  const staleCount = entries.filter((e) => e.isStale).length

  return (
    <div className="min-h-dvh flex flex-col font-mono" style={{ background: '#0a0a0a' }}>
      <SubPageHeader title="MEMORY AUDIT TRAIL">
        <span className="text-[0.55rem] font-mono text-slate-600">
          {loading ? 'loading...' : `${entries.length} memories · ${filtered.length} shown`}
          {staleCount > 0 && (
            <span className="ml-2 text-amber-500">🕐 {staleCount} stale</span>
          )}
          {lastUpdated && <span className="ml-2">{lastUpdated}</span>}
        </span>
      </SubPageHeader>

      {/* Filters */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap"
        style={{ borderColor: '#1f2937' }}
      >
        {/* Type chips */}
        <div className="flex items-center gap-1">
          {ALL_TYPES.map((t) => {
            const color = t === 'all' ? '#22D3EE' : TYPE_COLOR[t as MemoryType]
            const isActive = typeFilter === t
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(t as MemoryType | 'all')}
                className="flex items-center gap-1 text-[0.58rem] font-mono px-2 py-0.5 rounded-full border transition-all uppercase tracking-wider"
                style={{
                  borderColor: isActive ? color : '#1e3a5f',
                  color: isActive ? color : '#475569',
                  background: isActive ? `${color}15` : 'transparent',
                }}
              >
                {t !== 'all' && <span>{TYPE_ICON[t as MemoryType]}</span>}
                {t}
              </button>
            )
          })}
        </div>

        {/* Search */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, description, project…"
          className="ml-auto bg-transparent border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-slate-300 placeholder-slate-700 outline-none focus:border-cyber-cyan/40 w-56"
        />
      </div>

      {/* Table */}
      <main className="flex-1 overflow-auto">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <span className="text-cyan-400/40 text-sm animate-pulse">Scanning memories...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <span className="text-slate-600 text-sm">No memories found</span>
            {(typeFilter !== 'all' || debouncedSearch) && (
              <button
                onClick={() => { setTypeFilter('all'); setSearch('') }}
                className="text-[0.6rem] text-cyan-500 underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b" style={{ borderColor: '#1f2937', background: '#0d1117' }}>
                <th className="text-left px-4 py-2 text-[0.55rem] uppercase tracking-widest text-slate-600 font-normal w-8">
                  Type
                </th>
                <th
                  className="text-left px-3 py-2 text-[0.55rem] uppercase tracking-widest text-slate-600 font-normal cursor-pointer hover:text-slate-400"
                  onClick={() => toggleSort('project')}
                >
                  <span className="flex items-center gap-1">Project <SortIcon k="project" /></span>
                </th>
                <th
                  className="text-left px-3 py-2 text-[0.55rem] uppercase tracking-widest text-slate-600 font-normal cursor-pointer hover:text-slate-400"
                  onClick={() => toggleSort('name')}
                >
                  <span className="flex items-center gap-1">Name <SortIcon k="name" /></span>
                </th>
                <th className="text-left px-3 py-2 text-[0.55rem] uppercase tracking-widest text-slate-600 font-normal hidden md:table-cell">
                  Description
                </th>
                <th
                  className="text-left px-3 py-2 text-[0.55rem] uppercase tracking-widest text-slate-600 font-normal cursor-pointer hover:text-slate-400"
                  onClick={() => toggleSort('lastModified')}
                >
                  <span className="flex items-center gap-1">Modified <SortIcon k="lastModified" /></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => {
                const color = TYPE_COLOR[entry.type]
                return (
                  <tr
                    key={entry.id}
                    className="border-b cursor-pointer transition-colors hover:bg-cyber-cyan/5"
                    style={{ borderColor: '#111827' }}
                    onClick={() => setSelected(entry)}
                  >
                    <td className="px-4 py-2.5">
                      <span style={{ color, fontSize: '0.85rem' }}>{TYPE_ICON[entry.type]}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-[0.65rem] font-mono text-slate-400">{entry.project}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-[0.65rem] font-mono text-slate-200">{entry.name}</span>
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell max-w-xs">
                      <span className="text-[0.6rem] font-mono text-slate-500 truncate block">
                        {entry.description || <span className="text-slate-700 italic">—</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="text-[0.6rem] font-mono text-slate-500">
                        {formatAge(entry.lastModifiedMs)}
                      </span>
                      {entry.isStale && (
                        <span className="ml-1 text-[0.55rem] text-amber-500" title="Not updated in 30+ days">🕐</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </main>

      {selected && (
        <Drawer entry={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface SnapshotProject {
  slug: string
  state: string
  ageMins: number
  monthlyTokensUsed: number
  monthlyTokenBudget: number
  goalText: string
  goalStatus: string
}

interface SnapshotData {
  idle: number
  active: number
  stalled: number
  autonomous: number
  projects: SnapshotProject[]
}

interface SnapshotRow {
  id: number
  label: string
  ts: number
  project_count: number
  data: string
}

const STATE_COLOR: Record<string, string> = {
  active: '#4ADE80',
  idle: '#00F5FF',
  stalled: '#EF4444',
  autonomous: '#A78BFA',
}

function stateColor(s: string): string {
  return STATE_COLOR[s] ?? '#94a3b8'
}

function formatTs(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

interface DiffProject {
  slug: string
  kind: 'added' | 'removed' | 'changed' | 'same'
  aState?: string
  bState?: string
  aTurns?: number
  bTurns?: number
  aTokens?: number
  bTokens?: number
}

function diffSnapshots(a: SnapshotData, b: SnapshotData): DiffProject[] {
  const slugsA = new Map(a.projects.map(p => [p.slug, p]))
  const slugsB = new Map(b.projects.map(p => [p.slug, p]))
  const allSlugs = new Set([...slugsA.keys(), ...slugsB.keys()])
  const result: DiffProject[] = []

  for (const slug of allSlugs) {
    const pa = slugsA.get(slug)
    const pb = slugsB.get(slug)
    if (!pa) {
      result.push({ slug, kind: 'added', bState: pb!.state, bTokens: pb!.monthlyTokensUsed })
    } else if (!pb) {
      result.push({ slug, kind: 'removed', aState: pa.state, aTokens: pa.monthlyTokensUsed })
    } else if (pa.state !== pb.state || pa.monthlyTokensUsed !== pb.monthlyTokensUsed) {
      result.push({
        slug, kind: 'changed',
        aState: pa.state, bState: pb.state,
        aTokens: pa.monthlyTokensUsed, bTokens: pb.monthlyTokensUsed,
      })
    } else {
      result.push({ slug, kind: 'same', aState: pa.state, aTokens: pa.monthlyTokensUsed })
    }
  }

  // Sort: removed, added, changed, same
  const order = { removed: 0, added: 1, changed: 2, same: 3 }
  return result.sort((x, y) => order[x.kind] - order[y.kind])
}

export default function SnapshotsPage() {
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([])
  const [loading, setLoading] = useState(true)
  const [taking, setTaking] = useState(false)
  const [labelInput, setLabelInput] = useState('')
  const [selectedA, setSelectedA] = useState<number | null>(null)
  const [selectedB, setSelectedB] = useState<number | null>(null)
  const [diffData, setDiffData] = useState<DiffProject[] | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [snapshotALabel, setSnapshotALabel] = useState('')
  const [snapshotBLabel, setSnapshotBLabel] = useState('')

  const loadSnapshots = useCallback(async () => {
    const res = await fetch('/api/snapshots')
    if (!res.ok) return
    const data = await res.json() as { snapshots: SnapshotRow[] }
    setSnapshots(data.snapshots)
    setLoading(false)
  }, [])

  useEffect(() => { void loadSnapshots() }, [loadSnapshots])

  async function takeSnapshot() {
    setTaking(true)
    try {
      const res = await fetch('/api/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: labelInput }),
      })
      if (res.ok) {
        setLabelInput('')
        await loadSnapshots()
      }
    } finally {
      setTaking(false)
    }
  }

  async function deleteSnapshot(id: number) {
    await fetch(`/api/snapshots?id=${id}`, { method: 'DELETE' })
    setSnapshots(prev => prev.filter(s => s.id !== id))
    if (selectedA === id) setSelectedA(null)
    if (selectedB === id) setSelectedB(null)
    if (selectedA === id || selectedB === id) setDiffData(null)
  }

  async function loadDiff(idA: number, idB: number) {
    setDiffLoading(true)
    setDiffData(null)
    try {
      const [resA, resB] = await Promise.all([
        fetch(`/api/snapshots?id=${idA}`),
        fetch(`/api/snapshots?id=${idB}`),
      ])
      if (!resA.ok || !resB.ok) return
      const rowA = await resA.json() as SnapshotRow
      const rowB = await resB.json() as SnapshotRow
      const dataA = JSON.parse(rowA.data) as SnapshotData
      const dataB = JSON.parse(rowB.data) as SnapshotData
      setSnapshotALabel(`#${rowA.id} ${rowA.label || formatTs(rowA.ts)}`)
      setSnapshotBLabel(`#${rowB.id} ${rowB.label || formatTs(rowB.ts)}`)
      setDiffData(diffSnapshots(dataA, dataB))
    } finally {
      setDiffLoading(false)
    }
  }

  function handleSelect(id: number) {
    if (selectedA === id) {
      setSelectedA(null)
      setDiffData(null)
      return
    }
    if (selectedB === id) {
      setSelectedB(null)
      setDiffData(null)
      return
    }
    if (selectedA === null) {
      setSelectedA(id)
    } else if (selectedB === null) {
      const newB = id
      setSelectedB(newB)
      void loadDiff(selectedA, newB)
    } else {
      setSelectedA(id)
      setSelectedB(null)
      setDiffData(null)
    }
  }

  const kindColor: Record<DiffProject['kind'], string> = {
    added: '#4ADE80',
    removed: '#EF4444',
    changed: '#FCD34D',
    same: '#475569',
  }
  const kindIcon: Record<DiffProject['kind'], string> = {
    added: '+',
    removed: '−',
    changed: '~',
    same: '=',
  }

  return (
    <div className="min-h-dvh bg-[#050b14] text-slate-200 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/" className="text-slate-500 hover:text-cyber-cyan transition-colors text-sm font-mono">
          ← Mission Control
        </Link>
        <h1
          className="text-lg font-bold tracking-wider uppercase"
          style={{ fontFamily: 'Orbitron, monospace', color: '#00F5FF', textShadow: '0 0 20px #00F5FF50' }}
        >
          Fleet State Snapshots
        </h1>
      </div>

      {/* Take snapshot */}
      <div
        className="rounded-xl border p-4 mb-6 flex flex-wrap items-center gap-3"
        style={{ background: '#0a1628', borderColor: '#00F5FF20' }}
      >
        <input
          type="text"
          value={labelInput}
          onChange={e => setLabelInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void takeSnapshot() }}
          placeholder="Label (optional)…"
          className="text-xs font-mono bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyber-cyan/50 flex-1 min-w-0"
        />
        <button
          onClick={() => void takeSnapshot()}
          disabled={taking}
          className="text-xs font-mono px-4 py-1.5 rounded border transition-all disabled:opacity-50"
          style={{ background: '#00F5FF18', color: '#00F5FF', borderColor: '#00F5FF40', boxShadow: '0 0 12px #00F5FF18' }}
        >
          {taking ? 'Taking…' : '📸 Take Snapshot'}
        </button>
        <span className="text-[0.65rem] font-mono text-slate-600">
          Select two snapshots below to diff them
        </span>
      </div>

      {/* Diff panel */}
      {(selectedA !== null || selectedB !== null) && (
        <div
          className="rounded-xl border p-4 mb-6"
          style={{ background: '#0a1628', borderColor: '#FCD34D30' }}
        >
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-mono text-slate-500">
              Comparing:
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: '#00F5FF18', color: '#00F5FF' }}>
              {selectedA !== null ? `#${selectedA}` : '— pick first'}
            </span>
            <span className="text-slate-600 text-xs">→</span>
            <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: '#FCD34D18', color: '#FCD34D' }}>
              {selectedB !== null ? `#${selectedB}` : '— pick second'}
            </span>
            {(selectedA !== null || selectedB !== null) && (
              <button
                onClick={() => { setSelectedA(null); setSelectedB(null); setDiffData(null) }}
                className="ml-auto text-[0.6rem] font-mono text-slate-600 hover:text-slate-400 transition-colors"
              >
                ✕ Clear
              </button>
            )}
          </div>

          {diffLoading && (
            <div className="text-xs font-mono text-slate-600 py-2">Loading diff…</div>
          )}

          {diffData && !diffLoading && (
            <>
              <div className="text-[0.6rem] font-mono text-slate-600 mb-3 uppercase tracking-wider">
                {snapshotALabel} → {snapshotBLabel}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left px-2 py-1.5 text-slate-600 font-semibold uppercase tracking-wider">Δ</th>
                      <th className="text-left px-2 py-1.5 text-slate-600 font-semibold uppercase tracking-wider">Project</th>
                      <th className="text-left px-2 py-1.5 text-slate-600 font-semibold uppercase tracking-wider">State Before</th>
                      <th className="text-left px-2 py-1.5 text-slate-600 font-semibold uppercase tracking-wider">State After</th>
                      <th className="text-left px-2 py-1.5 text-slate-600 font-semibold uppercase tracking-wider">Token Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffData.filter(d => d.kind !== 'same').length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-4 text-slate-600">No changes between snapshots.</td>
                      </tr>
                    )}
                    {diffData.filter(d => d.kind !== 'same').map(d => (
                      <tr key={d.slug} className="border-b border-slate-800/50">
                        <td className="px-2 py-1.5">
                          <span
                            className="inline-flex items-center justify-center w-5 h-5 rounded text-[0.7rem] font-bold"
                            style={{ background: `${kindColor[d.kind]}18`, color: kindColor[d.kind] }}
                          >
                            {kindIcon[d.kind]}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <Link
                            href={`/projects/${d.slug}`}
                            className="hover:underline"
                            style={{ color: '#00F5FF80' }}
                          >
                            {d.slug}
                          </Link>
                        </td>
                        <td className="px-2 py-1.5">
                          {d.aState ? (
                            <span style={{ color: stateColor(d.aState) }}>{d.aState}</span>
                          ) : <span className="text-slate-700">—</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          {d.bState ? (
                            <span style={{ color: stateColor(d.bState) }}>{d.bState}</span>
                          ) : <span className="text-slate-700">—</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          {d.aTokens != null && d.bTokens != null ? (
                            <span style={{ color: d.bTokens > d.aTokens ? '#FCD34D' : '#4ADE80' }}>
                              {d.bTokens > d.aTokens ? '+' : ''}{(d.bTokens - d.aTokens).toLocaleString()}
                            </span>
                          ) : <span className="text-slate-700">—</span>}
                        </td>
                      </tr>
                    ))}
                    {diffData.filter(d => d.kind === 'same').length > 0 && (
                      <tr>
                        <td colSpan={5} className="px-2 py-1.5 text-slate-700 text-[0.65rem]">
                          + {diffData.filter(d => d.kind === 'same').length} unchanged project{diffData.filter(d => d.kind === 'same').length !== 1 ? 's' : ''}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Snapshot list */}
      {loading ? (
        <div className="text-slate-600 font-mono text-sm py-8 text-center">Loading snapshots…</div>
      ) : snapshots.length === 0 ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ background: '#0a1628', borderColor: '#00F5FF15' }}
        >
          <div className="text-2xl mb-2">📸</div>
          <div className="text-slate-500 font-mono text-sm">No snapshots yet.</div>
          <div className="text-slate-700 font-mono text-xs mt-1">Take a snapshot to begin tracking fleet state over time.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {snapshots.map(snap => {
            const isA = selectedA === snap.id
            const isB = selectedB === snap.id
            const selected = isA || isB

            let data: SnapshotData | null = null
            try { data = JSON.parse(snap.data) as SnapshotData } catch {}

            return (
              <div
                key={snap.id}
                onClick={() => handleSelect(snap.id)}
                className="rounded-xl border p-3 cursor-pointer transition-all"
                style={{
                  background: selected ? '#0a1628' : '#070e1c',
                  borderColor: isA ? '#00F5FF50' : isB ? '#FCD34D50' : '#1e293b',
                  boxShadow: isA ? '0 0 16px #00F5FF10' : isB ? '0 0 16px #FCD34D10' : 'none',
                }}
              >
                <div className="flex items-center gap-3">
                  {/* Selection indicator */}
                  <span
                    className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded shrink-0"
                    style={isA
                      ? { background: '#00F5FF18', color: '#00F5FF' }
                      : isB
                        ? { background: '#FCD34D18', color: '#FCD34D' }
                        : { background: '#1e293b', color: '#475569' }
                    }
                  >
                    {isA ? 'A' : isB ? 'B' : '○'}
                  </span>

                  {/* ID */}
                  <span className="text-slate-600 font-mono text-xs shrink-0">#{snap.id}</span>

                  {/* Label + timestamp */}
                  <div className="flex-1 min-w-0">
                    {snap.label ? (
                      <span className="text-slate-300 font-mono text-xs">{snap.label}</span>
                    ) : (
                      <span className="text-slate-500 font-mono text-xs italic">Unlabeled</span>
                    )}
                    <span className="text-slate-700 font-mono text-[0.6rem] ml-2">{formatTs(snap.ts)}</span>
                  </div>

                  {/* Project count */}
                  <span className="text-slate-500 font-mono text-[0.65rem] shrink-0">
                    {snap.project_count} project{snap.project_count !== 1 ? 's' : ''}
                  </span>

                  {/* State breakdown */}
                  {data && (
                    <div className="flex gap-1.5 shrink-0">
                      {(['idle', 'active', 'stalled', 'autonomous'] as const).map(s => {
                        const count = data![s] ?? 0
                        if (count === 0) return null
                        return (
                          <span
                            key={s}
                            className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded"
                            style={{ background: `${stateColor(s)}18`, color: stateColor(s) }}
                          >
                            {count} {s}
                          </span>
                        )
                      })}
                    </div>
                  )}

                  {/* Delete */}
                  <button
                    onClick={e => { e.stopPropagation(); void deleteSnapshot(snap.id) }}
                    className="text-slate-700 hover:text-red-500 transition-colors text-xs shrink-0 ml-1"
                    title="Delete snapshot"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="mt-6 text-center text-[0.6rem] text-slate-700 font-mono">
        Click a snapshot to select A, click another to select B → diff appears above
      </p>
    </div>
  )
}

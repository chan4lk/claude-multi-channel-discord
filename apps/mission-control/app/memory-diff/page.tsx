'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import type { MemoryDiffResponse, ProjectMemoryDiff, MemoryDiffEntry } from '../api/memory-diff/route'

function fmtTs(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function DriftChip({ score }: { score: number }) {
  const color = score >= 50 ? '#F59E0B' : score >= 20 ? '#38BDF8' : '#4ADE80'
  const label = score >= 50 ? 'high drift' : score >= 20 ? 'moderate' : 'stable'
  return (
    <span
      className="text-[0.5rem] font-mono px-1.5 py-0.5 rounded"
      style={{ color, background: `${color}18` }}
      title={`Drift score: ${score}%`}
    >
      {score}% {label}
    </span>
  )
}

function DiffBlock({ entry, open, onToggle }: { entry: MemoryDiffEntry; open: boolean; onToggle: () => void }) {
  return (
    <div
      className="rounded border transition-colors"
      style={{ borderColor: open ? 'rgba(0,245,255,0.18)' : 'rgba(0,245,255,0.06)', background: 'rgba(0,0,0,0.25)' }}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2 text-left"
      >
        <span className="text-[0.55rem] font-mono text-slate-500">{fmtTs(entry.ts)}</span>
        <code className="text-[0.5rem] font-mono text-slate-600">{entry.sha.slice(0, 7)}</code>
        <span className="text-[0.55rem] font-mono text-emerald-400">+{entry.added}</span>
        <span className="text-[0.55rem] font-mono text-red-400">-{entry.removed}</span>
        <span className="ml-auto text-[0.5rem] font-mono text-slate-700">{open ? '▲ hide' : '▼ diff'}</span>
      </button>
      {open && entry.diff && (
        <div className="px-3 pb-3 overflow-x-auto">
          <pre className="text-[0.55rem] font-mono leading-relaxed whitespace-pre">
            {entry.diff.split('\n').map((line, i) => {
              const color = line.startsWith('+') && !line.startsWith('+++')
                ? '#4ADE80'
                : line.startsWith('-') && !line.startsWith('---')
                  ? '#F87171'
                  : line.startsWith('@@')
                    ? '#818CF8'
                    : '#64748b'
              return (
                <span key={i} style={{ color, display: 'block' }}>{line}</span>
              )
            })}
          </pre>
        </div>
      )}
    </div>
  )
}

function ProjectSection({ proj }: { proj: ProjectMemoryDiff }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const entries = showAll ? proj.entries : proj.entries.slice(0, 5)

  function toggle(sha: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(sha)) next.delete(sha)
      else next.add(sha)
      return next
    })
  }

  return (
    <div
      className="rounded-lg border p-4 flex flex-col gap-3"
      style={{ borderColor: 'rgba(0,245,255,0.08)', background: 'rgba(0,245,255,0.01)' }}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-slate-200">{proj.slug}</span>
          <DriftChip score={proj.driftScore} />
        </div>
        <span className="text-[0.5rem] font-mono text-slate-700">{proj.entries.length} change{proj.entries.length !== 1 ? 's' : ''} (7d)</span>
      </div>

      <div className="flex flex-col gap-1.5">
        {entries.map((e) => (
          <DiffBlock
            key={e.sha}
            entry={e}
            open={expanded.has(e.sha)}
            onToggle={() => toggle(e.sha)}
          />
        ))}
      </div>

      {proj.entries.length > 5 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-[0.55rem] font-mono text-slate-600 hover:text-cyber-cyan transition-colors text-center"
        >
          {showAll ? '▲ show fewer' : `▼ show ${proj.entries.length - 5} more`}
        </button>
      )}
    </div>
  )
}

export default function MemoryDiffPage() {
  const [data, setData] = useState<MemoryDiffResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [slugFilter, setSlugFilter] = useState<string[]>([])
  const [sincedays, setSinceDays] = useState(7)

  const load = useCallback(async () => {
    setLoading(true)
    const since = new Date(Date.now() - sincedays * 86400_000).toISOString()
    const params = new URLSearchParams({ since })
    const r = await fetch(`/api/memory-diff?${params}`)
    const d = await r.json() as MemoryDiffResponse
    setData(d)
    setLoading(false)
  }, [sincedays])

  useEffect(() => { load() }, [load])

  const allSlugs = useMemo(() => data?.projects.map((p) => p.slug) ?? [], [data])

  const filtered = useMemo(() => {
    if (!data) return []
    if (slugFilter.length === 0) return data.projects
    return data.projects.filter((p) => slugFilter.includes(p.slug))
  }, [data, slugFilter])

  function toggleSlug(slug: string) {
    setSlugFilter((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    )
  }

  const highDrift = filtered.filter((p) => p.driftScore >= 50)

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <h1 className="text-sm font-black tracking-[0.18em] text-cyber-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
            Memory Diff Timeline
          </h1>
          {data && (
            <span className="text-[0.55rem] font-mono text-slate-600 border border-slate-700 px-2 py-0.5 rounded">
              {data.projects.length} project{data.projects.length !== 1 ? 's' : ''}
            </span>
          )}
          <div className="flex-1" />
          <button onClick={load} disabled={loading} className="text-[0.6rem] font-mono text-slate-600 hover:text-cyber-cyan transition-colors disabled:opacity-40">
            {loading ? '⟳ loading…' : '⟳ refresh'}
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-6xl mx-auto w-full flex flex-col gap-6">
        {/* Filters */}
        <div className="flex gap-3 flex-wrap items-center">
          <div className="flex gap-1 items-center">
            <span className="text-[0.55rem] font-mono text-slate-600">Range:</span>
            {([7, 14, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => setSinceDays(d)}
                className="text-[0.6rem] font-mono px-2 py-0.5 rounded border transition-colors"
                style={{
                  color: sincedays === d ? '#00F5FF' : '#64748b',
                  borderColor: sincedays === d ? 'rgba(0,245,255,0.3)' : '#374151',
                }}
              >
                {d}d
              </button>
            ))}
          </div>
          {allSlugs.length > 1 && (
            <div className="flex gap-1 flex-wrap items-center">
              <span className="text-[0.55rem] font-mono text-slate-600">Projects:</span>
              {allSlugs.map((s) => (
                <button
                  key={s}
                  onClick={() => toggleSlug(s)}
                  className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded border transition-colors"
                  style={{
                    color: slugFilter.includes(s) ? '#00F5FF' : '#64748b',
                    borderColor: slugFilter.includes(s) ? 'rgba(0,245,255,0.3)' : '#374151',
                  }}
                >
                  {s}
                </button>
              ))}
              {slugFilter.length > 0 && (
                <button
                  onClick={() => setSlugFilter([])}
                  className="text-[0.5rem] font-mono text-slate-700 hover:text-slate-400 transition-colors"
                >
                  clear
                </button>
              )}
            </div>
          )}
        </div>

        {/* High-drift warning */}
        {highDrift.length > 0 && (
          <div
            className="rounded-lg border border-amber-500/30 p-3 flex items-center gap-2"
            style={{ background: 'rgba(245,158,11,0.06)' }}
          >
            <span className="text-amber-400 text-sm">⚠</span>
            <p className="text-[0.6rem] font-mono text-amber-400/80">
              High memory drift (&gt;50%): {highDrift.map((p) => p.slug).join(', ')} — may indicate context instability
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-xs font-mono text-slate-600 animate-pulse">Scanning memory diffs…</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="text-5xl opacity-10">◎</div>
            <p className="text-xs font-mono text-slate-500">No memory diffs found for selected range</p>
            <p className="text-[0.6rem] font-mono text-slate-700">Projects with no MEMORY.md or no git history are excluded</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {filtered.map((proj) => (
              <ProjectSection key={proj.slug} proj={proj} />
            ))}
          </div>
        )}

        {data && (
          <p className="text-[0.5rem] font-mono text-slate-800 text-right">
            Generated {new Date(data.generatedAt).toLocaleString()} · cached 1h
          </p>
        )}
      </main>
    </div>
  )
}

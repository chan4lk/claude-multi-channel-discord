'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { HistoryResponse, CommitEntry } from '../../api/projects/[slug]/claude-md/history/route'

function DiffBlock({ diff }: { diff: string }) {
  if (!diff) return <p className="text-[0.6rem] font-mono text-slate-600 italic">No diff available</p>
  return (
    <div className="overflow-x-auto rounded border border-white/5" style={{ background: '#020810', maxHeight: 400 }}>
      <pre className="text-[0.6rem] font-mono leading-relaxed p-3 whitespace-pre-wrap break-all">
        {diff.split('\n').map((line, i) => {
          let color = '#64748b'
          if (line.startsWith('+') && !line.startsWith('+++')) color = '#4ADE80'
          else if (line.startsWith('-') && !line.startsWith('---')) color = '#EF4444'
          else if (line.startsWith('@@')) color = '#A855F7'
          else if (line.startsWith('diff ')) color = '#00F5FF'
          return (
            <span key={i} style={{ color, display: 'block' }}>{line || ' '}</span>
          )
        })}
      </pre>
    </div>
  )
}

function SideBySideDiff({ a, b }: { a: CommitEntry; b: CommitEntry }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div className="text-[0.55rem] font-mono text-slate-500 mb-1.5 flex items-center gap-1.5">
          <span className="text-red-400">{a.shortSha}</span>
          <span className="text-slate-700">—</span>
          <span className="truncate">{a.message}</span>
        </div>
        <DiffBlock diff={a.diff} />
      </div>
      <div>
        <div className="text-[0.55rem] font-mono text-slate-500 mb-1.5 flex items-center gap-1.5">
          <span className="text-green-400">{b.shortSha}</span>
          <span className="text-slate-700">—</span>
          <span className="truncate">{b.message}</span>
        </div>
        <DiffBlock diff={b.diff} />
      </div>
    </div>
  )
}

export default function ClaudeMdHistoryPage() {
  const params = useParams()
  const slug = typeof params.slug === 'string' ? params.slug : Array.isArray(params.slug) ? params.slug[0] : ''

  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [compareMode, setCompareMode] = useState(false)
  const [compareA, setCompareA] = useState<string | null>(null)
  const [compareB, setCompareB] = useState<string | null>(null)
  const [showCurrent, setShowCurrent] = useState(false)

  const load = useCallback(async () => {
    if (!slug) return
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(slug)}/claude-md/history`)
      const d = await r.json() as HistoryResponse
      setData(d)
    } catch {}
    setLoading(false)
  }, [slug])

  useEffect(() => { load() }, [load])

  function toggleExpand(sha: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(sha)) next.delete(sha)
      else next.add(sha)
      return next
    })
  }

  function selectForCompare(sha: string) {
    if (!compareA || (compareA && compareB)) {
      setCompareA(sha)
      setCompareB(null)
    } else {
      setCompareB(sha)
    }
  }

  const compareCommitA = data?.commits.find((c) => c.sha === compareA) ?? null
  const compareCommitB = data?.commits.find((c) => c.sha === compareB) ?? null

  function fmtDate(iso: string) {
    try { return new Date(iso).toLocaleString() } catch { return iso }
  }

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: '#060d1a' }}>
        <div className="text-xs font-mono text-slate-600 animate-pulse">Loading history…</div>
      </div>
    )
  }

  const commits = data?.commits ?? []

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-4 py-2.5">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href={`/projects/${encodeURIComponent(slug)}`} className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
            ← {slug}
          </Link>
          <span className="text-[0.65rem] font-mono font-bold text-cyber-cyan uppercase tracking-widest">CLAUDE.md History</span>
          <span className="text-[0.55rem] font-mono text-slate-600 border border-slate-700 px-1.5 py-0.5 rounded">
            {commits.length} commits
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setShowCurrent((v) => !v)}
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded"
          >
            {showCurrent ? '▲ Hide current' : '▼ Show current'}
          </button>
          <button
            onClick={() => { setCompareMode((v) => !v); setCompareA(null); setCompareB(null) }}
            className="text-[0.6rem] font-mono transition-colors border px-2 py-1 rounded"
            style={{
              color: compareMode ? '#00F5FF' : '#64748b',
              borderColor: compareMode ? 'rgba(0,245,255,0.3)' : '#374151',
            }}
          >
            ⇌ Compare mode
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
        {!data?.hasGit && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 mb-4">
            <p className="text-xs font-mono text-amber-400">No git repository found for this project. CLAUDE.md changes are not version-controlled.</p>
          </div>
        )}

        {/* Current content */}
        {showCurrent && data?.current && (
          <div className="rounded-lg border border-cyber-cyan/12 p-4 mb-6" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider">Current CLAUDE.md (HEAD)</p>
              {commits.length > 0 && (
                <span className="text-[0.55rem] font-mono text-slate-600">{commits[0].shortSha} · {fmtDate(commits[0].date)}</span>
              )}
            </div>
            <div className="overflow-auto rounded border border-white/5" style={{ background: '#020810', maxHeight: 400 }}>
              <pre className="text-[0.6rem] font-mono leading-relaxed p-3 text-slate-400 whitespace-pre-wrap">{data.current}</pre>
            </div>
          </div>
        )}

        {/* Compare panel */}
        {compareMode && compareCommitA && compareCommitB && (
          <div className="mb-6 rounded-lg border border-purple-500/20 p-4" style={{ background: 'rgba(168,85,247,0.03)' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[0.6rem] font-mono text-purple-400 uppercase tracking-wider">Side-by-side Compare</p>
              <button onClick={() => { setCompareA(null); setCompareB(null) }} className="text-[0.55rem] font-mono text-slate-500 hover:text-slate-300">✕ Clear</button>
            </div>
            <SideBySideDiff a={compareCommitA} b={compareCommitB} />
          </div>
        )}
        {compareMode && compareCommitA && !compareCommitB && (
          <div className="mb-4 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <p className="text-[0.6rem] font-mono text-amber-400">Selected {compareCommitA.shortSha}. Click another commit to compare.</p>
          </div>
        )}
        {compareMode && !compareCommitA && (
          <div className="mb-4 rounded border border-purple-500/20 bg-purple-500/5 px-3 py-2">
            <p className="text-[0.6rem] font-mono text-purple-400">Click any commit to select it for comparison.</p>
          </div>
        )}

        {/* Timeline */}
        {commits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="text-4xl opacity-15">◎</div>
            <p className="text-xs font-mono text-slate-500">No git history for CLAUDE.md</p>
            <p className="text-[0.6rem] font-mono text-slate-700">File may not be committed yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {commits.map((commit, idx) => {
              const isExpanded = expanded.has(commit.sha)
              const isSelectedA = compareA === commit.sha
              const isSelectedB = compareB === commit.sha
              const isSelected = isSelectedA || isSelectedB
              return (
                <div
                  key={commit.sha}
                  className="rounded-lg border transition-colors"
                  style={{
                    borderColor: isSelected
                      ? isSelectedA ? 'rgba(239,68,68,0.4)' : 'rgba(74,222,128,0.4)'
                      : 'rgba(0,245,255,0.08)',
                    background: isSelected
                      ? isSelectedA ? 'rgba(239,68,68,0.04)' : 'rgba(74,222,128,0.04)'
                      : 'rgba(0,245,255,0.015)',
                  }}
                >
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
                    onClick={() => compareMode ? selectForCompare(commit.sha) : toggleExpand(commit.sha)}
                  >
                    {/* Timeline dot */}
                    <div className="flex flex-col items-center flex-shrink-0">
                      <div
                        className="w-2.5 h-2.5 rounded-full border"
                        style={{
                          background: idx === 0 ? '#00F5FF' : 'transparent',
                          borderColor: idx === 0 ? '#00F5FF' : '#334155',
                        }}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code
                          className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(0,245,255,0.1)', color: '#00F5FF' }}
                        >
                          {commit.shortSha}
                        </code>
                        <span className="text-xs font-mono text-slate-300 truncate">{commit.message}</span>
                        {idx === 0 && (
                          <span className="text-[0.5rem] font-mono px-1 py-0.5 rounded" style={{ background: 'rgba(0,245,255,0.15)', color: '#00F5FF' }}>HEAD</span>
                        )}
                      </div>
                      <div className="flex gap-3 mt-0.5">
                        <span className="text-[0.55rem] font-mono text-slate-600">{fmtDate(commit.date)}</span>
                        <span className="text-[0.55rem] font-mono text-slate-700">{commit.author}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {compareMode && (
                        <span
                          className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded border"
                          style={{
                            color: isSelectedA ? '#EF4444' : isSelectedB ? '#4ADE80' : '#64748b',
                            borderColor: isSelectedA ? '#EF444430' : isSelectedB ? '#4ADE8030' : '#374151',
                          }}
                        >
                          {isSelectedA ? 'A' : isSelectedB ? 'B' : 'Select'}
                        </span>
                      )}
                      {!compareMode && (
                        <span className="text-[0.6rem] font-mono text-slate-600">{isExpanded ? '▲' : '▼'}</span>
                      )}
                    </div>
                  </div>

                  {isExpanded && !compareMode && (
                    <div className="px-4 pb-4">
                      <DiffBlock diff={commit.diff} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

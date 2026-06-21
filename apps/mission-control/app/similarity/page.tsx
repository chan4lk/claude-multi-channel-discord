'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import type { SimilarityResponse } from '../api/similarity/route'

function getCellColor(score: number, threshold: number): string {
  if (score < threshold) return 'rgba(30,40,55,0.6)'
  // Dark (0) → bright cyan (1)
  const t = Math.pow(score, 0.6)
  const r = Math.round(0 + t * 0)
  const g = Math.round(20 + t * 200)
  const b = Math.round(30 + t * 210)
  return `rgb(${r},${g},${b})`
}

interface TooltipState {
  x: number
  y: number
  a: string
  b: string
  score: number
  shared: string[]
}

export default function SimilarityPage() {
  const [data, setData] = useState<SimilarityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [threshold, setThreshold] = useState(0.1)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch('/api/similarity')
      .then((r) => r.json())
      .then((d: SimilarityResponse) => setData(d))
      .catch((e) => setError(e.message ?? 'fetch failed'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setTooltip(null)
    }
    function onOutside(e: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) setTooltip(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onOutside)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onOutside)
    }
  }, [])

  const projects = data?.projects ?? []
  const n = projects.length

  // Determine cell size based on N
  const cellSize = n <= 8 ? 52 : n <= 12 ? 40 : n <= 16 ? 32 : 26

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider"
          >
            ← Dashboard
          </Link>
          <h1
            className="text-lg font-black tracking-[0.18em] text-cyber-cyan"
            style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}
          >
            MEMORY SIMILARITY
          </h1>
          <div className="flex-1" />
          {data && (
            <span className="text-[0.55rem] font-mono text-slate-600">
              {n} project{n !== 1 ? 's' : ''} · cached 5 min ·{' '}
              {new Date(data.computedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 p-6 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-64">
            <span className="text-cyber-cyan font-mono text-sm animate-pulse">Computing similarity matrix…</span>
          </div>
        )}

        {error && (
          <div className="text-red-400 font-mono text-sm p-4 border border-red-500/30 rounded">
            Error: {error}
          </div>
        )}

        {!loading && !error && data && n === 0 && (
          <div className="flex items-center justify-center h-64">
            <span className="text-slate-500 font-mono text-sm">No projects with memory files found.</span>
          </div>
        )}

        {!loading && !error && data && n > 0 && (
          <div className="flex flex-col gap-6">
            {/* Threshold control */}
            <div className="flex items-center gap-4">
              <span className="text-[0.65rem] font-mono text-slate-400 uppercase tracking-wider">
                Min Similarity Threshold
              </span>
              <input
                type="range"
                min={0}
                max={50}
                step={1}
                value={Math.round(threshold * 100)}
                onChange={(e) => setThreshold(Number(e.target.value) / 100)}
                className="w-40 accent-cyan-400"
              />
              <span className="text-[0.65rem] font-mono text-cyber-cyan w-10">
                {Math.round(threshold * 100)}%
              </span>
              <span className="text-[0.55rem] font-mono text-slate-600 ml-2">
                Cells below threshold shown as dark
              </span>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3">
              <span className="text-[0.6rem] font-mono text-slate-500">0%</span>
              <div
                className="h-3 w-48 rounded"
                style={{
                  background: 'linear-gradient(to right, rgba(30,40,55,0.6), rgb(0,220,240))',
                  border: '1px solid rgba(0,245,255,0.15)',
                }}
              />
              <span className="text-[0.6rem] font-mono text-cyber-cyan">100%</span>
            </div>

            {/* Matrix */}
            <div className="overflow-x-auto">
              <div style={{ display: 'inline-block', position: 'relative' }}>
                {/* Column labels */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `${cellSize * 2}px repeat(${n}, ${cellSize}px)`,
                    marginBottom: 2,
                  }}
                >
                  <div /> {/* empty corner */}
                  {projects.map((slug) => (
                    <div
                      key={slug}
                      style={{
                        width: cellSize,
                        height: cellSize * 2.5,
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'center',
                        paddingBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.52rem',
                          fontFamily: 'JetBrains Mono, monospace',
                          color: '#64748B',
                          writingMode: 'vertical-rl',
                          transform: 'rotate(180deg)',
                          whiteSpace: 'nowrap',
                          maxHeight: cellSize * 2.2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {slug}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Rows */}
                {projects.map((rowSlug) => (
                  <div
                    key={rowSlug}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `${cellSize * 2}px repeat(${n}, ${cellSize}px)`,
                      marginBottom: 2,
                    }}
                  >
                    {/* Row label */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        paddingRight: 8,
                        fontSize: '0.52rem',
                        fontFamily: 'JetBrains Mono, monospace',
                        color: '#64748B',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {rowSlug}
                    </div>

                    {/* Cells */}
                    {projects.map((colSlug) => {
                      const isDiag = rowSlug === colSlug
                      const score = isDiag ? 1 : (data.scores[rowSlug]?.[colSlug] ?? 0)
                      const bg = isDiag
                        ? 'rgba(0,245,255,0.12)'
                        : getCellColor(score, threshold)
                      const pct = Math.round(score * 100)

                      return (
                        <div
                          key={colSlug}
                          onMouseEnter={(e) => {
                            if (isDiag) return
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                            setTooltip({
                              x: rect.left + window.scrollX,
                              y: rect.top + window.scrollY,
                              a: rowSlug,
                              b: colSlug,
                              score,
                              shared: data.sharedKeywords[rowSlug]?.[colSlug] ?? [],
                            })
                          }}
                          onMouseLeave={() => setTooltip(null)}
                          style={{
                            width: cellSize - 2,
                            height: cellSize - 2,
                            margin: 1,
                            borderRadius: 3,
                            background: bg,
                            border: isDiag ? '1px solid rgba(0,245,255,0.3)' : '1px solid rgba(0,245,255,0.06)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: isDiag ? 'default' : 'pointer',
                            transition: 'border-color 0.15s',
                          }}
                          onMouseOver={(e) => {
                            if (!isDiag) (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,245,255,0.35)'
                          }}
                          onMouseOut={(e) => {
                            if (!isDiag) (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,245,255,0.06)'
                          }}
                        >
                          {cellSize >= 32 && (
                            <span
                              style={{
                                fontSize: '0.48rem',
                                fontFamily: 'JetBrains Mono, monospace',
                                color: isDiag ? 'rgba(0,245,255,0.5)' : score < threshold ? 'rgba(100,116,139,0.4)' : 'rgba(255,255,255,0.6)',
                              }}
                            >
                              {isDiag ? '■' : `${pct}%`}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Refresh */}
            <div>
              <button
                onClick={load}
                className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors border border-cyber-cyan/15 hover:border-cyber-cyan/40 px-3 py-1.5 rounded"
              >
                ↺ Recompute
              </button>
              <span className="ml-3 text-[0.55rem] font-mono text-slate-600">
                Results cached 5 min server-side
              </span>
            </div>
          </div>
        )}
      </main>

      {/* Tooltip */}
      {tooltip && (
        <div
          ref={tooltipRef}
          style={{
            position: 'fixed',
            left: Math.min(tooltip.x + 12, window.innerWidth - 220),
            top: Math.min(tooltip.y - 10, window.innerHeight - 160),
            zIndex: 9999,
            background: '#0d1a2e',
            border: '1px solid rgba(0,245,255,0.25)',
            borderRadius: 6,
            padding: '10px 14px',
            pointerEvents: 'none',
            minWidth: 180,
          }}
        >
          <div className="text-[0.6rem] font-mono text-cyber-cyan mb-1">
            {tooltip.a} ↔ {tooltip.b}
          </div>
          <div className="text-[0.7rem] font-mono font-bold text-white mb-2">
            {Math.round(tooltip.score * 100)}% similarity
          </div>
          {tooltip.shared.length > 0 ? (
            <>
              <div className="text-[0.55rem] font-mono text-slate-500 mb-1 uppercase tracking-wider">Top shared keywords</div>
              <div className="flex flex-wrap gap-1">
                {tooltip.shared.map((kw) => (
                  <span
                    key={kw}
                    className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(0,245,255,0.08)', color: '#22D3EE', border: '1px solid rgba(0,245,255,0.15)' }}
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="text-[0.6rem] font-mono text-slate-600">No shared keywords</div>
          )}
        </div>
      )}

      <footer className="border-t border-cyber-cyan/8 px-6 py-2">
        <p className="text-[0.55rem] font-mono text-slate-600">
          Jaccard similarity on memory keyword sets · Dark cells below threshold · Rows sorted by highest avg similarity
        </p>
      </footer>
    </div>
  )
}


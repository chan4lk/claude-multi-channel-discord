'use client'

import { useEffect, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { MemoryAgeResponse, MemoryAgeProject, MemoryFileInfo } from '../api/memory-age/route'

function ageBand(days: number): { color: string; label: string } {
  if (days < 7) return { color: '#22C55E', label: '< 7d' }
  if (days <= 30) return { color: '#F59E0B', label: '7–30d' }
  return { color: '#EF4444', label: '> 30d' }
}

function dotRadius(wordCount: number): number {
  const clamped = Math.max(0, Math.min(wordCount, 800))
  return 4 + (clamped / 800) * 8
}

interface TooltipState {
  file: MemoryFileInfo
  x: number
  y: number
}

function AgeStrip({ project }: { project: MemoryAgeProject }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const STRIP_H = 32
  const DOT_GAP = 28
  const LABEL_W = 80
  const width = LABEL_W + Math.max(1, project.files.length) * DOT_GAP + 20

  return (
    <div className="relative">
      <svg width={width} height={STRIP_H} className="block overflow-visible">
        <text
          x={LABEL_W - 6}
          y={STRIP_H / 2 + 4}
          textAnchor="end"
          fill={project.files.length === 0 ? '#1E293B' : '#64748B'}
          fontSize="0.45rem"
          fontFamily="monospace"
        >
          {project.slug.length > 14 ? project.slug.slice(0, 13) + '…' : project.slug}
        </text>

        {project.files.map((f, i) => {
          const { color } = ageBand(f.ageDays)
          const r = dotRadius(f.wordCount)
          const cx = LABEL_W + i * DOT_GAP + DOT_GAP / 2
          const cy = STRIP_H / 2
          return (
            <circle
              key={f.name}
              cx={cx}
              cy={cy}
              r={r}
              fill={color}
              opacity={0.75}
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => {
                const rect = (e.target as SVGCircleElement).getBoundingClientRect()
                setTooltip({ file: f, x: rect.left + r, y: rect.top })
              }}
              onMouseLeave={() => setTooltip(null)}
            />
          )
        })}

        {project.files.length === 0 && (
          <text
            x={LABEL_W + 6}
            y={STRIP_H / 2 + 4}
            fill="#1E293B"
            fontSize="0.42rem"
            fontFamily="monospace"
          >
            no memory files
          </text>
        )}
      </svg>

      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none rounded border border-white/10 px-2 py-1.5 text-[0.52rem] font-mono leading-relaxed"
          style={{
            left: tooltip.x,
            top: tooltip.y - 50,
            background: 'rgba(8,15,28,0.95)',
            backdropFilter: 'blur(6px)',
            transform: 'translateX(-50%)',
          }}
        >
          <div className="text-slate-300">{tooltip.file.name}</div>
          <div>
            <span style={{ color: ageBand(tooltip.file.ageDays).color }}>
              {tooltip.file.ageDays}d old
            </span>
            <span className="text-slate-600 mx-1">·</span>
            <span className="text-slate-400">{tooltip.file.wordCount} words</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function MemoryAgeStripPage() {
  const [data, setData] = useState<MemoryAgeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/memory-age')
      .then((r) => r.json())
      .then((d: MemoryAgeResponse) => {
        setData(d)
        setLoading(false)
      })
      .catch((e) => {
        setError(String(e))
        setLoading(false)
      })
  }, [])

  const projects = data?.projects ?? []

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Memory File Age Strip">
        <span className="text-[0.6rem] font-mono text-slate-500">
          Per-project memory file freshness · sorted by stale count desc
        </span>
      </SubPageHeader>

      {loading && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>
      )}
      {error && (
        <div className="text-center py-20 text-red-500 font-mono text-sm">{error}</div>
      )}

      {!loading && !error && (
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-5 mb-5 text-[0.5rem] font-mono text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#22C55E' }} />
              Fresh (&lt; 7d)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#F59E0B' }} />
              Aging (7–30d)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#EF4444' }} />
              Stale (&gt; 30d)
            </span>
            <span className="text-slate-600">· Dot size = word count</span>
          </div>

          {projects.length === 0 ? (
            <div className="text-center py-20 text-slate-600 font-mono text-sm">
              No projects with memory files found
            </div>
          ) : (
            <div
              className="rounded-lg border border-white/5 p-4 overflow-x-auto"
              style={{ background: 'rgba(255,255,255,0.02)' }}
            >
              <div className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-3">
                {projects.length} projects · hover dot for file name, age, word count
              </div>
              <div className="divide-y divide-white/5">
                {projects.map((p) => (
                  <div key={p.slug} className="py-1">
                    <AgeStrip project={p} />
                  </div>
                ))}
              </div>
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

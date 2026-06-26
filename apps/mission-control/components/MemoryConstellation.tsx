'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import ForceGraph3DLib from 'react-force-graph-3d'
import type { MemoryConstellationResponse, MemoryFileNode } from '../app/api/memory-constellation/route'

const PALETTE = [
  '#22D3EE', '#38BDF8', '#818CF8', '#34D399', '#FB923C',
  '#FCD34D', '#F472B6', '#A78BFA', '#4ADE80', '#E879F9',
]

function slugColor(slug: string): string {
  let h = 0
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function nodeVal(node: MemoryFileNode, maxWords: number): number {
  if (maxWords <= 0) return 4
  return 2 + Math.round(Math.sqrt(node.wordCount / maxWords) * 10)
}

interface SelectedNode {
  node: MemoryFileNode
  x: number
  y: number
}

interface GraphNode extends MemoryFileNode {
  val?: number
  color?: string
}

export default function MemoryConstellation() {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null)
  const [data, setData] = useState<MemoryConstellationResponse | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [selected, setSelected] = useState<SelectedNode | null>(null)
  const autoRotateRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const userInteractRef = useRef(false)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/memory-constellation')
      if (res.ok) setData(await res.json())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchData()
    const t = setInterval(fetchData, 30_000)
    return () => clearInterval(t)
  }, [fetchData])

  // Auto-rotate when idle
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    autoRotateRef.current = setInterval(() => {
      if (userInteractRef.current) return
      const camera = fg.camera()
      if (!camera) return
      const { x, z } = camera.position
      const angle = Math.atan2(z, x) + 0.005
      const dist = Math.sqrt(x * x + z * z)
      fg.cameraPosition({ x: Math.cos(angle) * dist, z: Math.sin(angle) * dist })
    }, 50)
    return () => {
      if (autoRotateRef.current) clearInterval(autoRotateRef.current)
    }
  }, [data])

  const filteredData = (() => {
    if (!data) return null
    if (filter === 'all') return { nodes: data.nodes, links: data.links }
    const validIds = new Set(data.nodes.filter((n) => n.project === filter).map((n) => n.id))
    return {
      nodes: data.nodes.filter((n) => n.project === filter),
      links: data.links.filter((l) => validIds.has(l.source as string) && validIds.has(l.target as string)),
    }
  })()

  const maxWords = filteredData
    ? Math.max(...filteredData.nodes.map((n) => n.wordCount), 1)
    : 1

  const graphNodes: GraphNode[] = (filteredData?.nodes ?? []).map((n) => ({
    ...n,
    val: nodeVal(n, maxWords),
    color: slugColor(n.project),
  }))

  const typeColor: Record<string, string> = {
    user: '#4ADE80',
    feedback: '#FB923C',
    project: '#22D3EE',
    reference: '#A78BFA',
    unknown: '#475569',
  }

  return (
    <div className="relative w-full h-full flex">
      {/* Main 3D graph */}
      <div
        ref={containerRef}
        className="flex-1 relative"
        onPointerDown={() => {
          userInteractRef.current = true
          if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
          resumeTimerRef.current = setTimeout(() => { userInteractRef.current = false }, 4000)
        }}
      >
        {/* Controls bar */}
        <div className="absolute top-3 left-3 z-10 flex items-center gap-3 flex-wrap">
          <select
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setSelected(null) }}
            className="text-[0.6rem] font-mono bg-cyber-surface/80 border border-cyber-cyan/20 text-cyber-cyan px-2 py-1 rounded appearance-none cursor-pointer"
          >
            <option value="all">all projects</option>
            {(data?.projects ?? []).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <span className="text-[0.55rem] font-mono text-slate-500">
            {graphNodes.length} files · {filteredData?.links.length ?? 0} links
          </span>
        </div>

        {/* Type legend */}
        <div className="absolute bottom-8 left-3 z-10 flex flex-col gap-1">
          {Object.entries(typeColor).map(([t, c]) => (
            <span key={t} className="flex items-center gap-1.5 text-[0.5rem] font-mono text-slate-400">
              <span className="w-2 h-2 rounded-full" style={{ background: c }} />
              {t}
            </span>
          ))}
        </div>

        {graphNodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="text-4xl opacity-20">✶</div>
            <p className="text-xs text-slate-600 font-mono">No memory files found across the fleet</p>
          </div>
        ) : (
          <ForceGraph3DLib
            ref={fgRef}
            graphData={{ nodes: graphNodes, links: filteredData?.links ?? [] }}
            nodeId="id"
            nodeVal="val"
            nodeColor="color"
            nodeLabel={(node: object) => {
              const n = node as GraphNode
              return `${n.project} / ${n.file} (${n.wordCount}w · ${n.type})`
            }}
            linkColor={() => 'rgba(34,211,238,0.15)'}
            linkWidth={1}
            backgroundColor="#060d1a"
            onNodeClick={(node: object, event: MouseEvent) => {
              const n = node as GraphNode
              setSelected({ node: n, x: event.clientX, y: event.clientY })
            }}
            onBackgroundClick={() => setSelected(null)}
            width={containerRef.current?.clientWidth}
            height={containerRef.current?.clientHeight}
          />
        )}
      </div>

      {/* Right panel — shown when a node is selected */}
      {selected && (
        <div
          className="w-80 border-l border-cyber-cyan/12 bg-cyber-surface/95 backdrop-blur-md flex flex-col overflow-hidden"
          style={{ flexShrink: 0 }}
        >
          <div className="px-4 py-3 border-b border-cyber-cyan/10 flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: slugColor(selected.node.project) }}
                />
                <span className="text-[0.65rem] font-mono font-bold text-cyber-cyan">{selected.node.file}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[0.5rem] font-mono text-slate-500">{selected.node.project}</span>
                <span
                  className="text-[0.5rem] font-mono px-1 py-0.5 rounded"
                  style={{
                    color: typeColor[selected.node.type] ?? '#475569',
                    background: `${typeColor[selected.node.type] ?? '#475569'}18`,
                    border: `1px solid ${typeColor[selected.node.type] ?? '#475569'}40`,
                  }}
                >
                  {selected.node.type}
                </span>
                <span className="text-[0.5rem] font-mono text-slate-600">{selected.node.wordCount}w</span>
              </div>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-slate-600 hover:text-slate-400 text-xs font-mono"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            <p className="text-[0.6rem] font-mono text-slate-400 leading-relaxed whitespace-pre-wrap break-words">
              {selected.node.excerpt}
              {selected.node.excerpt.length >= 400 && <span className="text-slate-600">…</span>}
            </p>
          </div>

          {/* Outgoing links */}
          {(() => {
            if (!data) return null
            const outgoing = data.links
              .filter((l) =>
                (l.source === selected.node.id || l.target === selected.node.id)
              )
              .map((l) => {
                const otherId = l.source === selected.node.id ? l.target : l.source
                return data.nodes.find((n) => n.id === otherId)
              })
              .filter((n): n is MemoryFileNode => !!n)
            if (outgoing.length === 0) return null
            return (
              <div className="px-4 py-3 border-t border-cyber-cyan/10">
                <p className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-2">
                  Links ({outgoing.length})
                </p>
                <div className="flex flex-col gap-1">
                  {outgoing.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => setSelected({ node: n, x: 0, y: 0 })}
                      className="text-left text-[0.55rem] font-mono text-slate-400 hover:text-cyber-cyan transition-colors flex items-center gap-1.5"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: slugColor(n.project) }}
                      />
                      {n.project !== selected.node.project && (
                        <span className="text-slate-600">{n.project}/</span>
                      )}
                      {n.file}
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

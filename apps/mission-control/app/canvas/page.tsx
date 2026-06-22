'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import type { Workflow, WorkflowNode, WorkflowEdge } from '../api/canvas/workflows/route'
import type { RunResponse } from '../api/canvas/run/route'
import type { FleetResponse } from '../api/fleet/route'

function uid() { return Math.random().toString(36).slice(2, 9) }

const CANVAS_W = 1200
const CANVAS_H = 700

interface DragState { nodeId: string; startX: number; startY: number; origX: number; origY: number }
interface ConnectState { fromId: string }

export default function CanvasPage() {
  const [slugs, setSlugs] = useState<string[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [nodes, setNodes] = useState<WorkflowNode[]>([])
  const [edges, setEdges] = useState<WorkflowEdge[]>([])
  const [wfName, setWfName] = useState('Untitled Workflow')
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<RunResponse['steps']>([])
  const [saving, setSaving] = useState(false)
  const [connectMode, setConnectMode] = useState(false)
  const [connectState, setConnectState] = useState<ConnectState | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const loadSlugs = useCallback(async () => {
    try {
      const r = await fetch('/api/fleet')
      const d = await r.json() as FleetResponse
      setSlugs(d.projects?.map((p) => p.slug) ?? [])
    } catch {}
  }, [])

  const loadWorkflows = useCallback(async () => {
    try {
      const r = await fetch('/api/canvas/workflows')
      const d = await r.json() as { workflows: Workflow[] }
      setWorkflows(d.workflows ?? [])
    } catch {}
  }, [])

  useEffect(() => { loadSlugs(); loadWorkflows() }, [loadSlugs, loadWorkflows])

  function newWorkflow() {
    setActiveId(null)
    setNodes([])
    setEdges([])
    setWfName('Untitled Workflow')
    setLog([])
    setSelectedNode(null)
  }

  function loadWorkflow(wf: Workflow) {
    setActiveId(wf.id)
    setNodes(wf.nodes)
    setEdges(wf.edges)
    setWfName(wf.name)
    setLog([])
    setSelectedNode(null)
  }

  async function saveWorkflow() {
    setSaving(true)
    try {
      const wf: Partial<Workflow> = { id: activeId ?? undefined, name: wfName, nodes, edges }
      const r = await fetch('/api/canvas/workflows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(wf),
      })
      const d = await r.json() as { workflow: Workflow }
      setActiveId(d.workflow.id)
      await loadWorkflows()
    } catch {}
    setSaving(false)
  }

  async function deleteWorkflow(id: string) {
    await fetch(`/api/canvas/workflows?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (activeId === id) newWorkflow()
    await loadWorkflows()
  }

  function addNode(slug: string) {
    const node: WorkflowNode = {
      id: uid(), slug,
      triggerText: '',
      x: 100 + nodes.length * 60,
      y: 100 + (nodes.length % 4) * 100,
    }
    setNodes((n) => [...n, node])
  }

  function removeNode(id: string) {
    setNodes((n) => n.filter((x) => x.id !== id))
    setEdges((e) => e.filter((x) => x.from !== id && x.to !== id))
    if (selectedNode === id) setSelectedNode(null)
  }

  function updateNodeText(id: string, text: string) {
    setNodes((n) => n.map((x) => x.id === id ? { ...x, triggerText: text } : x))
  }

  function toggleEdgeWait(id: string) {
    setEdges((e) => e.map((x) => x.id === id ? { ...x, waitForReply: !x.waitForReply } : x))
  }

  function removeEdge(id: string) {
    setEdges((e) => e.filter((x) => x.id !== id))
  }

  // Drag handlers on SVG foreign objects
  function onNodeMouseDown(e: React.MouseEvent, nodeId: string) {
    if (connectMode) return
    e.stopPropagation()
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return
    dragRef.current = { nodeId, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y }
  }

  function onSvgMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    setNodes((n) => n.map((x) => x.id === dragRef.current!.nodeId
      ? { ...x, x: Math.max(0, dragRef.current!.origX + dx), y: Math.max(0, dragRef.current!.origY + dy) }
      : x))
  }

  function onSvgMouseUp() { dragRef.current = null }

  function onNodeClick(nodeId: string) {
    if (!connectMode) { setSelectedNode(nodeId === selectedNode ? null : nodeId); return }
    if (!connectState) {
      setConnectState({ fromId: nodeId })
    } else if (connectState.fromId !== nodeId) {
      // Check for cycle: ensure no path from nodeId back to connectState.fromId
      const edge: WorkflowEdge = { id: uid(), from: connectState.fromId, to: nodeId, waitForReply: false }
      setEdges((e) => [...e, edge])
      setConnectState(null)
    } else {
      setConnectState(null)
    }
  }

  async function runWorkflow() {
    setRunning(true)
    setLog([])
    try {
      const r = await fetch('/api/canvas/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeId ?? 'temp', name: wfName, nodes, edges, createdAt: '', updatedAt: '' } satisfies Workflow),
      })
      const d = await r.json() as RunResponse
      setLog(d.steps)
    } catch {}
    setRunning(false)
  }

  const selectedNodeData = nodes.find((n) => n.id === selectedNode) ?? null

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-4 py-2.5">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">← Dashboard</Link>
          <input
            className="text-sm font-mono font-bold text-cyber-cyan bg-transparent border-none outline-none min-w-0"
            value={wfName}
            onChange={(e) => setWfName(e.target.value)}
            maxLength={60}
          />
          <div className="flex-1" />
          <button
            onClick={() => { setConnectMode((v) => !v); setConnectState(null) }}
            className="text-[0.6rem] font-mono px-2 py-1 rounded border transition-colors"
            style={{ color: connectMode ? '#00F5FF' : '#64748b', borderColor: connectMode ? 'rgba(0,245,255,0.3)' : '#374151' }}
          >
            {connectMode ? '⊸ Connecting…' : '⊸ Add edge'}
          </button>
          <button
            onClick={saveWorkflow}
            disabled={saving}
            className="text-[0.6rem] font-mono px-2 py-1 rounded border border-slate-600 hover:border-cyber-cyan/30 text-slate-400 hover:text-cyber-cyan transition-colors disabled:opacity-40"
          >
            {saving ? '…' : '⊡ Save'}
          </button>
          <button
            onClick={runWorkflow}
            disabled={running || nodes.length === 0}
            className="text-[0.6rem] font-mono font-bold px-3 py-1 rounded uppercase tracking-wider transition-all disabled:opacity-40"
            style={{ background: 'rgba(74,222,128,0.12)', color: '#4ADE80', border: '1px solid rgba(74,222,128,0.3)' }}
          >
            {running ? '◌ Running…' : '▶ Run'}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: project list + saved workflows */}
        <div className="w-48 flex-shrink-0 border-r border-cyber-cyan/10 flex flex-col" style={{ background: '#040b16' }}>
          <div className="p-3 border-b border-cyber-cyan/8">
            <p className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-2">Projects</p>
            <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
              {slugs.map((s) => (
                <button
                  key={s}
                  onClick={() => addNode(s)}
                  className="text-left text-[0.6rem] font-mono text-slate-400 hover:text-cyber-cyan px-1.5 py-1 rounded hover:bg-white/3 transition-colors truncate"
                  title={`Add ${s} to canvas`}
                >
                  + {s}
                </button>
              ))}
              {slugs.length === 0 && <p className="text-[0.55rem] font-mono text-slate-700">No projects</p>}
            </div>
          </div>

          <div className="p-3 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider">Saved Workflows</p>
              <button onClick={newWorkflow} className="text-[0.5rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors">+ New</button>
            </div>
            <div className="flex flex-col gap-1">
              {workflows.map((wf) => (
                <div key={wf.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => loadWorkflow(wf)}
                    className="flex-1 text-left text-[0.6rem] font-mono px-1.5 py-1 rounded transition-colors truncate"
                    style={{ color: activeId === wf.id ? '#00F5FF' : '#64748b', background: activeId === wf.id ? 'rgba(0,245,255,0.08)' : 'transparent' }}
                  >
                    {wf.name}
                  </button>
                  <button
                    onClick={() => deleteWorkflow(wf.id)}
                    className="hidden group-hover:block text-[0.55rem] font-mono text-slate-600 hover:text-red-400 transition-colors px-0.5"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {workflows.length === 0 && <p className="text-[0.55rem] font-mono text-slate-700">None saved yet</p>}
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative overflow-auto">
          <svg
            ref={svgRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className="absolute inset-0"
            onMouseMove={onSvgMouseMove}
            onMouseUp={onSvgMouseUp}
            onMouseLeave={onSvgMouseUp}
            style={{ cursor: connectMode ? 'crosshair' : 'default' }}
          >
            {/* Grid dots */}
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.5" fill="rgba(0,245,255,0.07)" />
              </pattern>
            </defs>
            <rect width={CANVAS_W} height={CANVAS_H} fill="url(#grid)" />

            {/* Edges */}
            {edges.map((edge) => {
              const from = nodes.find((n) => n.id === edge.from)
              const to = nodes.find((n) => n.id === edge.to)
              if (!from || !to) return null
              const fx = from.x + 80; const fy = from.y + 40
              const tx = to.x; const ty = to.y + 40
              const mx = (fx + tx) / 2
              return (
                <g key={edge.id}>
                  <path
                    d={`M${fx},${fy} C${mx},${fy} ${mx},${ty} ${tx},${ty}`}
                    fill="none"
                    strokeWidth={edge.waitForReply ? 2 : 1.5}
                    stroke={edge.waitForReply ? '#A855F7' : 'rgba(0,245,255,0.4)'}
                    strokeDasharray={edge.waitForReply ? '5,3' : undefined}
                    markerEnd="url(#arrow)"
                  />
                  {/* Wait toggle and delete */}
                  <circle
                    cx={mx} cy={(fy + ty) / 2}
                    r={6}
                    fill={edge.waitForReply ? '#A855F750' : '#00F5FF15'}
                    stroke={edge.waitForReply ? '#A855F7' : '#00F5FF50'}
                    style={{ cursor: 'pointer' }}
                    onClick={() => toggleEdgeWait(edge.id)}
                  />
                  <text x={mx} y={(fy + ty) / 2 + 3.5} textAnchor="middle" fontSize={7} fill={edge.waitForReply ? '#A855F7' : '#00F5FF80'} style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleEdgeWait(edge.id)}>
                    {edge.waitForReply ? '⏳' : '→'}
                  </text>
                  {/* Delete edge */}
                  <circle cx={mx + 12} cy={(fy + ty) / 2} r={5} fill="#EF444420" stroke="#EF444440" style={{ cursor: 'pointer' }} onClick={() => removeEdge(edge.id)} />
                  <text x={mx + 12} y={(fy + ty) / 2 + 3} textAnchor="middle" fontSize={7} fill="#EF4444" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => removeEdge(edge.id)}>✕</text>
                </g>
              )
            })}

            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="rgba(0,245,255,0.6)" />
              </marker>
            </defs>

            {/* Nodes as foreignObject */}
            {nodes.map((node) => {
              const isSelected = selectedNode === node.id
              const isConnectFrom = connectState?.fromId === node.id
              return (
                <foreignObject
                  key={node.id}
                  x={node.x} y={node.y}
                  width={160} height={80}
                >
                  <div
                    style={{
                      width: 160, height: 80,
                      background: isConnectFrom ? 'rgba(168,85,247,0.15)' : isSelected ? 'rgba(0,245,255,0.08)' : 'rgba(0,8,24,0.95)',
                      border: `1.5px solid ${isConnectFrom ? '#A855F7' : isSelected ? '#00F5FF' : 'rgba(0,245,255,0.2)'}`,
                      borderRadius: 8,
                      padding: 8,
                      cursor: connectMode ? 'pointer' : 'grab',
                      userSelect: 'none',
                      boxSizing: 'border-box',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                    onMouseDown={(e) => onNodeMouseDown(e as unknown as React.MouseEvent, node.id)}
                    onClick={() => onNodeClick(node.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: '#00F5FF', fontWeight: 700 }}>{node.slug}</span>
                      <button
                        style={{ fontSize: 9, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
                        onClick={(e) => { e.stopPropagation(); removeNode(node.id) }}
                      >✕</button>
                    </div>
                    <input
                      style={{
                        width: '100%', fontSize: 9, color: '#94a3b8', background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '2px 4px',
                        fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                      }}
                      placeholder="trigger message…"
                      value={node.triggerText}
                      onChange={(e) => updateNodeText(node.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                  </div>
                </foreignObject>
              )
            })}
          </svg>

          {nodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="text-5xl opacity-10 mb-3">⊡</div>
              <p className="text-xs font-mono text-slate-600">Click a project on the left to add it to the canvas</p>
              <p className="text-[0.6rem] font-mono text-slate-700 mt-1">Drag nodes to reposition · Use "Add edge" to connect them · Click Run to execute</p>
            </div>
          )}
        </div>

        {/* Right panel: execution log */}
        {(log.length > 0 || running) && (
          <div className="w-64 flex-shrink-0 border-l border-cyber-cyan/10 p-3 overflow-y-auto" style={{ background: '#040b16' }}>
            <p className="text-[0.5rem] font-mono text-slate-600 uppercase tracking-wider mb-2">Execution Log</p>
            <div className="flex flex-col gap-2">
              {log.map((step, i) => (
                <div key={i} className="rounded border border-white/5 p-2" style={{ background: '#060d1a' }}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span
                      className="text-[0.5rem] font-mono font-bold"
                      style={{ color: step.status === 'sent' ? '#4ADE80' : step.status === 'error' ? '#EF4444' : '#64748b' }}
                    >
                      {step.status === 'sent' ? '✓' : step.status === 'error' ? '✗' : '—'} {step.status.toUpperCase()}
                    </span>
                    <code className="text-[0.5rem] font-mono text-cyber-cyan">{step.slug}</code>
                  </div>
                  {step.text && <p className="text-[0.55rem] font-mono text-slate-400 truncate">{step.text}</p>}
                  {step.error && <p className="text-[0.55rem] font-mono text-red-400 truncate">{step.error}</p>}
                  <p className="text-[0.45rem] font-mono text-slate-700 mt-0.5">{new Date(step.sentAt).toLocaleTimeString()}</p>
                </div>
              ))}
            </div>
            {running && (
              <p className="text-[0.6rem] font-mono text-amber-400 animate-pulse mt-2">Executing…</p>
            )}
          </div>
        )}
      </div>

      <div className="px-4 py-1.5 border-t border-cyber-cyan/8 text-[0.45rem] font-mono text-slate-700 flex gap-3">
        <span>Drag node = move</span>
        <span>Add edge = connect projects</span>
        <span>⏳ edge = wait 2s between steps</span>
        <span>Click edge circle to toggle wait</span>
        <span>{nodes.length} node{nodes.length !== 1 ? 's' : ''} · {edges.length} edge{edges.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  )
}

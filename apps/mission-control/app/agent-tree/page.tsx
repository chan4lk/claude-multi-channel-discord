'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { AgentTreeResponse, AgentNode, TurnWithAgents } from '../api/agent-tree/route'

const DEPTH_COLORS = ['#22D3EE', '#A78BFA', '#34D399', '#F59E0B', '#F87171']

function depthColor(depth: number): string {
  return DEPTH_COLORS[depth % DEPTH_COLORS.length] ?? '#64748B'
}

function fmtTs(ts: string): string {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return ts }
}

function fmtTokens(n: number | null): string {
  if (n === null) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

interface NodeProps {
  node: AgentNode
  expanded: Set<string>
  onToggle: (id: string) => void
}

function AgentNodeRow({ node, expanded, onToggle }: NodeProps) {
  const isOpen = expanded.has(node.id)
  const hasChildren = node.children.length > 0
  const indent = node.depth * 20

  return (
    <div>
      <div
        className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-white/5 transition-colors cursor-pointer text-[0.65rem] font-mono"
        style={{ paddingLeft: 8 + indent }}
        onClick={() => hasChildren && onToggle(node.id)}
      >
        {/* Depth line */}
        <div
          className="shrink-0 mt-1 rounded-sm"
          style={{
            width: 3,
            height: 12,
            background: depthColor(node.depth),
            opacity: 0.8,
          }}
        />
        {/* Toggle arrow */}
        <span
          className="shrink-0 text-slate-600"
          style={{ width: 12, textAlign: 'center', visibility: hasChildren ? 'visible' : 'hidden' }}
        >
          {isOpen ? '▾' : '▸'}
        </span>
        {/* Tool badge */}
        <span
          className="shrink-0 px-1.5 py-0.5 rounded text-[0.5rem] font-bold uppercase tracking-wider"
          style={{ background: `${depthColor(node.depth)}20`, color: depthColor(node.depth) }}
        >
          {node.toolName}
        </span>
        {/* Label */}
        <span className="text-slate-300 truncate flex-1" title={node.promptSnippet}>
          {node.label || node.promptSnippet}
        </span>
        {/* Children count */}
        {hasChildren && (
          <span className="shrink-0 text-slate-600 text-[0.5rem]">
            {node.children.length} sub
          </span>
        )}
      </div>

      {/* Prompt snippet on hover — shown always if not same as label */}
      {node.promptSnippet && node.promptSnippet !== node.label && (
        <div
          className="text-slate-600 text-[0.55rem] font-mono leading-tight"
          style={{ paddingLeft: 8 + indent + 40, marginTop: -4, marginBottom: 4 }}
        >
          {node.promptSnippet}
        </div>
      )}

      {/* Children */}
      {isOpen && node.children.map((child) => (
        <AgentNodeRow key={child.id} node={child} expanded={expanded} onToggle={onToggle} />
      ))}
    </div>
  )
}

interface TurnRowProps {
  turn: TurnWithAgents
  expanded: Set<string>
  onToggle: (id: string) => void
  isSelected: boolean
  onSelect: () => void
}

function TurnRow({ turn, expanded, onToggle, isSelected, onSelect }: TurnRowProps) {
  const turnOpen = expanded.has(`turn-${turn.turnIndex}`)

  return (
    <div
      className="rounded-lg border mb-3 overflow-hidden"
      style={{
        borderColor: isSelected ? '#22D3EE40' : '#1E293B',
        background: isSelected ? '#080f1c' : 'transparent',
      }}
    >
      {/* Turn header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer text-[0.65rem] font-mono hover:bg-white/5"
        onClick={() => {
          onSelect()
          onToggle(`turn-${turn.turnIndex}`)
        }}
      >
        <span className="text-slate-600">{turnOpen ? '▾' : '▸'}</span>
        <span className="text-slate-600 shrink-0">#{turn.turnIndex}</span>
        <span className="text-slate-400 truncate flex-1">{turn.userSnippet || '(no user message)'}</span>
        <span
          className="shrink-0 px-1.5 py-0.5 rounded text-[0.5rem] font-bold"
          style={{ background: '#1E293B', color: '#A78BFA' }}
        >
          {turn.totalAgents} agent{turn.totalAgents !== 1 ? 's' : ''}
        </span>
        {turn.maxDepth > 0 && (
          <span className="shrink-0 text-slate-600 text-[0.5rem]">
            depth {turn.maxDepth}
          </span>
        )}
        {turn.estimatedTokens !== null && (
          <span className="shrink-0 text-slate-700 text-[0.5rem]">
            {fmtTokens(turn.estimatedTokens)} tok
          </span>
        )}
        <span className="shrink-0 text-slate-700">{fmtTs(turn.ts)}</span>
      </div>

      {/* Agent tree */}
      {turnOpen && (
        <div className="border-t border-white/5 py-2">
          {turn.agentCalls.length === 0 ? (
            <div className="px-4 text-slate-700 text-[0.6rem]">No agent calls detected.</div>
          ) : (
            turn.agentCalls.map((node) => (
              <AgentNodeRow key={node.id} node={node} expanded={expanded} onToggle={onToggle} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default function AgentTreePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = useState<AgentTreeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSlug, setSelectedSlug] = useState<string>(() => searchParams.get('slug') ?? '')
  const [selectedTurn, setSelectedTurn] = useState<number | null>(() => {
    const t = searchParams.get('turn')
    return t !== null ? parseInt(t, 10) : null
  })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (selectedSlug) params.set('slug', selectedSlug)
        if (selectedTurn !== null) params.set('turn', String(selectedTurn))
        const r = await fetch(`/api/agent-tree?${params}`)
        if (r.ok && !cancelled) {
          const json = await r.json() as AgentTreeResponse
          setData(json)
          // Auto-expand all turn headers
          const ids = new Set<string>()
          for (const t of json.turns) {
            ids.add(`turn-${t.turnIndex}`)
          }
          setExpanded(ids)
        }
      } catch { /* ignore */ } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedSlug, selectedTurn])

  function onToggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSlugChange(slug: string) {
    setSelectedSlug(slug)
    setSelectedTurn(null)
    const params = new URLSearchParams()
    if (slug) params.set('slug', slug)
    router.replace(`?${params.toString()}`)
  }

  function handleSelectTurn(turnIndex: number) {
    const same = selectedTurn === turnIndex
    const next = same ? null : turnIndex
    setSelectedTurn(next)
    const params = new URLSearchParams()
    if (selectedSlug) params.set('slug', selectedSlug)
    if (next !== null) params.set('turn', String(next))
    router.replace(`?${params.toString()}`)
  }

  const totalAgentCalls = data?.turns.reduce((acc, t) => acc + t.totalAgents, 0) ?? 0

  return (
    <div className="min-h-screen bg-[#030712] text-slate-300 font-mono p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <Link href="/" className="text-slate-600 hover:text-cyan-400 text-sm">←</Link>
        <h1 className="text-lg font-bold tracking-widest text-cyan-400 uppercase">Agent Spawn Tree</h1>
        {data && (
          <span className="text-slate-600 text-xs">{data.slug}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {data?.slugs && data.slugs.length > 1 && (
            <select
              value={selectedSlug || (data?.slug ?? '')}
              onChange={(e) => handleSlugChange(e.target.value)}
              className="bg-[#0d1b2e] border border-slate-700 text-slate-300 text-xs rounded px-2 py-1 font-mono"
            >
              {data.slugs.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Stats bar */}
      {data && (
        <div className="flex gap-4 mb-5 text-[0.6rem] text-slate-600 flex-wrap">
          <span>
            <span className="text-slate-400 font-bold">{data.totalTurns}</span> turns with agents
          </span>
          <span>
            <span className="text-slate-400 font-bold">{totalAgentCalls}</span> agent calls shown
          </span>
          {data.selectedTurn !== null && (
            <button
              onClick={() => handleSelectTurn(data.selectedTurn!)}
              className="text-cyan-600 hover:text-cyan-400 underline"
            >
              showing turn {data.selectedTurn} · clear filter
            </button>
          )}
        </div>
      )}

      {/* Depth legend */}
      <div className="flex gap-3 mb-5 text-[0.55rem] text-slate-600 flex-wrap">
        {DEPTH_COLORS.slice(0, 3).map((c, i) => (
          <span key={i}>
            <span className="inline-block w-2 h-3 rounded-sm mr-1 align-middle" style={{ background: c }} />
            Depth {i}
          </span>
        ))}
      </div>

      {loading && <div className="text-slate-600 text-sm animate-pulse">Loading agent trees…</div>}

      {!loading && data && data.turns.length === 0 && (
        <div className="text-slate-700 text-sm">
          No turns with Agent tool calls found for <span className="text-slate-500">{data.slug}</span>.
          <div className="mt-2 text-slate-700 text-xs">
            Agent calls appear when Claude uses the Agent tool (subagent spawning). Try another project.
          </div>
        </div>
      )}

      {!loading && data && data.turns.length > 0 && (
        <div>
          {[...data.turns].reverse().map((turn) => (
            <TurnRow
              key={turn.turnIndex}
              turn={turn}
              expanded={expanded}
              onToggle={onToggle}
              isSelected={selectedTurn === turn.turnIndex}
              onSelect={() => handleSelectTurn(turn.turnIndex)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

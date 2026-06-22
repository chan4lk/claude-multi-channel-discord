'use client'

import { useEffect, useRef, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { SequenceProposal } from '../api/sequence/route'

type EffortSize = 'S' | 'M' | 'L'

const EFFORT_WEEKS: Record<EffortSize, number> = { S: 1, M: 2, L: 4 }
const EFFORT_COLORS: Record<EffortSize, string> = {
  S: '#22D3EE',
  M: '#F59E0B',
  L: '#EF4444',
}

const STATUS_FILTER = ['all', 'pending', 'done'] as const
type StatusFilter = typeof STATUS_FILTER[number]

const STORAGE_KEY = 'mc_sequence_lanes'
const EFFORT_KEY = 'mc_sequence_effort'

type LaneState = Record<string, string[]>  // category -> proposal ids in order

function loadLanes(): LaneState {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as LaneState } catch { return {} }
}

function saveLanes(lanes: LaneState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lanes))
}

function loadEfforts(): Record<string, EffortSize> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(EFFORT_KEY) ?? '{}') as Record<string, EffortSize> } catch { return {} }
}

function saveEfforts(efforts: Record<string, EffortSize>) {
  localStorage.setItem(EFFORT_KEY, JSON.stringify(efforts))
}

interface EffortChipProps {
  id: string
  efforts: Record<string, EffortSize>
  onCycle: (id: string) => void
}

function EffortChip({ id, efforts, onCycle }: EffortChipProps) {
  const size = efforts[id] ?? 'M'
  return (
    <button
      className="text-[9px] font-bold font-mono px-1 py-0.5 rounded border cursor-pointer"
      style={{ borderColor: EFFORT_COLORS[size], color: EFFORT_COLORS[size], background: 'transparent' }}
      onClick={(e) => { e.stopPropagation(); onCycle(id) }}
      title={`Effort: ${size} (${EFFORT_WEEKS[size]}w) — click to cycle`}
    >
      {size}
    </button>
  )
}

interface ProposalCardProps {
  proposal: SequenceProposal
  efforts: Record<string, EffortSize>
  onCycleEffort: (id: string) => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent, id: string) => void
  inLane?: boolean
  onRemove?: () => void
}

function ProposalCard({ proposal, efforts, onCycleEffort, draggable, onDragStart, inLane, onRemove }: ProposalCardProps) {
  const isDone = proposal.status === 'done'
  return (
    <div
      draggable={draggable}
      onDragStart={draggable && onDragStart ? (e) => onDragStart(e, proposal.id) : undefined}
      className="flex items-center gap-1.5 px-2 py-1.5 rounded border select-none"
      style={{
        background: 'rgba(6,13,26,0.8)',
        borderColor: isDone ? 'rgba(74,222,128,0.3)' : 'rgba(34,211,238,0.25)',
        cursor: draggable ? 'grab' : 'default',
        opacity: isDone && !inLane ? 0.5 : 1,
      }}
    >
      <span
        className="text-[9px] font-bold font-mono shrink-0"
        style={{ color: isDone ? '#4ADE80' : '#94A3B8' }}
      >
        P{proposal.number}
      </span>
      <span
        className="text-[10px] font-mono truncate flex-1"
        style={{ color: isDone ? '#94A3B8' : '#E2E8F0' }}
        title={proposal.title}
      >
        {proposal.title}
      </span>
      {inLane && (
        <EffortChip id={proposal.id} efforts={efforts} onCycle={onCycleEffort} />
      )}
      {inLane && onRemove && (
        <button
          className="text-[10px] text-slate-600 hover:text-red-400 ml-0.5 shrink-0"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          title="Remove from lane"
        >
          ✕
        </button>
      )}
    </div>
  )
}

export default function SequencePage() {
  const [proposals, setProposals] = useState<SequenceProposal[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [lanes, setLanes] = useState<LaneState>({})
  const [efforts, setEfforts] = useState<Record<string, EffortSize>>({})
  const [dragOverLane, setDragOverLane] = useState<string | null>(null)
  const [exported, setExported] = useState(false)
  const dragId = useRef<string | null>(null)
  const dragSource = useRef<'list' | string>('list')

  useEffect(() => {
    setLanes(loadLanes())
    setEfforts(loadEfforts())
    fetch('/api/sequence')
      .then((r) => r.json())
      .then((d: { proposals: SequenceProposal[]; categories: string[] }) => {
        setProposals(d.proposals)
        setCategories(d.categories)
      })
      .finally(() => setLoading(false))
  }, [])

  function cycleEffort(id: string) {
    setEfforts((prev) => {
      const cur = prev[id] ?? 'M'
      const next: EffortSize = cur === 'S' ? 'M' : cur === 'M' ? 'L' : 'S'
      const updated = { ...prev, [id]: next }
      saveEfforts(updated)
      return updated
    })
  }

  function onDragStart(e: React.DragEvent, id: string, source: 'list' | string) {
    dragId.current = id
    dragSource.current = source
    e.dataTransfer.effectAllowed = 'copy'
  }

  function onDrop(e: React.DragEvent, category: string) {
    e.preventDefault()
    const id = dragId.current
    if (!id) return
    setLanes((prev) => {
      const lane = prev[category] ?? []
      if (lane.includes(id)) return prev
      const updated = { ...prev, [category]: [...lane, id] }
      saveLanes(updated)
      return updated
    })
    setDragOverLane(null)
  }

  function removeFromLane(category: string, id: string) {
    setLanes((prev) => {
      const lane = (prev[category] ?? []).filter((x) => x !== id)
      const updated = { ...prev, [category]: lane }
      saveLanes(updated)
      return updated
    })
  }

  function exportMarkdown() {
    const proposalMap = new Map(proposals.map((p) => [p.id, p]))
    const rows: string[] = [
      '| P# | Title | Category | Effort | Depends On |',
      '|-----|-------|----------|--------|------------|',
    ]
    for (const cat of categories) {
      const ids = lanes[cat] ?? []
      for (const id of ids) {
        const p = proposalMap.get(id)
        if (!p) continue
        const effort = efforts[id] ?? 'M'
        const deps = p.dependsOn.filter((n) => proposalMap.has(`P${n}`)).map((n) => `P${n}`).join(', ')
        rows.push(`| ${p.id} | ${p.title} | ${cat} | ${effort} (${EFFORT_WEEKS[effort]}w) | ${deps || '—'} |`)
      }
    }
    navigator.clipboard.writeText(rows.join('\n')).then(() => {
      setExported(true)
      setTimeout(() => setExported(false), 2000)
    })
  }

  const proposalMap = new Map(proposals.map((p) => [p.id, p]))

  const filteredList = proposals.filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (categoryFilter !== 'all' && p.category !== categoryFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!p.title.toLowerCase().includes(q) && !p.id.toLowerCase().includes(q)) return false
    }
    // Don't show if already in any lane
    for (const ids of Object.values(lanes)) {
      if (ids.includes(p.id)) return false
    }
    return true
  })

  const totalScheduled = Object.values(lanes).reduce((s, ids) => s + ids.length, 0)

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <SubPageHeader title="MISSION SEQUENCE">
        <span className="text-xs font-mono text-slate-500">{totalScheduled} scheduled</span>
        <button
          className="px-3 py-1 rounded text-xs font-mono border transition-colors"
          style={{
            borderColor: exported ? '#4ADE80' : 'rgba(34,211,238,0.3)',
            color: exported ? '#4ADE80' : '#22D3EE',
            background: 'transparent',
          }}
          onClick={exportMarkdown}
        >
          {exported ? '✓ Copied' : '⬆ Export'}
        </button>
      </SubPageHeader>

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — proposal list */}
        <div
          className="w-72 shrink-0 flex flex-col border-r overflow-y-auto"
          style={{ borderColor: 'rgba(34,211,238,0.1)', background: 'rgba(6,13,26,0.6)' }}
        >
          <div className="p-3 space-y-2 border-b" style={{ borderColor: 'rgba(34,211,238,0.08)' }}>
            <input
              className="w-full text-xs font-mono bg-transparent border rounded px-2 py-1 outline-none"
              style={{ borderColor: 'rgba(34,211,238,0.2)', color: '#CBD5E1' }}
              placeholder="Search proposals…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex gap-1 flex-wrap">
              {STATUS_FILTER.map((s) => (
                <button
                  key={s}
                  className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border transition-colors"
                  style={{
                    borderColor: statusFilter === s ? '#22D3EE' : 'rgba(34,211,238,0.15)',
                    color: statusFilter === s ? '#22D3EE' : '#64748B',
                    background: statusFilter === s ? 'rgba(34,211,238,0.08)' : 'transparent',
                  }}
                  onClick={() => setStatusFilter(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex gap-1 flex-wrap">
              {['all', ...categories].map((c) => (
                <button
                  key={c}
                  className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border transition-colors"
                  style={{
                    borderColor: categoryFilter === c ? '#A78BFA' : 'rgba(167,139,250,0.15)',
                    color: categoryFilter === c ? '#A78BFA' : '#64748B',
                    background: categoryFilter === c ? 'rgba(167,139,250,0.08)' : 'transparent',
                  }}
                  onClick={() => setCategoryFilter(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 p-2 space-y-1">
            {loading && (
              <p className="text-xs font-mono text-slate-600 text-center mt-4">Loading…</p>
            )}
            {!loading && filteredList.length === 0 && (
              <p className="text-xs font-mono text-slate-600 text-center mt-4">No proposals match.</p>
            )}
            {filteredList.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                efforts={efforts}
                onCycleEffort={cycleEffort}
                draggable
                onDragStart={(e, id) => onDragStart(e, id, 'list')}
              />
            ))}
          </div>
        </div>

        {/* Right panel — Gantt swim lanes */}
        <div className="flex-1 overflow-auto p-4">
          {categories.length === 0 && !loading && (
            <p className="text-sm font-mono text-slate-600">No categories found.</p>
          )}
          <div className="space-y-3">
            {categories.map((cat) => {
              const laneIds = lanes[cat] ?? []
              const laneProposals = laneIds.map((id) => proposalMap.get(id)).filter(Boolean) as SequenceProposal[]
              const totalWeeks = laneProposals.reduce((s, p) => s + EFFORT_WEEKS[efforts[p.id] ?? 'M'], 0)

              return (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-[9px] font-bold font-mono uppercase tracking-widest"
                      style={{ color: '#94A3B8' }}
                    >
                      {cat}
                    </span>
                    {laneProposals.length > 0 && (
                      <span className="text-[9px] font-mono text-slate-600">
                        {laneProposals.length} cards · {totalWeeks}w
                      </span>
                    )}
                  </div>
                  <div
                    className="min-h-[52px] rounded border-2 border-dashed transition-colors p-2 flex gap-2 flex-wrap items-start"
                    style={{
                      borderColor: dragOverLane === cat ? '#22D3EE' : 'rgba(34,211,238,0.12)',
                      background: dragOverLane === cat ? 'rgba(34,211,238,0.04)' : 'rgba(6,13,26,0.4)',
                    }}
                    onDragOver={(e) => { e.preventDefault(); setDragOverLane(cat) }}
                    onDragLeave={() => setDragOverLane(null)}
                    onDrop={(e) => onDrop(e, cat)}
                  >
                    {laneProposals.length === 0 && (
                      <span className="text-[10px] font-mono text-slate-700 self-center">
                        Drop proposals here
                      </span>
                    )}
                    {laneProposals.map((p) => {
                      const effort = efforts[p.id] ?? 'M'
                      const widthUnits = EFFORT_WEEKS[effort]
                      return (
                        <div
                          key={p.id}
                          style={{ minWidth: `${widthUnits * 80}px`, maxWidth: `${widthUnits * 80}px` }}
                        >
                          <ProposalCard
                            proposal={p}
                            efforts={efforts}
                            onCycleEffort={cycleEffort}
                            inLane
                            onRemove={() => removeFromLane(cat, p.id)}
                          />
                          {/* Dependency arrows — show inbound deps from other lane items */}
                          {p.dependsOn.length > 0 && (
                            <div className="flex flex-wrap gap-0.5 mt-0.5 px-1">
                              {p.dependsOn
                                .filter((n) => laneIds.includes(`P${n}`))
                                .map((n) => (
                                  <span
                                    key={n}
                                    className="text-[8px] font-mono"
                                    style={{ color: '#F59E0B' }}
                                    title={`Depends on P${n}`}
                                  >
                                    ← P{n}
                                  </span>
                                ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

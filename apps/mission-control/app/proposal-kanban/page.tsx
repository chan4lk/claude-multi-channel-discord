'use client'

import { useEffect, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { ProposalKanbanResponse, KanbanCard, ProposalStage } from '../api/proposal-kanban/route'

const STAGE_COLORS: Record<ProposalStage, string> = {
  proposed: '#64748B',
  planning: '#A78BFA',
  building: '#F59E0B',
  verifying: '#22D3EE',
  done: '#34D399',
}

const PROJECT_PALETTE = [
  '#22D3EE', '#A78BFA', '#F59E0B', '#34D399', '#F87171',
  '#FB923C', '#C084FC', '#38BDF8', '#4ADE80', '#FCD34D',
]

function relAge(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return '1d'
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

function Card({
  card,
  projectColor,
}: {
  card: KanbanCard
  projectColor: string
}) {
  const [hover, setHover] = useState(false)

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative rounded-lg border p-3 cursor-default transition-all"
      style={{
        background: hover ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)',
        borderColor: hover ? `${projectColor}55` : 'rgba(255,255,255,0.08)',
        borderLeftColor: projectColor,
        borderLeftWidth: 3,
      }}
    >
      {hover && (
        <div
          className="absolute z-10 left-0 top-full mt-1 w-64 rounded-lg border border-white/10 bg-slate-900 p-3 shadow-xl text-xs font-mono"
          style={{ minWidth: 220 }}
        >
          <div className="text-white mb-1 leading-snug">{card.title}</div>
          <div className="text-slate-400 text-[0.6rem] mb-1">Project: {card.project}</div>
          <div className="text-slate-400 text-[0.6rem] mb-1">Slug: {card.slug}</div>
          <div className="text-slate-400 text-[0.6rem] mb-1">
            Last modified: {new Date(card.lastModifiedMs).toLocaleString()}
          </div>
          <div className="text-slate-400 text-[0.6rem]">
            Stage inferred from: {card.stageReason}
          </div>
        </div>
      )}
      <div
        className="font-mono text-[0.55rem] mb-1 truncate"
        style={{ color: projectColor }}
      >
        {card.project}
      </div>
      <div className="font-mono text-xs text-white leading-snug line-clamp-2" title={card.title}>
        {card.title}
      </div>
      <div className="font-mono text-[0.5rem] text-slate-500 mt-1">{relAge(card.age)}</div>
    </div>
  )
}

function Column({
  stage,
  label,
  cards,
  projectColors,
}: {
  stage: ProposalStage
  label: string
  cards: KanbanCard[]
  projectColors: Map<string, string>
}) {
  const color = STAGE_COLORS[stage]
  return (
    <div className="flex flex-col min-w-[200px] max-w-[240px] flex-1">
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-t-lg border border-b-0"
        style={{
          background: `${color}18`,
          borderColor: `${color}30`,
        }}
      >
        <div
          className="w-2 h-2 rounded-full"
          style={{ background: color }}
        />
        <span className="font-mono text-[0.6rem] font-bold uppercase tracking-wider" style={{ color }}>
          {label}
        </span>
        <span
          className="ml-auto font-mono text-[0.6rem] px-1.5 py-0.5 rounded-full"
          style={{ background: `${color}22`, color }}
        >
          {cards.length}
        </span>
      </div>
      <div
        className="flex flex-col gap-2 p-2 rounded-b-lg border flex-1 min-h-[120px]"
        style={{ borderColor: `${color}20`, background: `${color}08` }}
      >
        {cards.map((c) => (
          <Card
            key={c.id}
            card={c}
            projectColor={projectColors.get(c.project) ?? '#64748B'}
          />
        ))}
        {cards.length === 0 && (
          <div className="flex items-center justify-center h-16">
            <span className="font-mono text-[0.5rem] text-slate-700">empty</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ProposalKanbanPage() {
  const [data, setData] = useState<ProposalKanbanResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function load() {
      fetch('/api/proposal-kanban')
        .then((r) => r.json())
        .then((d) => setData(d as ProposalKanbanResponse))
        .catch((e) => setError(String(e)))
    }
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  const projectColors = new Map<string, string>()
  if (data) {
    data.projects.forEach((p, i) => {
      projectColors.set(p, PROJECT_PALETTE[i % PROJECT_PALETTE.length]!)
    })
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-white/5">
        <SubPageHeader title="Proposal Pipeline Kanban">
          {data && (
            <div className="flex gap-4 font-mono text-[0.6rem] text-slate-400">
              <span>
                Total: <span className="text-purple-400">{data.totalProposals}</span>
              </span>
              <span>
                Projects: <span className="text-slate-300">{data.projects.length}</span>
              </span>
              <span className="text-slate-600">{data.generatedAt.slice(0, 19).replace('T', ' ')}</span>
            </div>
          )}
        </SubPageHeader>
      </div>

      <div className="p-6">
        {error && <p className="font-mono text-red-400 text-xs mb-4">{error}</p>}
        {!data && !error && <p className="font-mono text-slate-500 text-xs">Loading…</p>}

        {data && data.totalProposals === 0 && (
          <div className="text-center py-16">
            <div className="font-mono text-2xl mb-2">◎</div>
            <p className="font-mono text-slate-400 text-sm">No proposals found.</p>
            <p className="font-mono text-slate-600 text-xs mt-1">
              Run /specclaw:propose in a project channel to create proposals.
            </p>
          </div>
        )}

        {data && data.totalProposals > 0 && (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {data.columns.map((col) => (
              <Column
                key={col.stage}
                stage={col.stage}
                label={col.label}
                cards={col.cards}
                projectColors={projectColors}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { ProposalKanbanResponse, KanbanCard, Stage } from '../api/proposal-kanban/route'

const STAGE_COLORS: Record<Stage, string> = {
  proposed: '#64748B',
  planning: '#F59E0B',
  building: '#22D3EE',
  verifying: '#A78BFA',
  done: '#10B981',
}

const PROJECT_PALETTE = [
  '#22D3EE', '#F59E0B', '#A78BFA', '#10B981', '#F87171',
  '#FB923C', '#34D399', '#818CF8', '#F472B6', '#38BDF8',
]

function projectColor(project: string, list: string[]): string {
  const idx = list.indexOf(project)
  return PROJECT_PALETTE[idx % PROJECT_PALETTE.length] ?? '#64748B'
}

function Card({ card, projectList }: { card: KanbanCard; projectList: string[] }) {
  const color = projectColor(card.project, projectList)
  return (
    <div
      className="rounded-lg p-3 w-full"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${color}22`,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div className="font-mono text-[0.5rem] mb-0.5 truncate" style={{ color }}>{card.project}</div>
      <div className="font-mono text-xs text-white leading-snug line-clamp-2" title={card.title}>
        {card.title}
      </div>
      <div className="mt-2 flex justify-between items-center">
        <span className="font-mono text-[0.5rem] text-slate-600 truncate max-w-[90px]">{card.changeName}</span>
        <span className="font-mono text-[0.5rem] text-slate-500">{card.age}</span>
      </div>
    </div>
  )
}

export default function ProposalKanbanPage() {
  const [data, setData] = useState<ProposalKanbanResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/proposal-kanban')
      .then((r) => r.json())
      .then((d) => setData(d as ProposalKanbanResponse))
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  const projectList = data
    ? [...new Set(data.columns.flatMap((c) => c.cards.map((card) => card.project)))]
    : []

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-white/5">
        <SubPageHeader title="Proposal Pipeline Kanban">
          {data && (
            <div className="flex gap-4 font-mono text-[0.6rem] text-slate-400">
              <span>Total: <span className="text-white">{data.total}</span></span>
              <span className="text-slate-600">{data.computedAt.slice(0, 19).replace('T', ' ')}</span>
            </div>
          )}
        </SubPageHeader>
      </div>

      <div className="p-6 overflow-x-auto">
        {error && <p className="font-mono text-red-400 text-xs mb-4">{error}</p>}
        {!data && !error && <p className="font-mono text-slate-500 text-xs">Loading…</p>}

        {data && data.total === 0 && (
          <p className="font-mono text-slate-500 text-xs">No specclaw proposals found across projects.</p>
        )}

        {data && data.total > 0 && (
          <div className="flex gap-4" style={{ minWidth: 900 }}>
            {data.columns.map((col) => {
              const color = STAGE_COLORS[col.stage]
              return (
                <div key={col.stage} className="flex-1 min-w-[160px]">
                  <div className="mb-3 flex justify-between items-center px-1">
                    <span
                      className="font-mono text-xs font-semibold uppercase tracking-wider"
                      style={{ color }}
                    >
                      {col.label}
                    </span>
                    <span
                      className="font-mono text-[0.55rem] rounded-full px-2 py-0.5"
                      style={{ background: `${color}22`, color }}
                    >
                      {col.cards.length}
                    </span>
                  </div>
                  <div
                    className="rounded-xl p-2 flex flex-col gap-2 min-h-[120px]"
                    style={{ background: `${color}08`, border: `1px solid ${color}18` }}
                  >
                    {col.cards.length === 0 ? (
                      <div className="flex items-center justify-center h-20">
                        <span className="font-mono text-[0.5rem] text-slate-700">empty</span>
                      </div>
                    ) : (
                      col.cards.map((card) => (
                        <Card key={card.id} card={card} projectList={projectList} />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

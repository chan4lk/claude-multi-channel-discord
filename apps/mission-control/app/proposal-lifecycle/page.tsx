'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { ProposalLifecycleResponse, LifecycleProposal, LifecycleStage } from '../api/proposal-lifecycle/route'

const STAGE_ORDER: LifecycleStage[] = ['proposed', 'planned', 'building', 'verifying', 'merged']

const STAGE_CONFIG: Record<LifecycleStage, { label: string; color: string; icon: string }> = {
  proposed: { label: 'Proposed', color: '#64748B', icon: '◌' },
  planned:  { label: 'Planned',  color: '#A78BFA', icon: '◎' },
  building: { label: 'Building', color: '#F59E0B', icon: '⟳' },
  verifying:{ label: 'Verifying',color: '#22D3EE', icon: '⊛' },
  merged:   { label: 'Merged',   color: '#34D399', icon: '✓' },
}

const PROJECT_PALETTE = [
  '#22D3EE','#A78BFA','#F59E0B','#34D399','#F87171',
  '#FB923C','#C084FC','#38BDF8','#4ADE80','#FCD34D',
]

function relAge(days: number): string {
  if (days === 0) return 'today'
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

function StageProgressBar({ proposal }: { proposal: LifecycleProposal }) {
  const stages = STAGE_ORDER
  const currentIdx = stages.indexOf(proposal.stage)
  return (
    <div className="flex gap-0.5 mt-2">
      {stages.map((s, i) => {
        const cfg = STAGE_CONFIG[s]
        const filled = i <= currentIdx
        return (
          <div
            key={s}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{ background: filled ? cfg.color : 'rgba(255,255,255,0.08)' }}
            title={cfg.label}
          />
        )
      })}
    </div>
  )
}

function TaskBar({ done, total }: { done: number; total: number }) {
  if (total === 0) return null
  const pct = Math.round((done / total) * 100)
  return (
    <div className="flex items-center gap-1.5 mt-1.5">
      <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: pct === 100 ? '#34D399' : '#F59E0B' }}
        />
      </div>
      <span className="text-[0.55rem] font-mono text-slate-500">{done}/{total}</span>
    </div>
  )
}

interface DrawerProps {
  proposal: LifecycleProposal
  onClose: () => void
}

function DetailDrawer({ proposal, onClose }: DrawerProps) {
  const cfg = STAGE_CONFIG[proposal.stage]
  const [content, setContent] = useState<{ proposal: string; tasks: string | null } | null>(null)
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/proposal-lifecycle/detail?id=${encodeURIComponent(proposal.id)}`)
      .then((r) => r.json())
      .then(setContent)
      .catch(() => setContent({ proposal: proposal.proposalSnippet, tasks: null }))
  }, [proposal.id, proposal.proposalSnippet])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={drawerRef}
        className="relative z-10 w-full max-w-lg h-full bg-slate-950 border-l border-white/10 overflow-y-auto flex flex-col"
      >
        <div className="sticky top-0 bg-slate-950 border-b border-white/10 px-4 py-3 flex items-start justify-between gap-2">
          <div>
            <div className="text-xs font-mono font-bold text-white leading-snug">{proposal.title}</div>
            <div className="text-[0.6rem] font-mono mt-0.5" style={{ color: cfg.color }}>
              {cfg.icon} {cfg.label} · {proposal.project}/{proposal.changeName}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-sm font-mono shrink-0 mt-0.5"
          >✕</button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          {/* Stage progress */}
          <div>
            <div className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider mb-1">Stage Progress</div>
            <StageProgressBar proposal={proposal} />
            <div className="flex justify-between mt-1">
              {STAGE_ORDER.map((s) => (
                <span
                  key={s}
                  className="text-[0.45rem] font-mono"
                  style={{ color: s === proposal.stage ? STAGE_CONFIG[s].color : 'rgba(255,255,255,0.2)' }}
                >
                  {STAGE_CONFIG[s].label}
                </span>
              ))}
            </div>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Age', value: relAge(proposal.ageDays) },
              { label: 'In stage', value: relAge(proposal.stageAgeDays) },
              { label: 'Tasks', value: proposal.taskCount > 0 ? `${proposal.tasksDone}/${proposal.taskCount}` : '—' },
            ].map(({ label, value }) => (
              <div key={label} className="rounded p-2 border border-white/5 bg-white/2">
                <div className="text-[0.5rem] font-mono text-slate-500 uppercase">{label}</div>
                <div className="text-xs font-mono text-white mt-0.5">{value}</div>
              </div>
            ))}
          </div>

          {proposal.prUrl && (
            <a
              href={proposal.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[0.65rem] font-mono text-cyan-400 hover:underline"
            >
              ↗ View PR
            </a>
          )}

          {/* Proposal content */}
          <div>
            <div className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider mb-1.5">Proposal</div>
            <div className="rounded border border-white/5 bg-slate-900 p-3 text-[0.65rem] font-mono text-slate-300 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
              {content ? content.proposal : 'Loading…'}
            </div>
          </div>

          {/* Tasks checklist */}
          {(content?.tasks || proposal.hasTasks) && (
            <div>
              <div className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider mb-1.5">Tasks</div>
              <div className="rounded border border-white/5 bg-slate-900 p-3 text-[0.65rem] font-mono text-slate-300 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                {content?.tasks ?? 'Loading…'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ProposalCard({
  proposal,
  projectColor,
  onClick,
}: {
  proposal: LifecycleProposal
  projectColor: string
  onClick: () => void
}) {
  const cfg = STAGE_CONFIG[proposal.stage]
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border p-3 transition-all hover:border-opacity-60 focus:outline-none"
      style={{
        background: 'rgba(255,255,255,0.02)',
        borderColor: 'rgba(255,255,255,0.08)',
        borderLeftColor: projectColor,
        borderLeftWidth: 3,
      }}
    >
      <div className="flex items-start justify-between gap-1">
        <span
          className="text-[0.55rem] font-mono font-bold px-1 rounded shrink-0"
          style={{ background: `${projectColor}22`, color: projectColor }}
        >
          {proposal.project}
        </span>
        <span className="text-[0.55rem] font-mono text-slate-500 shrink-0">{relAge(proposal.ageDays)}</span>
      </div>
      <p className="text-[0.65rem] font-mono text-slate-200 mt-1.5 leading-snug line-clamp-2">{proposal.title}</p>
      <div className="text-[0.55rem] font-mono mt-1" style={{ color: cfg.color }}>
        {cfg.icon} {proposal.stageAgeDays > 0 ? `${relAge(proposal.stageAgeDays)} in stage` : 'just moved'}
      </div>
      <StageProgressBar proposal={proposal} />
      {proposal.hasTasks && <TaskBar done={proposal.tasksDone} total={proposal.taskCount} />}
    </button>
  )
}

export default function ProposalLifecyclePage() {
  const [data, setData] = useState<ProposalLifecycleResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<LifecycleProposal | null>(null)
  const [filterProjects, setFilterProjects] = useState<string[]>([])
  const [filterStages, setFilterStages] = useState<LifecycleStage[]>([])
  const [projectDropdown, setProjectDropdown] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/proposal-lifecycle')
      .then((r) => r.json())
      .then((d: ProposalLifecycleResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const proposals = data?.proposals ?? []
  const filtered = proposals.filter((p) => {
    if (filterProjects.length > 0 && !filterProjects.includes(p.project)) return false
    if (filterStages.length > 0 && !filterStages.includes(p.stage)) return false
    return true
  })

  const projectColorMap = Object.fromEntries(
    (data?.projects ?? []).map((slug, i) => [slug, PROJECT_PALETTE[i % PROJECT_PALETTE.length]])
  )

  const toggleProject = (slug: string) => {
    setFilterProjects((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    )
  }

  const toggleStage = (stage: LifecycleStage) => {
    setFilterStages((prev) =>
      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage]
    )
  }

  const t = data?.throughput

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-mono">
      <SubPageHeader title="Proposal Lifecycle" />

      {/* Throughput header */}
      {t && (
        <div className="border-b border-white/5 px-4 py-3">
          <div className="max-w-6xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Active proposals', value: t.totalActive, color: '#22D3EE' },
              { label: 'Merged total', value: t.totalMerged, color: '#34D399' },
              { label: 'Merged (4 wks)', value: t.mergedLast4Weeks, color: '#A78BFA' },
              {
                label: 'Avg time to merge',
                value: t.avgTimeToMergeDays !== null ? `${t.avgTimeToMergeDays}d` : '—',
                color: '#F59E0B',
              },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="rounded-lg border p-3"
                style={{ borderColor: `${color}25`, background: `${color}0a` }}
              >
                <div className="text-[0.55rem] uppercase tracking-wider" style={{ color: `${color}99` }}>{label}</div>
                <div className="text-lg font-bold mt-0.5" style={{ color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Per-week sparkline */}
          <div className="max-w-6xl mx-auto mt-2 flex items-center gap-2">
            <span className="text-[0.55rem] text-slate-500">Merged/week (newest→oldest):</span>
            <div className="flex items-end gap-1 h-6">
              {t.mergedPerWeek.map((count, i) => (
                <div
                  key={i}
                  className="rounded-sm"
                  style={{
                    width: 16,
                    height: Math.max(2, count * 6),
                    background: i === 0 ? '#34D399' : '#34D39966',
                  }}
                  title={`Week ${i === 0 ? 'current' : i + 1}: ${count}`}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap gap-2 items-center">
        {/* Project filter */}
        <div className="relative">
          <button
            onClick={() => setProjectDropdown((v) => !v)}
            className="text-[0.65rem] font-mono px-2 py-1 rounded border border-white/10 hover:border-white/20 text-slate-300 transition-colors"
          >
            {filterProjects.length === 0 ? 'All projects' : `${filterProjects.length} selected`} ▾
          </button>
          {projectDropdown && (
            <div className="absolute z-20 top-full left-0 mt-1 rounded border border-white/10 bg-slate-900 shadow-xl p-2 min-w-40 max-h-48 overflow-y-auto">
              {(data?.projects ?? []).map((slug) => (
                <label key={slug} className="flex items-center gap-1.5 cursor-pointer py-0.5 px-1 hover:bg-white/5 rounded">
                  <input
                    type="checkbox"
                    checked={filterProjects.includes(slug)}
                    onChange={() => toggleProject(slug)}
                    className="accent-cyan-400"
                  />
                  <span className="text-[0.6rem] font-mono text-slate-300">{slug}</span>
                  <span
                    className="w-2 h-2 rounded-full ml-auto shrink-0"
                    style={{ background: projectColorMap[slug] ?? '#64748B' }}
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Stage filter pills */}
        <div className="flex gap-1 flex-wrap">
          {STAGE_ORDER.map((stage) => {
            const cfg = STAGE_CONFIG[stage]
            const active = filterStages.includes(stage)
            return (
              <button
                key={stage}
                onClick={() => toggleStage(stage)}
                className="text-[0.6rem] font-mono px-2 py-0.5 rounded border transition-colors"
                style={{
                  borderColor: active ? cfg.color : 'rgba(255,255,255,0.1)',
                  background: active ? `${cfg.color}22` : 'transparent',
                  color: active ? cfg.color : 'rgba(255,255,255,0.4)',
                }}
              >
                {cfg.icon} {cfg.label}
              </button>
            )
          })}
        </div>

        {(filterProjects.length > 0 || filterStages.length > 0) && (
          <button
            onClick={() => { setFilterProjects([]); setFilterStages([]) }}
            className="text-[0.6rem] font-mono text-slate-500 hover:text-slate-300 px-1"
          >
            ✕ clear
          </button>
        )}
      </div>

      {/* Kanban board */}
      <div className="max-w-6xl mx-auto px-4 pb-8 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-500 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-500 text-sm gap-1">
            <span className="text-2xl">⊘</span>
            <span>No proposals found</span>
          </div>
        ) : (
          <div className="flex gap-4 min-w-0" style={{ minWidth: 900 }}>
            {STAGE_ORDER.map((stage) => {
              const cfg = STAGE_CONFIG[stage]
              const cards = filtered.filter((p) => p.stage === stage)
              return (
                <div key={stage} className="flex-1 min-w-0 flex flex-col gap-2">
                  {/* Column header */}
                  <div
                    className="flex items-center gap-1.5 py-1.5 px-2 rounded"
                    style={{ background: `${cfg.color}11`, borderBottom: `2px solid ${cfg.color}` }}
                  >
                    <span style={{ color: cfg.color }}>{cfg.icon}</span>
                    <span className="text-[0.65rem] font-mono font-bold" style={{ color: cfg.color }}>
                      {cfg.label}
                    </span>
                    <span
                      className="ml-auto text-[0.55rem] font-mono rounded-full px-1.5 py-0.5"
                      style={{ background: `${cfg.color}22`, color: cfg.color }}
                    >
                      {cards.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div className="flex flex-col gap-2">
                    {cards.map((proposal) => (
                      <ProposalCard
                        key={proposal.id}
                        proposal={proposal}
                        projectColor={projectColorMap[proposal.project] ?? '#64748B'}
                        onClick={() => setSelected(proposal)}
                      />
                    ))}
                    {cards.length === 0 && (
                      <div
                        className="rounded-lg border border-dashed p-4 text-center text-[0.6rem] font-mono text-slate-600"
                        style={{ borderColor: `${cfg.color}22` }}
                      >
                        empty
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selected && (
        <DetailDrawer proposal={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

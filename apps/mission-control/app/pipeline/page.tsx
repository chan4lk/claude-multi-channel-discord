'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import GlassCard from '../../components/ui/GlassCard'
import type { PipelineCard, PipelineStage } from '../api/pipeline/route'
import type { ImpactStats } from '../api/pipeline/impact/[slug]/[changeName]/route'

const STAGES: PipelineStage[] = ['propose', 'plan', 'build', 'verify', 'pr', 'completed']

const STAGE_LABELS: Record<PipelineStage, string> = {
  propose: 'Propose',
  plan: 'Plan',
  build: 'Build',
  verify: 'Verify',
  pr: 'PR',
  completed: 'Done',
}

const STAGE_COLORS: Record<PipelineStage, string> = {
  propose: '#A78BFA',
  plan: '#60A5FA',
  build: '#F59E0B',
  verify: '#34D399',
  pr: '#4ADE80',
  completed: '#22D3EE',
}

const STAGE_ICONS: Record<PipelineStage, string> = {
  propose: '📝',
  plan: '📋',
  build: '🔨',
  verify: '🔍',
  pr: '🔀',
  completed: '✓',
}

function formatAge(ms: number): string {
  const diff = Math.floor((Date.now() - ms) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

interface DrawerProps {
  card: PipelineCard
  onClose: () => void
}

const DIFF_STAGES: PipelineStage[] = ['build', 'verify', 'pr', 'completed']

interface DiffData {
  log: string
  stat: string
  error?: string
}

type DrawerTab = 'overview' | 'impact'

function ImpactStatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded p-2 border"
      style={{ background: `${color}0d`, borderColor: `${color}25` }}
    >
      <span className="text-[0.55rem] font-mono uppercase tracking-wider" style={{ color: `${color}99` }}>{label}</span>
      <span className="text-sm font-bold font-mono" style={{ color }}>{value}</span>
    </div>
  )
}

function DetailDrawer({ card, onClose }: DrawerProps) {
  const color = STAGE_COLORS[card.stage]
  const [diff, setDiff] = useState<DiffData | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const fetchedRef = useRef<string | null>(null)
  const [activeTab, setActiveTab] = useState<DrawerTab>('overview')
  const [impact, setImpact] = useState<ImpactStats | null>(null)
  const [impactLoading, setImpactLoading] = useState(false)
  const impactFetchedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!DIFF_STAGES.includes(card.stage)) return
    const key = `${card.slug}::${card.name}`
    if (fetchedRef.current === key) return
    fetchedRef.current = key
    setDiffLoading(true)
    fetch(`/api/diff/${encodeURIComponent(card.slug)}`)
      .then((r) => r.json())
      .then((d: { log?: string; diff?: string; error?: string }) => {
        const log = d.log ?? ''
        const statLines = (d.diff ?? '')
          .split('\n')
          .filter((l) => /^\s*([\w./].+\||\d+ file)/.test(l))
          .slice(0, 20)
        setDiff({ log, stat: statLines.join('\n'), error: d.error })
      })
      .catch(() => setDiff({ log: '', stat: '', error: 'Failed to fetch diff' }))
      .finally(() => setDiffLoading(false))
  }, [card.slug, card.stage, card.name])

  useEffect(() => {
    if (activeTab !== 'impact') return
    const key = `${card.slug}::${card.name}`
    if (impactFetchedRef.current === key) return
    impactFetchedRef.current = key
    setImpactLoading(true)
    fetch(`/api/pipeline/impact/${encodeURIComponent(card.slug)}/${encodeURIComponent(card.name)}`)
      .then((r) => r.json())
      .then((d: ImpactStats) => setImpact(d))
      .catch(() => setImpact(null))
      .finally(() => setImpactLoading(false))
  }, [activeTab, card.slug, card.name])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ x: 400, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 400, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
        className="w-full max-w-md h-full border-l border-cyber-cyan/12 overflow-y-auto"
        style={{ background: '#0A111E' }}
      >
        <div className="p-5 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-[0.6rem] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border"
                  style={{ color, borderColor: `${color}40`, background: `${color}15` }}
                >
                  {STAGE_ICONS[card.stage]} {STAGE_LABELS[card.stage]}
                </span>
                {card.stalled && (
                  <span className="text-[0.6rem] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border text-amber-400 border-amber-400/40 bg-amber-400/10 animate-pulse">
                    stalled
                  </span>
                )}
              </div>
              <h2 className="text-base font-bold text-slate-100 font-mono">{card.name}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{card.slug} · {formatAge(card.lastModifiedMs)}</p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-300 text-xl leading-none mt-0.5"
            >
              ×
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 border-b border-white/8">
            {(['overview', 'impact'] as DrawerTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-3 py-1.5 text-[0.6rem] font-mono uppercase tracking-wider transition-colors"
                style={{
                  color: activeTab === tab ? color : '#475569',
                  borderBottom: activeTab === tab ? `2px solid ${color}` : '2px solid transparent',
                  background: 'transparent',
                }}
              >
                {tab === 'overview' ? '📋 Overview' : '📊 Impact'}
              </button>
            ))}
          </div>

          {activeTab === 'impact' && (
            <div className="flex flex-col gap-3">
              {impactLoading ? (
                <div className="text-[0.6rem] text-slate-500 font-mono animate-pulse">Computing impact…</div>
              ) : impact ? (
                impact.createdDate === null ? (
                  <p className="text-[0.6rem] text-slate-600 font-mono">No creation date found in proposal — cannot bound git log.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <ImpactStatCard label="Commits" value={impact.commits} color="#4ADE80" />
                      <ImpactStatCard label="Files Changed" value={impact.filesChanged} color="#60A5FA" />
                      <ImpactStatCard label="Lines Added" value={`+${impact.linesAdded}`} color="#34D399" />
                      <ImpactStatCard label="Lines Deleted" value={`-${impact.linesDeleted}`} color="#F87171" />
                      <ImpactStatCard label="Tool Calls" value={impact.toolCalls} color="#A78BFA" />
                      <ImpactStatCard label="Duration" value={`${impact.durationDays}d`} color="#F59E0B" />
                    </div>
                    {impact.commits === 0 && (
                      <p className="text-[0.6rem] text-slate-600 font-mono">No commits yet since {impact.createdDate}</p>
                    )}
                  </>
                )
              ) : (
                <p className="text-[0.6rem] text-slate-600 font-mono">Failed to load impact stats.</p>
              )}
            </div>
          )}

          {activeTab === 'overview' && <>

          {/* Stage pipeline */}
          <div className="flex gap-1">
            {STAGES.map((s, i) => {
              const stageIdx = STAGES.indexOf(card.stage)
              const isDone = i < stageIdx
              const isActive = s === card.stage
              return (
                <div
                  key={s}
                  className="flex-1 py-1 rounded text-center text-[0.6rem] font-bold font-mono uppercase tracking-wider"
                  style={{
                    background: isDone ? `${STAGE_COLORS[s]}22` : isActive ? `${color}18` : 'rgba(255,255,255,0.03)',
                    color: isDone ? STAGE_COLORS[s] : isActive ? color : '#475569',
                    border: isActive ? `1px solid ${color}50` : '1px solid transparent',
                  }}
                >
                  {isDone ? '✓' : STAGE_ICONS[s]}
                </div>
              )
            })}
          </div>

          {/* PR link */}
          {card.prUrl && (
            <a
              href={card.prUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-mono text-cyber-cyan hover:underline flex items-center gap-1"
            >
              🔗 {card.prUrl.replace('https://github.com/', 'github.com/')}
            </a>
          )}

          {/* Tasks checklist */}
          {card.tasksChecklist.length > 0 && (
            <div>
              <div className="text-[0.6rem] text-slate-500 uppercase tracking-wider font-semibold mb-2">
                Tasks — {card.tasksDone}/{card.tasksTotal}
              </div>
              <div
                className="w-full h-1 rounded mb-2"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                <div
                  className="h-full rounded transition-all"
                  style={{
                    width: card.tasksTotal > 0 ? `${(card.tasksDone / card.tasksTotal) * 100}%` : '0%',
                    background: color,
                    boxShadow: `0 0 8px ${color}60`,
                  }}
                />
              </div>
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                {card.tasksChecklist.map((t, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span
                      className="shrink-0 mt-0.5 font-mono"
                      style={{ color: t.done ? '#4ADE80' : '#475569' }}
                    >
                      {t.done ? '✓' : '○'}
                    </span>
                    <span style={{ color: t.done ? '#64748B' : '#CBD5E1', textDecoration: t.done ? 'line-through' : 'none' }}>
                      {t.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Proposal snippet */}
          {card.proposalSnippet && (
            <div>
              <div className="text-[0.6rem] text-slate-500 uppercase tracking-wider font-semibold mb-2">Proposal</div>
              <p className="text-xs text-slate-400 leading-relaxed">{card.proposalSnippet}</p>
            </div>
          )}

          {/* Git diff preview for build/verify/pr */}
          {DIFF_STAGES.includes(card.stage) && (
            <div>
              <div className="text-[0.6rem] text-slate-500 uppercase tracking-wider font-semibold mb-2 flex items-center gap-2">
                Recent Commits
                {diffLoading && <span className="animate-pulse text-slate-600">…</span>}
              </div>
              {diff?.error ? (
                <p className="text-[0.6rem] text-slate-600 font-mono">{diff.error}</p>
              ) : diff?.log ? (
                <div className="bg-[#060d1a] border border-cyber-cyan/10 rounded p-2 overflow-x-auto">
                  <pre className="text-[0.6rem] font-mono text-slate-400 leading-relaxed whitespace-pre">{diff.log}</pre>
                  {diff.stat && (
                    <pre className="text-[0.6rem] font-mono text-slate-600 leading-relaxed whitespace-pre mt-2 pt-2 border-t border-white/5">{diff.stat}</pre>
                  )}
                </div>
              ) : !diffLoading ? (
                <p className="text-[0.6rem] text-slate-600 font-mono">No commits yet</p>
              ) : null}
            </div>
          )}

          <div className="text-[0.6rem] text-slate-600 font-mono">
            {card.daysInStage === 0 ? 'In stage today' : `${card.daysInStage}d in ${STAGE_LABELS[card.stage]}`}
          </div>

          </> /* end overview tab */}
        </div>
      </motion.div>
    </motion.div>
  )
}

interface KanbanCardProps {
  card: PipelineCard
  onClick: () => void
}

function KanbanCard({ card, onClick }: KanbanCardProps) {
  const color = STAGE_COLORS[card.stage]

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="cursor-pointer"
      onClick={onClick}
    >
      <GlassCard
        className="p-3 flex flex-col gap-2 hover:border-cyber-cyan/20 transition-colors"
        style={{ borderColor: card.stalled ? '#F59E0B30' : undefined }}
      >
        <div className="flex items-start justify-between gap-1">
          <span className="text-xs font-semibold text-slate-200 font-mono leading-tight line-clamp-2">{card.name}</span>
          {card.stalled && (
            <span className="text-[0.55rem] shrink-0 text-amber-400 font-mono font-bold uppercase animate-pulse">!</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="text-[0.55rem] font-mono px-1 py-0.5 rounded"
            style={{ background: `${color}15`, color }}
          >
            {card.slug}
          </span>
          <span className="text-[0.55rem] text-slate-500 ml-auto">{formatAge(card.lastModifiedMs)}</span>
        </div>
        {card.tasksTotal > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div
                className="h-full rounded"
                style={{
                  width: `${(card.tasksDone / card.tasksTotal) * 100}%`,
                  background: color,
                }}
              />
            </div>
            <span className="text-[0.55rem] text-slate-500 shrink-0">{card.tasksDone}/{card.tasksTotal}</span>
          </div>
        )}
        {card.prUrl && (
          <span className="text-[0.55rem] text-cyber-cyan font-mono">🔗 PR open</span>
        )}
      </GlassCard>
    </motion.div>
  )
}

export default function PipelinePage() {
  const [cards, setCards] = useState<PipelineCard[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<number>(0)
  const [selectedCard, setSelectedCard] = useState<PipelineCard | null>(null)
  const [leaderboard, setLeaderboard] = useState<ImpactStats[]>([])
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
  const [stageFilter, setStageFilter] = useState<PipelineStage | 'all'>('all')
  const leaderboardCardsKey = useRef<string>('')

  async function fetchLeaderboard(cardList: PipelineCard[]) {
    if (cardList.length === 0) return
    const key = cardList.map((c) => `${c.slug}:${c.name}`).sort().join(',')
    if (leaderboardCardsKey.current === key) return
    leaderboardCardsKey.current = key
    setLeaderboardLoading(true)

    const BATCH = 5
    const all: ImpactStats[] = []
    for (let i = 0; i < cardList.length; i += BATCH) {
      const batch = cardList.slice(i, i + BATCH)
      const results = await Promise.allSettled(
        batch.map((c) =>
          fetch(`/api/pipeline/impact/${encodeURIComponent(c.slug)}/${encodeURIComponent(c.name)}`)
            .then((r) => r.json() as Promise<ImpactStats>)
        )
      )
      for (const r of results) {
        if (r.status === 'fulfilled') all.push(r.value)
      }
    }
    all.sort((a, b) => (b.commits + b.linesAdded) - (a.commits + a.linesAdded))
    setLeaderboard(all)
    setLeaderboardLoading(false)
  }

  async function fetchCards() {
    try {
      const res = await fetch('/api/pipeline')
      if (res.ok) {
        const data: PipelineCard[] = await res.json()
        setCards(data)
        setLastRefresh(Date.now())
        leaderboardCardsKey.current = ''
        fetchLeaderboard(data)
      }
    } catch {}
    setLoading(false)
  }

  useEffect(() => {
    fetchCards()
    const id = setInterval(fetchCards, 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (cards.length > 0) fetchLeaderboard(cards)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards])

  const byStage = (stage: PipelineStage) => cards.filter((c) => c.stage === stage)
  const stalledCount = cards.filter((c) => c.stalled).length

  return (
    <div className="min-h-dvh">
      {/* Header */}
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-4">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-black tracking-[0.18em] text-cyber-cyan neon-cyan" style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}>
              SPECCLAW PIPELINE
            </h1>
            <div className="flex items-center gap-3 mt-0.5">
              <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
                ← Dashboard
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {stalledCount > 0 && (
              <span className="text-xs font-mono text-amber-400 animate-pulse">
                {stalledCount} stalled
              </span>
            )}
            <span className="text-xs font-mono text-slate-500">{cards.length} changes</span>
            <button
              onClick={fetchCards}
              className="text-[0.6rem] font-mono px-2 py-1 rounded border border-cyber-cyan/20 text-slate-400 hover:text-cyber-cyan hover:border-cyber-cyan/40 transition-colors"
            >
              ↺ Refresh
            </button>
            {lastRefresh > 0 && (
              <span className="text-[0.55rem] text-slate-600 font-mono">
                {formatAge(lastRefresh)}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="p-4 sm:p-6">
        {loading ? (
          <div className="text-slate-500 text-sm text-center py-12">Loading pipeline…</div>
        ) : cards.length === 0 ? (
          <div className="text-slate-500 text-sm text-center py-12 font-mono">No active specclaw changes found.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {STAGES.map((stage) => {
              const stageCards = byStage(stage)
              const color = STAGE_COLORS[stage]
              const stalledInStage = stageCards.filter((c) => c.stalled).length

              return (
                <div key={stage} className="flex flex-col gap-3">
                  {/* Column header */}
                  <div
                    className="flex items-center gap-2 pb-2 border-b"
                    style={{ borderColor: `${color}25` }}
                  >
                    <span className="text-sm">{STAGE_ICONS[stage]}</span>
                    <span
                      className="text-xs font-bold font-mono uppercase tracking-wider"
                      style={{ color }}
                    >
                      {STAGE_LABELS[stage]}
                    </span>
                    <span
                      className="ml-auto text-[0.6rem] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: `${color}18`, color }}
                    >
                      {stageCards.length}
                    </span>
                    {stalledInStage > 0 && (
                      <span className="text-[0.6rem] font-mono text-amber-400 animate-pulse">
                        {stalledInStage}!
                      </span>
                    )}
                  </div>

                  {/* Cards */}
                  <div className="flex flex-col gap-2">
                    {stageCards.length === 0 ? (
                      <div
                        className="border border-dashed rounded p-3 text-center text-[0.6rem] font-mono text-slate-700"
                        style={{ borderColor: `${color}15` }}
                      >
                        empty
                      </div>
                    ) : (
                      stageCards.map((card) => (
                        <KanbanCard
                          key={`${card.slug}::${card.name}`}
                          card={card}
                          onClick={() => setSelectedCard(card)}
                        />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Impact Leaderboard */}
        {(leaderboard.length > 0 || leaderboardLoading) && (
          <div className="mt-8">
            <div className="text-[0.6rem] font-mono uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2 flex-wrap">
              <span style={{ color: '#A78BFA' }}>◆</span>
              <span>Impact Leaderboard — all stages, ranked by commits + lines</span>
              {leaderboardLoading && <span className="text-slate-600 animate-pulse">updating…</span>}
            </div>

            {/* Stage filter */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(['all', ...STAGES] as const).map((s) => {
                const active = stageFilter === s
                const color = s === 'all' ? '#A78BFA' : STAGE_COLORS[s as PipelineStage]
                const count = s === 'all' ? leaderboard.length : leaderboard.filter((lb) => {
                  const card = cards.find((c) => c.slug === lb.slug && c.name === lb.changeName)
                  return card?.stage === s
                }).length
                return (
                  <button
                    key={s}
                    onClick={() => setStageFilter(s)}
                    className="text-[0.6rem] font-mono px-2.5 py-1 rounded border transition-colors"
                    style={{
                      borderColor: active ? `${color}60` : `${color}20`,
                      color: active ? color : '#475569',
                      background: active ? `${color}14` : 'transparent',
                    }}
                  >
                    {s === 'all' ? 'All' : STAGE_LABELS[s as PipelineStage]} ({count})
                  </button>
                )
              })}
            </div>

            {(() => {
              const filtered = stageFilter === 'all'
                ? leaderboard
                : leaderboard.filter((lb) => {
                    const card = cards.find((c) => c.slug === lb.slug && c.name === lb.changeName)
                    return card?.stage === stageFilter
                  })
              const totals = {
                commits: filtered.reduce((s, r) => s + r.commits, 0),
                linesAdded: filtered.reduce((s, r) => s + r.linesAdded, 0),
                linesDeleted: filtered.reduce((s, r) => s + r.linesDeleted, 0),
                toolCalls: filtered.reduce((s, r) => s + r.toolCalls, 0),
              }
              return (
                <div className="overflow-x-auto rounded border border-white/6">
                  <table className="w-full text-[0.65rem] font-mono">
                    <thead>
                      <tr className="border-b border-white/6">
                        {['#', 'Change', 'Slug', 'Stage', 'Commits', '+Lines', '-Lines', 'Files', 'Tool Calls', 'Age'].map((h) => (
                          <th key={h} className="text-left px-3 py-2 text-slate-500 uppercase tracking-wider font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((s, i) => {
                        const card = cards.find((c) => c.slug === s.slug && c.name === s.changeName)
                        const stageColor = card ? STAGE_COLORS[card.stage] : '#475569'
                        const hasCommits = s.commits > 0
                        return (
                          <tr
                            key={`${s.slug}::${s.changeName}`}
                            className="border-b border-white/4 hover:bg-white/3 cursor-pointer transition-colors"
                            onClick={() => { if (card) setSelectedCard(card) }}
                          >
                            <td className="px-3 py-2 text-slate-600">{i + 1}</td>
                            <td className="px-3 py-2 text-slate-200 font-semibold">{s.changeName}</td>
                            <td className="px-3 py-2 text-slate-500">{s.slug}</td>
                            <td className="px-3 py-2">
                              <span className="px-1.5 py-0.5 rounded text-[0.55rem] uppercase" style={{ color: stageColor, background: `${stageColor}18` }}>
                                {card?.stage ?? '—'}
                              </span>
                            </td>
                            <td className="px-3 py-2" style={{ color: '#4ADE80' }}>{hasCommits ? s.commits : '—'}</td>
                            <td className="px-3 py-2" style={{ color: '#34D399' }}>{hasCommits ? `+${s.linesAdded}` : '—'}</td>
                            <td className="px-3 py-2" style={{ color: '#F87171' }}>{hasCommits ? `-${s.linesDeleted}` : '—'}</td>
                            <td className="px-3 py-2" style={{ color: '#60A5FA' }}>{s.filesChanged}</td>
                            <td className="px-3 py-2" style={{ color: '#A78BFA' }}>{s.toolCalls}</td>
                            <td className="px-3 py-2 text-slate-600">{s.durationDays}d</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    {filtered.length > 0 && (
                      <tfoot>
                        <tr className="border-t border-white/10" style={{ background: 'rgba(167,139,250,0.04)' }}>
                          <td className="px-3 py-2 text-slate-600 font-semibold" colSpan={4}>Fleet Total</td>
                          <td className="px-3 py-2 font-semibold" style={{ color: '#4ADE80' }}>{totals.commits}</td>
                          <td className="px-3 py-2 font-semibold" style={{ color: '#34D399' }}>+{totals.linesAdded}</td>
                          <td className="px-3 py-2 font-semibold" style={{ color: '#F87171' }}>-{totals.linesDeleted}</td>
                          <td className="px-3 py-2 text-slate-500">—</td>
                          <td className="px-3 py-2 font-semibold" style={{ color: '#A78BFA' }}>{totals.toolCalls}</td>
                          <td className="px-3 py-2 text-slate-600">—</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )
            })()}
          </div>
        )}
      </main>

      <AnimatePresence>
        {selectedCard && (
          <DetailDrawer card={selectedCard} onClose={() => setSelectedCard(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

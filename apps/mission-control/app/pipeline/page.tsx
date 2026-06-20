'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import GlassCard from '../../components/ui/GlassCard'
import type { PipelineCard, PipelineStage } from '../api/pipeline/route'

const STAGES: PipelineStage[] = ['propose', 'plan', 'build', 'verify', 'pr']

const STAGE_LABELS: Record<PipelineStage, string> = {
  propose: 'Propose',
  plan: 'Plan',
  build: 'Build',
  verify: 'Verify',
  pr: 'PR',
}

const STAGE_COLORS: Record<PipelineStage, string> = {
  propose: '#A78BFA',
  plan: '#60A5FA',
  build: '#F59E0B',
  verify: '#34D399',
  pr: '#4ADE80',
}

const STAGE_ICONS: Record<PipelineStage, string> = {
  propose: '📝',
  plan: '📋',
  build: '🔨',
  verify: '🔍',
  pr: '🔀',
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

function DetailDrawer({ card, onClose }: DrawerProps) {
  const color = STAGE_COLORS[card.stage]

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

          <div className="text-[0.6rem] text-slate-600 font-mono">
            {card.daysInStage === 0 ? 'In stage today' : `${card.daysInStage}d in ${STAGE_LABELS[card.stage]}`}
          </div>
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

  async function fetchCards() {
    try {
      const res = await fetch('/api/pipeline')
      if (res.ok) {
        setCards(await res.json())
        setLastRefresh(Date.now())
      }
    } catch {}
    setLoading(false)
  }

  useEffect(() => {
    fetchCards()
    const id = setInterval(fetchCards, 60_000)
    return () => clearInterval(id)
  }, [])

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
      </main>

      <AnimatePresence>
        {selectedCard && (
          <DetailDrawer card={selectedCard} onClose={() => setSelectedCard(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

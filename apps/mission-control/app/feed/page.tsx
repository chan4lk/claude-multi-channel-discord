'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import SubPageHeader from '../../components/SubPageHeader'
import FreshnessBadge from '../../components/FreshnessBadge'
import InjectTerminal from '../../components/InjectTerminal'
import type { FleetProject, ProjectState } from '../api/fleet/route'
import type { PipelineStage } from '../api/pipeline/route'
import type { BranchInfo } from '../api/branches/route'

// ─── Types ──────────────────────────────────────────────────────────────────

interface PipelineEntry {
  slug: string
  stage: PipelineStage
}

interface ProjectCard {
  slug: string
  platform: string
  state: ProjectState
  ageMins: number
  goalText: string
  goalStatus: string
  pipelineStage: PipelineStage | null
  memoryKB: number | null
  branch: string | null
  transcriptSnippet: string | null
}

// ─── Config ─────────────────────────────────────────────────────────────────

const STATE_COLOR: Record<ProjectState, string> = {
  active: '#4ADE80',
  idle: '#22D3EE',
  stalled: '#EF4444',
  autonomous: '#A78BFA',
}

const STAGE_COLOR: Record<PipelineStage, string> = {
  propose:   '#F59E0B',
  plan:      '#22D3EE',
  build:     '#A78BFA',
  verify:    '#FB923C',
  pr:        '#4ADE80',
  completed: '#22D3EE',
}

const PLATFORM_ICON: Record<string, string> = {
  discord:  'D',
  whatsapp: 'W',
  teams:    'T',
}

type StateFilter = 'all' | ProjectState

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAge(ageMins: number): string {
  if (ageMins < 1) return 'just now'
  if (ageMins < 60) return `${ageMins}m ago`
  if (ageMins < 1440) return `${Math.floor(ageMins / 60)}h ago`
  return `${Math.floor(ageMins / 1440)}d ago`
}

// ─── Card component ──────────────────────────────────────────────────────────

function ProjectCardItem({
  card,
  onInject,
  onStop,
}: {
  card: ProjectCard
  onInject: (slug: string) => void
  onStop: (slug: string) => void
}) {
  const color = STATE_COLOR[card.state]
  const platform = card.platform || 'discord'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      layout
      className="rounded-xl border overflow-hidden"
      style={{
        borderColor: color + '22',
        background: 'linear-gradient(135deg, rgba(10,20,40,0.9) 0%, rgba(5,12,25,0.95) 100%)',
      }}
    >
      <div className="flex gap-3 p-3 min-h-0" style={{ minHeight: 120 }}>
        {/* State indicator bar */}
        <div
          className="w-1 rounded-full shrink-0 self-stretch"
          style={{ background: color, boxShadow: `0 0 8px ${color}80` }}
        />

        {/* Main content */}
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          {/* Row 1: slug + platform + state + branch */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="font-mono font-bold text-sm tracking-wider"
              style={{ color }}
            >
              {card.slug}
            </span>
            <span
              className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded border font-semibold uppercase"
              style={{ color: '#64748b', borderColor: '#334155', background: '#0f172a' }}
            >
              {PLATFORM_ICON[platform] ?? platform.slice(0, 1).toUpperCase()}
            </span>
            <span
              className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded capitalize"
              style={{ color, background: color + '18', border: `1px solid ${color}30` }}
            >
              {card.state}
            </span>
            {card.branch && (
              <span className="text-[0.6rem] font-mono text-slate-500 truncate max-w-[140px]" title={card.branch}>
                ⑂ {card.branch}
              </span>
            )}
            <span className="ml-auto text-[0.6rem] font-mono text-slate-600 shrink-0">
              {formatAge(card.ageMins)}
            </span>
          </div>

          {/* Row 2: goal snippet */}
          {card.goalText && (
            <p className="text-[0.7rem] text-slate-300 leading-relaxed truncate" title={card.goalText}>
              {card.goalText.slice(0, 100)}
            </p>
          )}

          {/* Row 3: pipeline stage + memory + transcript snippet */}
          <div className="flex items-center gap-3 flex-wrap">
            {card.pipelineStage && (
              <span
                className="text-[0.6rem] font-mono px-1.5 py-0.5 rounded uppercase font-semibold"
                style={{
                  color: STAGE_COLOR[card.pipelineStage],
                  background: STAGE_COLOR[card.pipelineStage] + '18',
                  border: `1px solid ${STAGE_COLOR[card.pipelineStage]}30`,
                }}
              >
                {card.pipelineStage}
              </span>
            )}
            {card.memoryKB !== null && (
              <span className="text-[0.6rem] font-mono text-slate-500">
                ✦ {card.memoryKB.toFixed(1)} KB
              </span>
            )}
            {card.transcriptSnippet && (
              <span className="text-[0.6rem] font-mono text-slate-600 truncate max-w-xs" title={card.transcriptSnippet}>
                ▷ {card.transcriptSnippet}
              </span>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex flex-col gap-1.5 shrink-0 justify-start pt-0.5">
          <button
            onClick={() => onInject(card.slug)}
            className="text-[0.6rem] font-mono px-2 py-1 rounded border transition-colors"
            style={{ color: '#22D3EE', borderColor: '#22D3EE30', background: '#22D3EE08' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#22D3EE18' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#22D3EE08' }}
          >
            Inject
          </button>
          <a
            href={`/graph?highlight=${card.slug}`}
            className="text-[0.6rem] font-mono px-2 py-1 rounded border transition-colors text-center"
            style={{ color: '#A78BFA', borderColor: '#A78BFA30', background: '#A78BFA08' }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#A78BFA18' }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#A78BFA08' }}
          >
            Graph
          </a>
          <button
            onClick={() => onStop(card.slug)}
            className="text-[0.6rem] font-mono px-2 py-1 rounded border transition-colors"
            style={{ color: '#EF4444', borderColor: '#EF444430', background: '#EF444408' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#EF444418' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#EF444408' }}
          >
            Stop
          </button>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FeedPage() {
  const [cards, setCards] = useState<ProjectCard[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [injectSlug, setInjectSlug] = useState<string | null>(null)
  const [stopSlug, setStopSlug] = useState<string | null>(null)
  const [stopPending, setStopPending] = useState(false)
  const [lastUpdated, setLastUpdated] = useState('')
  const [freshAt, setFreshAt] = useState<number | null>(null)
  const [freshError, setFreshError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const loadData = useCallback(async () => {
    try {
      const [fleetRes, pipelineRes, branchesRes] = await Promise.all([
        fetch('/api/fleet'),
        fetch('/api/pipeline'),
        fetch('/api/branches'),
      ])

      const fleet = fleetRes.ok ? (await fleetRes.json() as { projects: FleetProject[] }) : { projects: [] }
      const pipeline = pipelineRes.ok ? (await pipelineRes.json() as { cards: Array<{ slug: string; stage: PipelineStage }> }) : { cards: [] }
      const branches = branchesRes.ok ? (await branchesRes.json() as { branches: BranchInfo[] }) : { branches: [] }

      const pipelineMap = new Map<string, PipelineStage>()
      for (const c of pipeline.cards) pipelineMap.set(c.slug, c.stage)

      const branchMap = new Map<string, string | null>()
      for (const b of branches.branches) branchMap.set(b.slug, b.currentBranch)

      const merged: ProjectCard[] = fleet.projects
        .sort((a, b) => a.ageMins - b.ageMins)
        .map(proj => ({
          slug: proj.slug,
          platform: proj.platform ?? 'discord',
          state: proj.state,
          ageMins: proj.ageMins,
          goalText: proj.goalText ?? '',
          goalStatus: proj.goalStatus ?? 'active',
          pipelineStage: pipelineMap.get(proj.slug) ?? null,
          memoryKB: proj.memoryStatus ? proj.memoryStatus.sizeBytes / 1024 : null,
          branch: branchMap.get(proj.slug) ?? null,
          transcriptSnippet: null,
        }))

      setCards(merged)
      setLastUpdated(new Date().toLocaleTimeString())
      setFreshAt(Date.now())
      setFreshError(null)
    } catch (err) {
      setFreshError(err instanceof Error ? err.message : 'fetch failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
    const id = setInterval(() => void loadData(), 30000)
    return () => clearInterval(id)
  }, [loadData])

  // Keyboard shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const filtered = cards.filter(c => {
    if (stateFilter !== 'all' && c.state !== stateFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return c.slug.toLowerCase().includes(q) || c.goalText.toLowerCase().includes(q)
    }
    return true
  })

  async function handleStop(slug: string) {
    setStopSlug(slug)
  }

  async function confirmStop() {
    if (!stopSlug) return
    setStopPending(true)
    try {
      await fetch(`/api/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: stopSlug, message: '!project stop' }),
      })
    } finally {
      setStopPending(false)
      setStopSlug(null)
    }
  }

  const STATE_FILTERS: { label: string; value: StateFilter; color: string }[] = [
    { label: 'All', value: 'all', color: '#94a3b8' },
    { label: 'Idle', value: 'idle', color: '#22D3EE' },
    { label: 'Active', value: 'active', color: '#4ADE80' },
    { label: 'Stalled', value: 'stalled', color: '#EF4444' },
    { label: 'Auto', value: 'autonomous', color: '#A78BFA' },
  ]

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#020811' }}>
      <SubPageHeader title="PROJECT FEED">
        <span className="text-[0.55rem] font-mono text-slate-600">
          {loading ? 'loading...' : `${cards.length} projects · ${lastUpdated}`}
        </span>
        <FreshnessBadge
          isStale={freshAt !== null && Date.now() - freshAt > 30_000 * 2.5}
          lastError={freshError}
          lastSuccessAt={freshAt}
        />
      </SubPageHeader>

      {/* Search + filter bar */}
      <div className="sticky top-0 z-10 border-b border-cyber-cyan/8 px-4 sm:px-6 py-2 flex items-center gap-3 flex-wrap"
        style={{ background: 'rgba(2,8,17,0.97)', backdropFilter: 'blur(8px)' }}
      >
        {/* Search */}
        <div className="flex items-center gap-1.5 border border-cyber-cyan/15 rounded px-2 py-1 flex-1 min-w-[160px] max-w-xs">
          <span className="text-slate-600 text-xs">⌕</span>
          <input
            ref={searchRef}
            type="text"
            placeholder="Search slug or goal…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-[0.7rem] font-mono text-slate-300 placeholder-slate-600 outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-slate-600 hover:text-slate-400 text-xs">✕</button>
          )}
        </div>
        <span className="text-[0.5rem] font-mono text-slate-700 hidden sm:block">/</span>

        {/* State filter */}
        <div className="flex items-center gap-1">
          {STATE_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStateFilter(f.value)}
              className="text-[0.6rem] font-mono px-2 py-1 rounded transition-colors"
              style={{
                color: stateFilter === f.value ? f.color : '#475569',
                background: stateFilter === f.value ? f.color + '18' : 'transparent',
                border: `1px solid ${stateFilter === f.value ? f.color + '40' : 'transparent'}`,
              }}
            >
              {f.label}
              {f.value !== 'all' && (
                <span className="ml-1 text-[0.5rem] opacity-60">
                  {cards.filter(c => c.state === f.value).length}
                </span>
              )}
            </button>
          ))}
        </div>

        <span className="text-[0.55rem] font-mono text-slate-700 ml-auto">
          {filtered.length}/{cards.length}
        </span>
      </div>

      {/* Feed */}
      <main className="flex-1 px-4 sm:px-6 py-4 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-cyber-cyan/40 font-mono text-sm animate-pulse">Loading feed...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-slate-600 font-mono text-sm">
              {search || stateFilter !== 'all' ? 'No projects match filter' : 'No projects found'}
            </span>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            <div className="grid gap-3 max-w-4xl mx-auto">
              {filtered.map(card => (
                <ProjectCardItem
                  key={card.slug}
                  card={card}
                  onInject={setInjectSlug}
                  onStop={handleStop}
                />
              ))}
            </div>
          </AnimatePresence>
        )}
      </main>

      {/* Inject terminal modal */}
      {injectSlug && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setInjectSlug(null) }}
        >
          <div className="w-full max-w-xl">
            <InjectTerminal initialSlug={injectSlug} onClose={() => setInjectSlug(null)} />
          </div>
        </div>
      )}

      {/* Stop confirmation */}
      {stopSlug && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setStopSlug(null) }}
        >
          <div
            className="rounded-xl border p-6 max-w-sm w-full font-mono"
            style={{ background: '#070f1e', borderColor: '#EF444430' }}
          >
            <p className="text-slate-300 text-sm mb-1">Stop project?</p>
            <p className="text-white font-bold mb-4">{stopSlug}</p>
            <p className="text-slate-500 text-xs mb-6">
              Sends <code className="text-slate-400">!project stop</code> to the master channel.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setStopSlug(null)}
                className="text-xs px-3 py-1.5 rounded border border-white/10 text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmStop()}
                disabled={stopPending}
                className="text-xs px-3 py-1.5 rounded border text-red-400 border-red-400/30 hover:bg-red-400/10 disabled:opacity-50"
              >
                {stopPending ? 'Stopping...' : 'Stop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

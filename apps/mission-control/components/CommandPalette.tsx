'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { FleetResponse, ProjectState } from '../app/api/fleet/route'
import type { BacklogResponse } from '../app/api/backlog/route'

export interface InjectRequest {
  slug: string
}

interface MemoryRow { id: number; channel_slug: string; type: string; content: string }
interface GoalRow { slug: string; goalText: string; status: string }

type CmdCategory = 'navigate' | 'project' | 'memory' | 'proposal' | 'goal'

const CATEGORY_LABELS: Record<CmdCategory, string> = {
  navigate: 'Navigate',
  project: 'Projects',
  memory: 'Memories',
  proposal: 'Proposals',
  goal: 'Goals',
}

const CATEGORY_ORDER: CmdCategory[] = ['navigate', 'project', 'proposal', 'memory', 'goal']

const STATE_COLORS: Record<ProjectState, string> = {
  idle: '#00F5FF',
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
}

const RECENT_KEY = 'mc_cmd_recent'
const MAX_RECENT = 5

interface Command {
  id: string
  label: string
  description: string
  icon: string
  category: CmdCategory
  badge?: { text: string; color: string }
  action: () => void
}

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveRecent(id: string) {
  try {
    const prev = loadRecent().filter((x) => x !== id)
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...prev].slice(0, MAX_RECENT)))
  } catch {}
}

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

function formatAge(ageMins: number): string {
  if (ageMins >= 9999) return '—'
  if (ageMins < 60) return `${ageMins}m`
  if (ageMins < 1440) return `${Math.floor(ageMins / 60)}h`
  return `${Math.floor(ageMins / 1440)}d`
}

interface Props {
  onInject?: (req: InjectRequest) => void
}

export default function CommandPalette({ onInject }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [fleet, setFleet] = useState<FleetResponse | null>(null)
  const [memories, setMemories] = useState<MemoryRow[]>([])
  const [backlog, setBacklog] = useState<BacklogResponse | null>(null)
  const [goals, setGoals] = useState<GoalRow[]>([])
  const [recent, setRecent] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const closeWithEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setRecent(loadRecent())
      inputRef.current?.focus()
      window.addEventListener('keydown', closeWithEsc)
      if (!fleet) {
        fetch('/api/fleet').then((r) => r.json()).then((d) => setFleet(d)).catch(() => {})
        fetch('/api/memories?limit=200').then((r) => r.json()).then((d) => setMemories(Array.isArray(d) ? d : [])).catch(() => {})
        fetch('/api/backlog').then((r) => r.json()).then((d) => setBacklog(d)).catch(() => {})
        fetch('/api/goals').then((r) => r.json()).then((d) => setGoals(Array.isArray(d?.goals) ? d.goals : [])).catch(() => {})
      }
    } else {
      window.removeEventListener('keydown', closeWithEsc)
    }
    return () => window.removeEventListener('keydown', closeWithEsc)
  }, [open, closeWithEsc, fleet])

  function execute(cmd: Command) {
    saveRecent(cmd.id)
    setOpen(false)
    cmd.action()
  }

  function buildCommands(): Command[] {
    const navigate: Command[] = [
      {
        id: 'nav:dashboard',
        label: 'Go to Dashboard',
        description: 'Main observability view',
        icon: '⌂',
        category: 'navigate',
        action: () => router.push('/'),
      },
      {
        id: 'nav:graph',
        label: 'Go to Graph',
        description: 'Force-directed project graph',
        icon: '⬡',
        category: 'navigate',
        action: () => router.push('/graph'),
      },
      {
        id: 'nav:timeline',
        label: 'Go to Timeline',
        description: 'Cross-channel activity timeline',
        icon: '◫',
        category: 'navigate',
        action: () => router.push('/timeline'),
      },
      {
        id: 'nav:memory-graph',
        label: 'Go to Memory Constellation',
        description: 'Memory graph visualization',
        icon: '✦',
        category: 'navigate',
        action: () => router.push('/memory-graph'),
      },
      {
        id: 'nav:metrics',
        label: 'Go to Metrics',
        description: 'Per-agent token usage, cost, and latency',
        icon: '◈',
        category: 'navigate',
        action: () => router.push('/metrics'),
      },
      {
        id: 'nav:pipeline',
        label: 'Go to Pipeline',
        description: 'Specclaw kanban board — all changes across projects',
        icon: '⬒',
        category: 'navigate',
        action: () => router.push('/pipeline'),
      },
      {
        id: 'nav:search',
        label: 'Go to Search',
        description: 'Full-text search across memories and transcripts',
        icon: '⌕',
        category: 'navigate',
        action: () => router.push('/search'),
      },
      {
        id: 'nav:branches',
        label: 'Go to Branch Dashboard',
        description: 'Git branch state — ahead/behind/diverged across all projects',
        icon: '⎇',
        category: 'navigate',
        action: () => router.push('/branches'),
      },
      {
        id: 'nav:broadcast',
        label: 'Broadcast…',
        description: 'Send a message to multiple projects at once',
        icon: '⊕',
        category: 'navigate',
        action: () => router.push('/broadcast'),
      },
      {
        id: 'nav:audit',
        label: 'Go to Audit Log',
        description: 'Tamper-evident log of commands, spawns, and config changes',
        icon: '⧇',
        category: 'navigate',
        action: () => router.push('/admin/audit'),
      },
      {
        id: 'nav:goals',
        label: 'Goals board',
        description: 'Cross-project goal kanban',
        icon: '◎',
        category: 'navigate',
        action: () => router.push('/goals'),
      },
      {
        id: 'nav:knowledge',
        label: 'Knowledge graph',
        description: 'Unified view of projects, memories, and goals',
        icon: '⬡',
        category: 'navigate',
        action: () => router.push('/knowledge'),
      },
      {
        id: 'nav:advisor',
        label: 'Toggle Fleet Advisor',
        description: 'Open the proactive fleet intelligence panel (A)',
        icon: '⚡',
        category: 'navigate',
        action: () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
        },
      },
      {
        id: 'nav:reports',
        label: 'Go to Weekly Report',
        description: 'Autonomous fleet performance digest',
        icon: '◉',
        category: 'navigate',
        action: () => router.push('/reports'),
      },
    ]

    const projects: Command[] = (fleet?.projects ?? []).flatMap((p) => [
      {
        id: `project:transcript:${p.slug}`,
        label: `Transcript: ${p.slug}`,
        description: `Live transcript — ${formatAge(p.ageMins)} ago`,
        icon: '▶',
        category: 'project' as const,
        badge: { text: p.state, color: STATE_COLORS[p.state] },
        action: () => router.push(`/?transcript=${p.slug}`),
      },
      {
        id: `project:filter:${p.slug}`,
        label: `Filter by: ${p.slug}`,
        description: `Show only ${p.slug} in Instance Grid`,
        icon: '⊞',
        category: 'project' as const,
        badge: { text: p.state, color: STATE_COLORS[p.state] },
        action: () => router.push(`/?filter=${p.slug}`),
      },
      {
        id: `project:inject:${p.slug}`,
        label: `Inject into: ${p.slug}`,
        description: 'Open inject terminal for this project',
        icon: '⟳',
        category: 'project' as const,
        badge: { text: p.state, color: STATE_COLORS[p.state] },
        action: () => {
          if (onInject) {
            onInject({ slug: p.slug })
          } else {
            navigator.clipboard.writeText(`!project inject ${p.slug} `).catch(() => {})
          }
        },
      },
    ])

    const proposals: Command[] = (backlog?.projects ?? []).flatMap((p) =>
      p.items.map((item, idx) => ({
        id: `proposal:${p.slug}:${idx}`,
        label: item.title,
        description: `Proposal in ${p.slug}`,
        icon: '⟿',
        category: 'proposal' as const,
        badge: item.status === 'done'
          ? { text: 'done', color: '#4ADE80' }
          : item.status === 'pending'
            ? { text: 'pending', color: '#F59E0B' }
            : undefined,
        action: () => router.push(`/backlog?slug=${encodeURIComponent(p.slug)}`),
      }))
    )

    const memoryCmds: Command[] = memories.map((m) => {
      const text = (m.content ?? '').replace(/\s+/g, ' ').trim()
      return {
        id: `memory:${m.id}`,
        label: text.length > 60 ? text.slice(0, 60) + '…' : (text || `memory #${m.id}`),
        description: `${m.type} memory · ${m.channel_slug}`,
        icon: '✦',
        category: 'memory' as const,
        action: () => router.push(`/knowledge?slug=${encodeURIComponent(m.channel_slug)}`),
      }
    })

    const goalCmds: Command[] = goals.map((g) => {
      const text = (g.goalText ?? '').replace(/\s+/g, ' ').trim()
      return {
        id: `goal:${g.slug}`,
        label: text.length > 60 ? text.slice(0, 60) + '…' : (text || `${g.slug} goal`),
        description: `Goal · ${g.slug}`,
        icon: '◎',
        category: 'goal' as const,
        badge: { text: g.status, color: g.status === 'completed' ? '#4ADE80' : g.status === 'paused' ? '#94A3B8' : '#00F5FF' },
        action: () => router.push(`/goals?slug=${encodeURIComponent(g.slug)}`),
      }
    })

    return [...navigate, ...projects, ...proposals, ...memoryCmds, ...goalCmds]
  }

  const allCommands = buildCommands()

  const filtered = query
    ? allCommands
        .filter((c) => fuzzyMatch(query, c.label) || fuzzyMatch(query, c.description))
        .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
        .slice(0, 60)
    : recent.length > 0
      ? recent
          .map((id) => allCommands.find((c) => c.id === id))
          .filter(Boolean) as Command[]
      : allCommands.slice(0, 6)

  useEffect(() => setSelected(0), [query])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      const cmd = filtered[selected]
      if (cmd) execute(cmd)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-cyber-cyan/20 overflow-hidden shadow-2xl"
        style={{
          background: '#0D1421',
          boxShadow: '0 0 40px rgba(0,245,255,0.12), 0 25px 50px rgba(0,0,0,0.6)',
        }}
      >
        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
          <span className="text-slate-500 text-sm">⌘</span>
          <input
            ref={inputRef}
            type="text"
            placeholder={recent.length > 0 && !query ? 'Recent commands…' : 'Search projects, proposals, memories, goals…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 focus:outline-none font-mono"
          />
          <kbd className="text-[0.6rem] text-slate-600 border border-slate-700 rounded px-1 py-0.5 font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-600 font-mono">No results for &ldquo;{query}&rdquo;</div>
          ) : (
            filtered.map((cmd, i) => (
              <div key={cmd.id}>
              {query && (i === 0 || filtered[i - 1].category !== cmd.category) && (
                <div className="px-4 pt-2 pb-1 text-[0.55rem] font-mono uppercase tracking-widest text-slate-600">
                  {CATEGORY_LABELS[cmd.category]}
                </div>
              )}
              <button
                onClick={() => execute(cmd)}
                onMouseEnter={() => setSelected(i)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                style={{ background: i === selected ? 'rgba(0,245,255,0.06)' : 'transparent' }}
              >
                <span className="text-base w-5 text-center shrink-0" style={{ opacity: 0.7 }}>{cmd.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-200 font-mono truncate">{cmd.label}</span>
                    {cmd.badge && (
                      <span
                        className="text-[0.55rem] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                        style={{
                          color: cmd.badge.color,
                          border: `1px solid ${cmd.badge.color}40`,
                          background: `${cmd.badge.color}12`,
                        }}
                      >
                        {cmd.badge.text}
                      </span>
                    )}
                  </div>
                  <p className="text-[0.65rem] text-slate-500 truncate">{cmd.description}</p>
                </div>
                {i === selected && (
                  <kbd className="text-[0.6rem] text-slate-600 border border-slate-700 rounded px-1 py-0.5 font-mono shrink-0">↵</kbd>
                )}
              </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-white/5 text-[0.58rem] text-slate-700 font-mono">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>ESC close</span>
          <span className="flex-1" />
          {!query && recent.length > 0 && <span>recent</span>}
          {fleet && <span>{fleet.projects.length} projects</span>}
        </div>
      </div>
    </div>
  )
}

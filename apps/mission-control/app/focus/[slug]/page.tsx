'use client'

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import HealthScoreRing from '../../../components/HealthScoreRing'
import { useFleet } from '../../../components/FleetContext'
import type { TranscriptResponse } from '../../api/transcript/[slug]/route'
import type { AuditResponse } from '../../api/audit/route'
import type { HealthScore } from '../../api/health/[slug]/route'
import type { FleetProject } from '../../api/fleet/route'

interface DiffResponse {
  slug: string
  log: string
  diff: string
  error?: string
}

const STATE_COLORS: Record<string, string> = {
  idle: '#00F5FF',
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
}

function Panel({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div
      className="rounded-lg border p-3 flex flex-col min-h-0"
      style={{ borderColor: `${accent ?? '#00F5FF'}22`, background: '#080f1c' }}
    >
      <div className="text-[0.55rem] font-mono uppercase tracking-wider text-slate-500 mb-2 shrink-0">{title}</div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

export default function FocusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router = useRouter()
  const { fleet, toolEvents } = useFleet()

  const project = fleet?.projects.find((p) => p.slug === slug)
  // 404 only once the fleet has loaded and the slug is genuinely absent.
  const notFound = fleet != null && !project

  // Event-driven refetch key: bumps when a tool-event arrives for this slug
  // (no interval polling, per the proposal).
  const eventTick = useMemo(
    () => toolEvents.filter((e) => e.slug === slug).length,
    [toolEvents, slug],
  )

  // ── Document title (AC6) + Esc to go back (AC5) ──────────────────────────
  useEffect(() => {
    document.title = `Focus: ${slug}`
    function onKey(e: KeyboardEvent) {
      if (
        e.key === 'Escape' &&
        !(document.activeElement instanceof HTMLTextAreaElement) &&
        !(document.activeElement instanceof HTMLInputElement)
      ) {
        router.push('/')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slug, router])

  if (notFound) {
    return (
      <div className="min-h-screen bg-[#030712] text-slate-400 flex flex-col items-center justify-center gap-3 font-mono">
        <span className="text-3xl">∅</span>
        <span className="text-sm">No project <span className="text-cyber-cyan">{slug}</span> in channels.json</span>
        <button onClick={() => router.push('/')} className="text-[0.65rem] text-slate-500 hover:text-cyber-cyan">← back to dashboard</button>
      </div>
    )
  }

  const stateColor = STATE_COLORS[project?.state ?? 'idle'] ?? '#00F5FF'

  return (
    <div className="h-screen bg-[#030712] text-slate-300 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-cyber-cyan/12 shrink-0">
        <button onClick={() => router.push('/')} className="text-slate-500 hover:text-cyber-cyan text-sm" title="Back (Esc)">←</button>
        <h1 className="text-base font-black tracking-widest text-cyber-cyan font-mono">{slug}</h1>
        {project && (
          <span
            className="text-[0.6rem] font-mono font-bold uppercase px-2 py-0.5 rounded border"
            style={{ color: stateColor, borderColor: `${stateColor}40`, background: `${stateColor}12` }}
          >
            {project.state}
          </span>
        )}
        <span className="ml-auto text-[0.55rem] text-slate-600 font-mono">Focus Mode · Esc to exit</span>
      </header>

      {/* 3-column grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-3 p-3 min-h-0">
        <LeftColumn slug={slug} project={project} eventTick={eventTick} />
        <CenterColumn slug={slug} eventTick={eventTick} />
        <RightColumn slug={slug} project={project} eventTick={eventTick} />
      </div>
    </div>
  )
}

// ── Left: goal + health ring + watchdog ─────────────────────────────────────
function LeftColumn({
  slug,
  project,
  eventTick,
}: {
  slug: string
  project: FleetProject | undefined
  eventTick: number
}) {
  const [goal, setGoal] = useState('')
  const [goalStatus, setGoalStatus] = useState<'active' | 'paused' | 'completed'>('active')
  const [saving, setSaving] = useState(false)
  const [health, setHealth] = useState<HealthScore | null>(null)

  useEffect(() => {
    fetch(`/api/projects/${slug}/goal`)
      .then((r) => r.json())
      .then((d: { goalText: string | null; goalStatus: string | null }) => {
        setGoal(d.goalText ?? '')
        if (d.goalStatus === 'paused' || d.goalStatus === 'completed') setGoalStatus(d.goalStatus)
        else setGoalStatus('active')
      })
      .catch(() => {})
  }, [slug])

  useEffect(() => {
    fetch(`/api/health/${slug}`)
      .then((r) => r.json())
      .then((d: HealthScore) => setHealth(d))
      .catch(() => {})
  }, [slug, eventTick])

  async function saveGoal() {
    setSaving(true)
    try {
      await fetch(`/api/projects/${slug}/goal`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: goal, status: goalStatus }),
      })
    } catch {
      /* ignore */
    } finally {
      setTimeout(() => setSaving(false), 800)
    }
  }

  const threshold = project?.stuckThresholdMinutes ?? 5
  const ageMins = project?.ageMins ?? 0
  const remaining = Math.max(0, threshold - ageMins)
  const watchdogColor = remaining <= 0 ? '#EF4444' : remaining <= threshold * 0.3 ? '#F59E0B' : '#4ADE80'

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <Panel title="Signals">
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-1">
            {health ? (
              <HealthScoreRing
                score={health.score}
                insufficientData={health.insufficientData}
                recency={health.recency}
                stallRate={health.stallRate}
                efficiency={health.efficiency}
                freshness={health.freshness}
                size={56}
              />
            ) : (
              <div className="w-14 h-14 rounded-full border border-slate-700 animate-pulse" />
            )}
            <span className="text-[0.5rem] text-slate-600 uppercase">Health</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[0.55rem] text-slate-500 uppercase">Watchdog</span>
            <span className="text-lg font-mono font-bold" style={{ color: watchdogColor }}>
              {remaining > 0 ? `${remaining}m` : 'DUE'}
            </span>
            <span className="text-[0.5rem] text-slate-600">silent {ageMins}m / {threshold}m</span>
          </div>
        </div>
      </Panel>

      <Panel title="Goal (GOAL.md)">
        <div className="flex flex-col gap-2 h-full">
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="No goal set. Describe what this agent is working toward…"
            className="flex-1 min-h-[160px] bg-[#060d1a] border border-cyber-cyan/15 rounded p-2 text-[0.7rem] text-slate-200 font-mono resize-none focus:outline-none focus:border-cyber-cyan/40 placeholder-slate-700"
          />
          <div className="flex items-center gap-2">
            <select
              value={goalStatus}
              onChange={(e) => setGoalStatus(e.target.value as 'active' | 'paused' | 'completed')}
              className="bg-[#060d1a] border border-cyber-cyan/15 rounded px-1.5 py-1 text-[0.6rem] text-slate-300 font-mono focus:outline-none"
            >
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="completed">completed</option>
            </select>
            <button
              onClick={saveGoal}
              disabled={saving}
              className="ml-auto text-[0.6rem] px-3 py-1 rounded border border-cyber-cyan/30 text-cyber-cyan hover:bg-cyber-cyan/10 transition-colors disabled:opacity-40"
            >
              {saving ? 'Saved ✓' : 'Save'}
            </button>
          </div>
        </div>
      </Panel>
    </div>
  )
}

// ── Center: transcript tail + inject ────────────────────────────────────────
function CenterColumn({ slug, eventTick }: { slug: string; eventTick: number }) {
  const [entries, setEntries] = useState<TranscriptResponse['entries']>([])
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/transcript/${slug}?limit=20`)
      .then((r) => r.json())
      .then((d: TranscriptResponse) => setEntries(d.entries ?? []))
      .catch(() => {})
  }, [slug, eventTick])

  useEffect(() => {
    // Auto-scroll to newest.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [entries])

  async function send() {
    if (!message.trim()) return
    setStatus('sending')
    try {
      const res = await fetch('/api/inject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, message: message.trim() }),
      })
      if (res.ok) {
        setStatus('ok')
        setMessage('')
        setTimeout(() => setStatus('idle'), 2000)
      } else {
        setStatus('error')
        setTimeout(() => setStatus('idle'), 3000)
      }
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <Panel title="Transcript (live)" accent="#4ADE80">
        <div ref={scrollRef} className="h-full overflow-y-auto flex flex-col gap-1.5 pr-1">
          {entries.length === 0 ? (
            <span className="text-[0.65rem] text-slate-700 font-mono">No recent transcript.</span>
          ) : (
            entries.map((e, i) => <TranscriptLine key={i} entry={e} />)
          )}
        </div>
      </Panel>

      <Panel title="Inject" accent="#00F5FF">
        <div className="flex flex-col gap-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Inject a prompt into this session… (Ctrl+Enter)"
            rows={3}
            className="bg-[#060d1a] border border-cyber-cyan/15 rounded p-2 text-[0.7rem] text-slate-200 font-mono resize-none focus:outline-none focus:border-cyber-cyan/40 placeholder-slate-700"
          />
          <div className="flex items-center gap-2">
            <span className="text-[0.55rem] font-mono" style={{ color: status === 'error' ? '#EF4444' : status === 'ok' ? '#4ADE80' : '#64748b' }}>
              {status === 'ok' ? 'Injected ✓' : status === 'error' ? 'Failed' : 'Ctrl+Enter to send'}
            </span>
            <button
              onClick={send}
              disabled={!message.trim() || status === 'sending'}
              className="ml-auto text-[0.6rem] px-3 py-1 rounded border border-cyber-cyan/30 text-cyber-cyan hover:bg-cyber-cyan/10 transition-colors disabled:opacity-40"
            >
              {status === 'sending' ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </Panel>
    </div>
  )
}

function TranscriptLine({ entry }: { entry: TranscriptResponse['entries'][number] }) {
  if (entry.kind === 'tool_call') {
    return (
      <div className="text-[0.6rem] font-mono text-amber-400/80">
        <span className="text-amber-500">⚙ {entry.toolName}</span>{' '}
        <span className="text-slate-600">{entry.content}</span>
      </div>
    )
  }
  if (entry.kind === 'tool_result') {
    return <div className="text-[0.6rem] font-mono text-slate-600 pl-3">↳ {entry.content}</div>
  }
  return <div className="text-[0.68rem] font-mono text-slate-300 whitespace-pre-wrap leading-snug">{entry.content}</div>
}

// ── Right: git diff + memory + audit ────────────────────────────────────────
function RightColumn({
  slug,
  project,
  eventTick,
}: {
  slug: string
  project: FleetProject | undefined
  eventTick: number
}) {
  const [diff, setDiff] = useState<DiffResponse | null>(null)
  const [events, setEvents] = useState<AuditResponse['events']>([])
  const [distilling, setDistilling] = useState(false)

  useEffect(() => {
    fetch(`/api/diff/${slug}`).then((r) => r.json()).then((d: DiffResponse) => setDiff(d)).catch(() => {})
    fetch(`/api/audit?slug=${encodeURIComponent(slug)}&limit=10`)
      .then((r) => r.json())
      .then((d: AuditResponse) => setEvents(d.events ?? []))
      .catch(() => {})
  }, [slug, eventTick])

  async function distill() {
    setDistilling(true)
    try {
      await fetch(`/api/memory/${slug}/distill`, { method: 'POST' })
    } catch {
      /* ignore */
    } finally {
      setTimeout(() => setDistilling(false), 1500)
    }
  }

  const memKb = project?.memoryStatus ? Math.round(project.memoryStatus.sizeBytes / 1024) : null

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <Panel title="Recent commits" accent="#8B5CF6">
        <div className="h-full overflow-y-auto">
          {diff?.log ? (
            <pre className="text-[0.6rem] font-mono text-slate-400 whitespace-pre-wrap leading-relaxed">{diff.log}</pre>
          ) : (
            <span className="text-[0.6rem] text-slate-700 font-mono">{diff?.error ?? 'No git history.'}</span>
          )}
        </div>
      </Panel>

      <Panel title="Memory" accent="#F59E0B">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="text-[0.6rem] text-slate-500">MEMORY.md</span>
            <span className="text-sm font-mono font-bold text-amber-400">
              {memKb != null ? `${memKb} KB` : '—'}
            </span>
          </div>
          <button
            onClick={distill}
            disabled={distilling}
            className="ml-auto text-[0.6rem] px-2.5 py-1 rounded border border-amber-400/30 text-amber-400 hover:bg-amber-400/10 transition-colors disabled:opacity-40"
          >
            {distilling ? 'Distilling…' : 'Distill'}
          </button>
        </div>
      </Panel>

      <Panel title="Recent events">
        <div className="h-full overflow-y-auto flex flex-col gap-1">
          {events.length === 0 ? (
            <span className="text-[0.6rem] text-slate-700 font-mono">No recent events.</span>
          ) : (
            events.map((e) => (
              <div key={e.id} className="text-[0.58rem] font-mono flex gap-2">
                <span className="text-slate-600 shrink-0">{new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="text-cyber-cyan shrink-0">{e.alertType}</span>
                <span className="text-slate-500 truncate">{e.description}</span>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  )
}

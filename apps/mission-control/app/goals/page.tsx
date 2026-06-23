'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

type GoalStatus = 'active' | 'paused' | 'completed'

interface GoalCard {
  slug: string
  goalText: string
  status: GoalStatus
  lastModified: string | null
}

const STATUS_CONFIG: Record<GoalStatus, { label: string; color: string; bg: string; border: string; colBg: string }> = {
  active:    { label: 'Active',    color: '#A78BFA', bg: '#A78BFA18', border: '#A78BFA40', colBg: '#A78BFA08' },
  paused:    { label: 'Paused',    color: '#94a3b8', bg: '#64748b18', border: '#64748b40', colBg: '#64748b08' },
  completed: { label: 'Completed', color: '#4ADE80', bg: '#4ADE8018', border: '#4ADE8040', colBg: '#4ADE8008' },
}

const CYCLE: Record<GoalStatus, GoalStatus> = {
  active: 'paused',
  paused: 'completed',
  completed: 'active',
}

function ageLabel(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

interface EditState {
  slug: string
  text: string
  isNew: boolean
}

interface GoalCardProps {
  card: GoalCard
  cycling: string | null
  onCycle: (card: GoalCard) => void
  onEdit: (card: GoalCard) => void
  onDelete: (slug: string) => void
}

function GoalCardView({ card, cycling, onCycle, onEdit, onDelete }: GoalCardProps) {
  const cfg = STATUS_CONFIG[card.status]
  return (
    <div
      className="rounded-lg p-3"
      style={{ background: '#0a1628', border: `1px solid ${cfg.border}` }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-[0.6rem] font-mono font-bold px-1.5 py-0.5 rounded"
          style={{ background: '#00F5FF15', color: '#00F5FF', border: '1px solid #00F5FF30' }}
        >
          {card.slug}
        </span>
        {card.lastModified && (
          <span className="text-[0.6rem] font-mono text-slate-600 ml-auto">
            {ageLabel(card.lastModified)}
          </span>
        )}
      </div>

      <p className="text-xs font-mono text-slate-300 leading-relaxed mb-2 line-clamp-3">
        {card.goalText.slice(0, 120)}{card.goalText.length > 120 ? '…' : ''}
      </p>

      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={() => onCycle(card)}
          disabled={cycling === card.slug}
          className="text-[0.6rem] font-mono font-semibold px-2 py-0.5 rounded transition-opacity disabled:opacity-50 cursor-pointer hover:opacity-80"
          style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
          title={`Click to mark ${CYCLE[card.status]}`}
        >
          {cfg.label} →
        </button>
        <button
          onClick={() => onEdit(card)}
          className="text-[0.6rem] font-mono px-2 py-0.5 rounded hover:opacity-80"
          style={{ background: '#1E3A5F30', color: '#94A3B8', border: '1px solid #1E3A5F60' }}
          title="Edit goal text"
        >
          ✎ Edit
        </button>
        <button
          onClick={() => onDelete(card.slug)}
          className="text-[0.6rem] font-mono px-2 py-0.5 rounded hover:opacity-80"
          style={{ background: '#EF444415', color: '#EF4444', border: '1px solid #EF444430' }}
          title="Delete goal"
        >
          ✕
        </button>
        <Link
          href={`/projects/${card.slug}`}
          className="text-[0.6rem] font-mono text-slate-600 hover:text-cyber-cyan transition-colors ml-auto"
        >
          Timeline →
        </Link>
      </div>
    </div>
  )
}

interface EditModalProps {
  edit: EditState
  saving: boolean
  onChange: (text: string) => void
  onSave: () => void
  onCancel: () => void
}

function EditModal({ edit, saving, onChange, onSave, onCancel }: EditModalProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    taRef.current?.focus()
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(5,11,20,0.85)',
        zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div style={{
        background: '#0B1628', border: '1px solid #1E3A5F', borderRadius: 12,
        padding: 24, width: '100%', maxWidth: 540,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ color: '#00F5FF', fontFamily: 'Orbitron, monospace', fontSize: 13, fontWeight: 700 }}>
            {edit.isNew ? 'New Goal' : 'Edit Goal'}
          </span>
          <span style={{
            fontSize: 10, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 4,
            background: '#00F5FF15', color: '#00F5FF', border: '1px solid #00F5FF30',
          }}>{edit.slug}</span>
          <button
            onClick={onCancel}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#64748B', fontSize: 20, cursor: 'pointer' }}
          >×</button>
        </div>

        <textarea
          ref={taRef}
          value={edit.text}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Describe the project's goal…"
          rows={6}
          style={{
            width: '100%', background: '#080F1E', border: '1px solid #1E3A5F',
            borderRadius: 6, padding: '10px 12px', color: '#E2E8F0',
            fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6,
            resize: 'vertical', outline: 'none', boxSizing: 'border-box',
          }}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '6px 16px', borderRadius: 6, fontFamily: 'monospace', fontSize: 12,
              background: 'transparent', border: '1px solid #1E3A5F', color: '#94A3B8', cursor: 'pointer',
            }}
          >Cancel</button>
          <button
            onClick={onSave}
            disabled={saving || !edit.text.trim()}
            style={{
              padding: '6px 16px', borderRadius: 6, fontFamily: 'monospace', fontSize: 12,
              background: saving ? '#1E3A5F' : '#00F5FF20', border: '1px solid #00F5FF60',
              color: '#00F5FF', cursor: saving ? 'default' : 'pointer',
              opacity: !edit.text.trim() ? 0.5 : 1,
            }}
          >{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

interface GhostCardProps {
  slug: string
  onAdd: (slug: string) => void
}

function GhostCard({ slug, onAdd }: GhostCardProps) {
  return (
    <div
      className="rounded-lg p-3 cursor-pointer group"
      style={{
        background: 'transparent', border: '1px dashed #1E3A5F50',
        transition: 'border-color 0.15s',
      }}
      onClick={() => onAdd(slug)}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#00F5FF50' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#1E3A5F50' }}
      title={`Add goal for ${slug}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[0.6rem] font-mono text-slate-600">{slug}</span>
      </div>
      <div className="text-xs font-mono text-slate-700 group-hover:text-slate-500 transition-colors">
        + Add goal
      </div>
    </div>
  )
}

export default function GoalsPage() {
  const [goals, setGoals] = useState<GoalCard[]>([])
  const [allSlugs, setAllSlugs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [cycling, setCycling] = useState<string | null>(null)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const fetchGoals = useCallback(async () => {
    const [goalsRes, fleetRes] = await Promise.all([
      fetch('/api/goals'),
      fetch('/api/fleet'),
    ])
    if (goalsRes.ok) {
      const data = await goalsRes.json() as { goals: GoalCard[] }
      setGoals(data.goals)
    }
    if (fleetRes.ok) {
      const data = await fleetRes.json() as { projects: Array<{ slug: string }> }
      setAllSlugs(data.projects.map((p) => p.slug).filter((s) => s !== 'master'))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchGoals()
    const id = setInterval(() => void fetchGoals(), 30000)
    return () => clearInterval(id)
  }, [fetchGoals])

  async function cycleStatus(card: GoalCard) {
    const newStatus = CYCLE[card.status]
    setCycling(card.slug)
    try {
      await fetch(`/api/projects/${card.slug}/goal`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: card.goalText, status: newStatus }),
      })
      setGoals(prev => prev.map(g => g.slug === card.slug ? { ...g, status: newStatus } : g))
    } finally {
      setCycling(null)
    }
  }

  async function saveEdit() {
    if (!edit) return
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${edit.slug}/goal`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: edit.text, status: 'active' }),
      })
      if (res.ok) {
        const updated = await res.json() as { goalText: string; goalStatus: GoalStatus }
        setGoals(prev => {
          const exists = prev.find(g => g.slug === edit.slug)
          if (exists) {
            return prev.map(g => g.slug === edit.slug
              ? { ...g, goalText: updated.goalText, status: updated.goalStatus, lastModified: new Date().toISOString() }
              : g)
          }
          return [...prev, {
            slug: edit.slug,
            goalText: updated.goalText,
            status: updated.goalStatus,
            lastModified: new Date().toISOString(),
          }]
        })
        setEdit(null)
      }
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete(slug: string) {
    await fetch(`/api/projects/${slug}/goal`, { method: 'DELETE' })
    setGoals(prev => prev.filter(g => g.slug !== slug))
    setDeleteConfirm(null)
  }

  const goalSlugs = new Set(goals.map(g => g.slug))
  const noGoalSlugs = allSlugs.filter(s => !goalSlugs.has(s))
  const columns: GoalStatus[] = ['active', 'paused', 'completed']
  const total = goals.length

  return (
    <div className="min-h-dvh bg-[#050b14] text-slate-200 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/" className="text-slate-500 hover:text-cyber-cyan transition-colors text-sm font-mono">
          ← Mission Control
        </Link>
        <h1
          className="text-lg font-bold tracking-wider uppercase"
          style={{ fontFamily: 'Orbitron, monospace', color: '#00F5FF', textShadow: '0 0 20px #00F5FF50' }}
        >
          Goal Progress Board
        </h1>
        <span className="ml-auto text-xs font-mono text-slate-600">{total} goal{total !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading goals…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {columns.map((status) => {
            const cfg = STATUS_CONFIG[status]
            const cards = goals.filter(g => g.status === status)
            return (
              <div
                key={status}
                className="rounded-xl p-4"
                style={{ background: cfg.colBg, border: `1px solid ${cfg.border}` }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: cfg.color, boxShadow: `0 0 6px ${cfg.color}` }}
                  />
                  <span
                    className="text-xs font-bold uppercase tracking-widest"
                    style={{ color: cfg.color }}
                  >
                    {cfg.label}
                  </span>
                  <span className="ml-auto text-xs font-mono text-slate-600">{cards.length}</span>
                </div>

                <div className="flex flex-col gap-3">
                  {cards.length === 0 ? (
                    <div className="text-center py-6 text-slate-700 text-xs font-mono">—</div>
                  ) : (
                    cards.map((card) => (
                      <GoalCardView
                        key={card.slug}
                        card={card}
                        cycling={cycling}
                        onCycle={cycleStatus}
                        onEdit={(c) => setEdit({ slug: c.slug, text: c.goalText, isNew: false })}
                        onDelete={(slug) => setDeleteConfirm(slug)}
                      />
                    ))
                  )}

                  {/* Ghost cards for add-goal — only show in Active column */}
                  {status === 'active' && noGoalSlugs.length > 0 && (
                    <div className="mt-2 flex flex-col gap-2">
                      <div className="text-[0.6rem] font-mono text-slate-700 uppercase tracking-widest mb-1">
                        No goal set
                      </div>
                      {noGoalSlugs.map((slug) => (
                        <GhostCard
                          key={slug}
                          slug={slug}
                          onAdd={(s) => setEdit({ slug: s, text: '', isNew: true })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="mt-6 text-center text-[0.6rem] text-slate-700 font-mono">
        Goal Progress Board · reads GOAL.md per project · refreshes every 30s
      </p>

      {edit && (
        <EditModal
          edit={edit}
          saving={saving}
          onChange={(t) => setEdit(prev => prev ? { ...prev, text: t } : null)}
          onSave={() => void saveEdit()}
          onCancel={() => setEdit(null)}
        />
      )}

      {deleteConfirm && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(5,11,20,0.85)',
            zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: '#0B1628', border: '1px solid #EF444430', borderRadius: 10,
            padding: '24px 28px', maxWidth: 360, textAlign: 'center',
          }}>
            <div style={{ color: '#EF4444', fontFamily: 'monospace', fontWeight: 700, marginBottom: 8 }}>
              Delete goal?
            </div>
            <div style={{ color: '#94A3B8', fontFamily: 'monospace', fontSize: 12, marginBottom: 20 }}>
              This removes GOAL.md for <strong style={{ color: '#00F5FF' }}>{deleteConfirm}</strong>. Cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{
                  padding: '6px 18px', borderRadius: 6, fontFamily: 'monospace', fontSize: 12,
                  background: 'transparent', border: '1px solid #1E3A5F', color: '#94A3B8', cursor: 'pointer',
                }}
              >Cancel</button>
              <button
                onClick={() => void confirmDelete(deleteConfirm)}
                style={{
                  padding: '6px 18px', borderRadius: 6, fontFamily: 'monospace', fontSize: 12,
                  background: '#EF444420', border: '1px solid #EF444450', color: '#EF4444', cursor: 'pointer',
                }}
              >Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

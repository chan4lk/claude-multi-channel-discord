'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type { ClaudeTemplate, ClaudeTemplateCategory } from '../api/claude-templates/route'

const CATEGORIES: ClaudeTemplateCategory[] = ['coding', 'research', 'review', 'custom']
const CAT_COLORS: Record<ClaudeTemplateCategory, string> = {
  coding:   '#4ADE80',
  research: '#38BDF8',
  review:   '#A855F7',
  custom:   '#64748b',
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString() } catch { return iso }
}

interface FormState {
  name: string
  description: string
  category: ClaudeTemplateCategory
  body: string
}
const EMPTY_FORM: FormState = { name: '', description: '', category: 'custom', body: '' }

export default function ClaudeTemplatesPage() {
  const [templates, setTemplates] = useState<ClaudeTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [catFilter, setCatFilter] = useState<ClaudeTemplateCategory | 'all'>('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [preview, setPreview] = useState<ClaudeTemplate | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/claude-templates')
    const d = await r.json() as { templates: ClaudeTemplate[] }
    setTemplates(d.templates ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function startNew() { setEditing('new'); setForm(EMPTY_FORM); setPreview(null) }
  function startEdit(t: ClaudeTemplate) {
    setEditing(t.id)
    setForm({ name: t.name, description: t.description, category: t.category, body: t.body })
    setPreview(null)
  }
  function cancelEdit() { setEditing(null); setForm(EMPTY_FORM) }

  async function save() {
    if (!form.name.trim() || !form.body.trim()) return
    setSaving(true)
    const payload = {
      ...(editing !== 'new' ? { id: editing } : {}),
      name: form.name,
      description: form.description,
      category: form.category,
      body: form.body,
    }
    await fetch('/api/claude-templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    setSaveMsg('Saved ✓')
    setTimeout(() => setSaveMsg(null), 2000)
    setSaving(false)
    setEditing(null)
    setForm(EMPTY_FORM)
    await load()
  }

  async function doDelete(id: string) {
    await fetch(`/api/claude-templates?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setDeleteConfirm(null)
    await load()
  }

  const visible = templates.filter((t) => {
    if (catFilter !== 'all' && t.category !== catFilter) return false
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.description.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-4 py-2.5">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider">
            ← Mission Control
          </Link>
          <span className="text-[0.65rem] font-mono font-bold text-cyber-cyan uppercase tracking-widest">CLAUDE.md Templates</span>
          <span className="text-[0.55rem] font-mono text-slate-600 border border-slate-700 px-1.5 py-0.5 rounded">
            {templates.length} templates
          </span>
          <div className="flex-1" />
          {saveMsg && <span className="text-[0.6rem] font-mono text-green-400">{saveMsg}</span>}
          <button
            onClick={startNew}
            className="text-[0.6rem] font-mono px-2.5 py-1 rounded border border-cyber-cyan/30 text-cyber-cyan hover:bg-cyber-cyan/10 transition-colors"
          >
            + New Template
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 max-w-5xl mx-auto w-full">
        {/* filters */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <button
            onClick={() => setCatFilter('all')}
            className="text-[0.6rem] font-mono px-2 py-0.5 rounded border transition-colors"
            style={{
              borderColor: catFilter === 'all' ? 'rgba(0,245,255,0.4)' : '#374151',
              color: catFilter === 'all' ? '#00F5FF' : '#64748b',
              background: catFilter === 'all' ? 'rgba(0,245,255,0.08)' : 'transparent',
            }}
          >
            all
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              className="text-[0.6rem] font-mono px-2 py-0.5 rounded border transition-colors"
              style={{
                borderColor: catFilter === c ? `${CAT_COLORS[c]}60` : '#374151',
                color: catFilter === c ? CAT_COLORS[c] : '#64748b',
                background: catFilter === c ? `${CAT_COLORS[c]}10` : 'transparent',
              }}
            >
              {c}
            </button>
          ))}
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ml-auto text-[0.65rem] font-mono bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-300 focus:outline-none focus:border-slate-500 w-40"
          />
        </div>

        {/* edit form */}
        {editing !== null && (
          <div className="mb-6 rounded-lg border border-cyber-cyan/20 p-4" style={{ background: 'rgba(0,245,255,0.02)' }}>
            <div className="text-[0.6rem] font-mono text-cyber-cyan uppercase tracking-wider mb-3">
              {editing === 'new' ? 'New Template' : 'Edit Template'}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Template name *"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="flex-1 text-[0.65rem] font-mono bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-300 focus:outline-none focus:border-slate-500"
                />
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as ClaudeTemplateCategory }))}
                  className="text-[0.65rem] font-mono bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-300 focus:outline-none"
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <input
                type="text"
                placeholder="Description (optional)"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="text-[0.65rem] font-mono bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-300 focus:outline-none focus:border-slate-500"
              />
              <textarea
                placeholder="Template body (markdown) *"
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                rows={12}
                spellCheck={false}
                className="text-[0.65rem] font-mono bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-300 focus:outline-none focus:border-slate-500 resize-y leading-relaxed"
              />
              <div className="flex items-center gap-2 justify-end">
                <button onClick={cancelEdit} className="text-[0.6rem] font-mono px-2 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-slate-300">
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving || !form.name.trim() || !form.body.trim()}
                  className="text-[0.6rem] font-mono px-3 py-0.5 rounded border border-cyber-cyan/30 text-cyber-cyan hover:bg-cyber-cyan/10 transition-colors disabled:opacity-40"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* template list */}
        {loading ? (
          <div className="text-center py-12 text-[0.6rem] font-mono text-slate-600 animate-pulse">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-3">
            <div className="text-3xl opacity-20">📄</div>
            <p className="text-xs font-mono text-slate-500">No templates found</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {visible.map((t) => {
              const catColor = CAT_COLORS[t.category]
              const isPreviewing = preview?.id === t.id
              return (
                <div
                  key={t.id}
                  className="rounded-lg border transition-colors"
                  style={{ borderColor: 'rgba(0,245,255,0.08)', background: 'rgba(0,245,255,0.015)' }}
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span
                      className="text-[0.5rem] font-mono px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: `${catColor}15`, color: catColor, border: `1px solid ${catColor}30` }}
                    >
                      {t.category}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[0.7rem] font-mono text-slate-200">{t.name}</span>
                        {t.readonly && (
                          <span className="text-[0.45rem] font-mono px-1 py-0.5 rounded bg-slate-800 text-slate-600 border border-slate-700">
                            built-in
                          </span>
                        )}
                      </div>
                      {t.description && (
                        <p className="text-[0.55rem] font-mono text-slate-500 truncate mt-0.5">{t.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setPreview(isPreviewing ? null : t)}
                        className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        {isPreviewing ? '▲ hide' : '▼ view'}
                      </button>
                      {!t.readonly && (
                        <>
                          <button
                            onClick={() => startEdit(t)}
                            className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-cyber-cyan hover:border-cyber-cyan/30 transition-colors"
                          >
                            edit
                          </button>
                          {deleteConfirm === t.id ? (
                            <>
                              <button
                                onClick={() => doDelete(t.id)}
                                className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
                              >
                                confirm
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded border border-slate-700 text-slate-500"
                              >
                                cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(t.id)}
                              className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-red-400 hover:border-red-500/30 transition-colors"
                            >
                              delete
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    <span className="text-[0.5rem] font-mono text-slate-700 shrink-0">{fmtDate(t.updatedAt)}</span>
                  </div>
                  {isPreviewing && (
                    <div className="border-t border-white/5 px-4 pb-3 pt-2">
                      <pre className="text-[0.6rem] font-mono text-slate-400 whitespace-pre-wrap leading-relaxed max-h-64 overflow-auto rounded p-2" style={{ background: '#020810' }}>
                        {t.body}
                      </pre>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

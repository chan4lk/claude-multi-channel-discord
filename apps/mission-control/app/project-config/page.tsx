'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'
import type { ProjectConfig, ProjectConfigResponse } from '../api/project-config/route'

const KNOWN_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-8',
  'claude-haiku-4-5-20251001',
  'claude-fable-5',
]

const PROGRESS_MODES = ['off', 'post', 'edit']
const PERMISSION_MODES = ['', 'default', 'acceptEdits', 'bypassPermissions']

interface FormState {
  model: string
  progressMode: string
  stuckThresholdMinutes: string
  allowedTools: string
  disallowedTools: string
  permissionMode: string
}

function configToForm(c: ProjectConfig): FormState {
  return {
    model: c.model ?? '',
    progressMode: c.progressMode ?? '',
    stuckThresholdMinutes: c.stuckThresholdMinutes != null ? String(c.stuckThresholdMinutes) : '',
    allowedTools: c.allowedTools.join(', '),
    disallowedTools: c.disallowedTools.join(', '),
    permissionMode: c.permissionMode ?? '',
  }
}

function isDirty(form: FormState, saved: FormState): boolean {
  return JSON.stringify(form) !== JSON.stringify(saved)
}

interface ToastProps { msg: string; type: 'success' | 'error' }

function Toast({ msg, type }: ToastProps) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 100,
      background: type === 'success' ? '#10B98120' : '#EF444420',
      border: `1px solid ${type === 'success' ? '#10B98160' : '#EF444460'}`,
      color: type === 'success' ? '#10B981' : '#EF4444',
      padding: '10px 18px', borderRadius: 8, fontFamily: 'monospace', fontSize: 13,
      maxWidth: 360,
    }}>
      {msg}
    </div>
  )
}

const FIELD_STYLE = {
  background: '#080F1E', border: '1px solid #1E3A5F', borderRadius: 6,
  padding: '8px 12px', color: '#E2E8F0', fontFamily: 'monospace', fontSize: 13,
  outline: 'none', width: '100%', boxSizing: 'border-box' as const,
}

const LABEL_STYLE = { color: '#64748B', fontSize: 11, fontFamily: 'monospace', marginBottom: 4, display: 'block' as const }

export default function ProjectConfigPage() {
  const [slugs, setSlugs] = useState<string[]>([])
  const [selectedSlug, setSelectedSlug] = useState<string>('')
  const [form, setForm] = useState<FormState | null>(null)
  const [savedForm, setSavedForm] = useState<FormState | null>(null)
  const [defaults, setDefaults] = useState<Omit<ProjectConfig, 'slug'> | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<ToastProps | null>(null)

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  // Load project list
  useEffect(() => {
    fetch('/api/fleet')
      .then((r) => r.json())
      .then((d: { projects: Array<{ slug: string }> }) => {
        const sl = d.projects.map((p) => p.slug).filter((s) => s !== 'master').sort()
        setSlugs(sl)
        if (sl.length > 0) setSelectedSlug(sl[0])
      })
      .catch(() => {})
  }, [])

  const loadConfig = useCallback(async (slug: string) => {
    if (!slug) return
    setLoading(true)
    try {
      const res = await fetch(`/api/project-config?slug=${encodeURIComponent(slug)}`)
      if (!res.ok) return
      const data = await res.json() as ProjectConfigResponse
      const f = configToForm(data.config)
      setForm(f)
      setSavedForm(f)
      setDefaults(data.defaults)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadConfig(selectedSlug) }, [selectedSlug, loadConfig])

  async function save() {
    if (!form || !selectedSlug) return
    setSaving(true)
    try {
      const tools = (s: string) => s.split(',').map((t) => t.trim()).filter(Boolean)
      const body = {
        slug: selectedSlug,
        model: form.model || null,
        progressMode: form.progressMode || null,
        stuckThresholdMinutes: form.stuckThresholdMinutes ? parseInt(form.stuckThresholdMinutes, 10) : null,
        allowedTools: tools(form.allowedTools),
        disallowedTools: tools(form.disallowedTools),
        permissionMode: form.permissionMode || null,
      }
      const res = await fetch('/api/project-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json() as ProjectConfigResponse
        const f = configToForm(data.config)
        setForm(f)
        setSavedForm(f)
        showToast('Config saved — restart session to apply', 'success')
      } else {
        const err = await res.json() as { error?: string }
        showToast(err.error ?? 'Save failed', 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  const dirty = form && savedForm ? isDirty(form, savedForm) : false

  function setField(key: keyof FormState, val: string) {
    setForm((prev) => prev ? { ...prev, [key]: val } : null)
  }

  const ph = (key: keyof Omit<ProjectConfig, 'slug'>) => {
    if (!defaults) return ''
    const v = defaults[key]
    if (Array.isArray(v)) return v.join(', ') || '(none)'
    return String(v ?? '(none)')
  }

  return (
    <div style={{ background: '#080F1E', minHeight: '100vh', fontFamily: 'monospace' }}>
      <SubPageHeader title="Project Config" />

      <div style={{ padding: '20px 24px', maxWidth: 640 }}>
        {/* Warning banner */}
        <div style={{
          background: '#F59E0B12', border: '1px solid #F59E0B30', borderRadius: 8,
          padding: '10px 16px', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <span style={{ color: '#F59E0B', fontSize: 14 }}>⚠</span>
          <div style={{ color: '#F59E0B', fontSize: 12 }}>
            Most changes require a session restart to take effect.{' '}
            <Link href="/admin" style={{ color: '#F59E0B', textDecoration: 'underline' }}>Session controls →</Link>
          </div>
        </div>

        {/* Project selector */}
        <div style={{ marginBottom: 24 }}>
          <label style={LABEL_STYLE}>Project</label>
          <select
            value={selectedSlug}
            onChange={(e) => setSelectedSlug(e.target.value)}
            style={{ ...FIELD_STYLE, cursor: 'pointer' }}
          >
            {slugs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {loading ? (
          <div style={{ color: '#475569', fontSize: 13, padding: '20px 0' }}>Loading config…</div>
        ) : !form ? null : (
          <>
            {/* Model */}
            <div style={{ marginBottom: 16 }}>
              <label style={LABEL_STYLE}>Model <span style={{ color: '#1E3A5F' }}>· default: {ph('model')}</span></label>
              <input
                list="model-options"
                value={form.model}
                onChange={(e) => setField('model', e.target.value)}
                placeholder={ph('model') || 'claude-sonnet-4-6'}
                style={FIELD_STYLE}
              />
              <datalist id="model-options">
                {KNOWN_MODELS.map((m) => <option key={m} value={m} />)}
              </datalist>
            </div>

            {/* Progress mode */}
            <div style={{ marginBottom: 16 }}>
              <label style={LABEL_STYLE}>Progress Mode <span style={{ color: '#1E3A5F' }}>· default: {ph('progressMode') || 'off'}</span></label>
              <select
                value={form.progressMode}
                onChange={(e) => setField('progressMode', e.target.value)}
                style={{ ...FIELD_STYLE, cursor: 'pointer' }}
              >
                <option value="">(use default)</option>
                {PROGRESS_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {/* Stuck threshold */}
            <div style={{ marginBottom: 16 }}>
              <label style={LABEL_STYLE}>Stuck Threshold (minutes) <span style={{ color: '#1E3A5F' }}>· default: {ph('stuckThresholdMinutes') || '5'} · range 1–60</span></label>
              <input
                type="number"
                min={1}
                max={60}
                value={form.stuckThresholdMinutes}
                onChange={(e) => setField('stuckThresholdMinutes', e.target.value)}
                placeholder={ph('stuckThresholdMinutes') || '5'}
                style={FIELD_STYLE}
              />
            </div>

            {/* Permission mode */}
            <div style={{ marginBottom: 16 }}>
              <label style={LABEL_STYLE}>Permission Mode <span style={{ color: '#1E3A5F' }}>· default: {ph('permissionMode') || 'default'}</span></label>
              <select
                value={form.permissionMode}
                onChange={(e) => setField('permissionMode', e.target.value)}
                style={{ ...FIELD_STYLE, cursor: 'pointer' }}
              >
                {PERMISSION_MODES.map((m) => (
                  <option key={m} value={m}>{m || '(use default)'}</option>
                ))}
              </select>
            </div>

            {/* Allowed tools */}
            <div style={{ marginBottom: 16 }}>
              <label style={LABEL_STYLE}>Allowed Tools <span style={{ color: '#1E3A5F' }}>· comma-separated · default: {ph('allowedTools')}</span></label>
              <input
                value={form.allowedTools}
                onChange={(e) => setField('allowedTools', e.target.value)}
                placeholder="Bash, Read, Edit, Write"
                style={FIELD_STYLE}
              />
            </div>

            {/* Disallowed tools */}
            <div style={{ marginBottom: 24 }}>
              <label style={LABEL_STYLE}>Disallowed Tools <span style={{ color: '#1E3A5F' }}>· comma-separated · default: {ph('disallowedTools')}</span></label>
              <input
                value={form.disallowedTools}
                onChange={(e) => setField('disallowedTools', e.target.value)}
                placeholder="WebSearch, WebFetch"
                style={FIELD_STYLE}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => void save()}
                disabled={saving || !dirty}
                style={{
                  padding: '8px 24px', borderRadius: 6, fontFamily: 'monospace', fontSize: 13,
                  background: dirty ? '#00F5FF20' : '#1E3A5F20',
                  border: `1px solid ${dirty ? '#00F5FF60' : '#1E3A5F'}`,
                  color: dirty ? '#00F5FF' : '#475569',
                  cursor: saving || !dirty ? 'default' : 'pointer',
                  position: 'relative',
                }}
              >
                {dirty && (
                  <span style={{
                    position: 'absolute', top: -4, right: -4, width: 8, height: 8,
                    background: '#F59E0B', borderRadius: '50%', border: '2px solid #080F1E',
                  }} />
                )}
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setForm(savedForm); }}
                disabled={!dirty}
                style={{
                  padding: '8px 18px', borderRadius: 6, fontFamily: 'monospace', fontSize: 13,
                  background: 'transparent', border: '1px solid #1E3A5F',
                  color: dirty ? '#94A3B8' : '#475569',
                  cursor: dirty ? 'pointer' : 'default',
                }}
              >Reset</button>
            </div>
          </>
        )}
      </div>

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}

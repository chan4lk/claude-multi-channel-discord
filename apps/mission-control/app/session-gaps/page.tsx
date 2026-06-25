'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'
import type { SessionGapsResponse, ProjectGapInfo, Gap } from '../api/session-gaps/route'

const WINDOW_DAYS = [7, 14, 30]

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 48) return `${Math.round(h)}h`
  return `${(h / 24).toFixed(1)}d`
}

function fmtTs(ts: string | null): string {
  if (!ts) return 'never'
  try {
    return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return ts }
}

function severityColor(s: Gap['severity']): string {
  return s === 'red' ? '#EF4444' : '#F59E0B'
}

// Render a swimlane bar for one project over the time window
function SwimlaneBar({ project, windowDays, nowMs }: { project: ProjectGapInfo; windowDays: number; nowMs: number }) {
  const windowMs = windowDays * 86_400_000
  const startMs = nowMs - windowMs

  const segments: { left: number; width: number; color: string; label: string }[] = []

  // Green active segments + gap segments
  let cursor = startMs
  const lastMsg = project.lastMessageTs ? Date.parse(project.lastMessageTs) : null
  const msgMs = project.messageCount > 0 && lastMsg ? lastMsg : null

  for (const gap of project.gaps) {
    const gs = Math.max(Date.parse(gap.start), startMs)
    const ge = Math.min(Date.parse(gap.end), nowMs)
    if (gs > cursor) {
      // active segment before gap
      segments.push({
        left: ((cursor - startMs) / windowMs) * 100,
        width: ((gs - cursor) / windowMs) * 100,
        color: '#22c55e',
        label: '',
      })
    }
    segments.push({
      left: ((gs - startMs) / windowMs) * 100,
      width: ((ge - gs) / windowMs) * 100,
      color: severityColor(gap.severity),
      label: fmtHours(gap.durationHours),
    })
    cursor = ge
  }
  if (cursor < nowMs) {
    segments.push({
      left: ((cursor - startMs) / windowMs) * 100,
      width: ((nowMs - cursor) / windowMs) * 100,
      color: msgMs && msgMs >= cursor ? '#22c55e' : '#334155',
      label: '',
    })
  }

  return (
    <div style={{ position: 'relative', height: 16, background: '#0f172a', borderRadius: 4, overflow: 'hidden' }}>
      {segments.map((s, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${Math.max(0, s.left)}%`,
            width: `${Math.min(100 - Math.max(0, s.left), s.width)}%`,
            height: '100%',
            background: s.color,
            opacity: 0.8,
          }}
          title={s.label || undefined}
        />
      ))}
    </div>
  )
}

export default function SessionGapsPage() {
  const [data, setData] = useState<SessionGapsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)
  const [hoveredGap, setHoveredGap] = useState<{ slug: string; gap: Gap } | null>(null)

  const nowMs = Date.now()

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/session-gaps?days=${days}`)
      .then(r => r.json())
      .then((d: SessionGapsResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [days])

  useEffect(() => { load() }, [load])

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#e2e8f0', fontFamily: 'monospace', padding: '24px' }}>
      <SubPageHeader title="Session Gap Analysis">
        <button onClick={load} style={{ background: 'none', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
          ↻ Refresh
        </button>
      </SubPageHeader>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        {WINDOW_DAYS.map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            style={{
              background: days === d ? '#1e40af' : '#1e293b',
              border: '1px solid #334155',
              color: days === d ? '#93c5fd' : '#94a3b8',
              borderRadius: 6,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {d}d
          </button>
        ))}
        <div style={{ display: 'flex', gap: 16, marginLeft: 16, fontSize: 11, color: '#64748b' }}>
          <span><span style={{ color: '#22c55e' }}>■</span> Active</span>
          <span><span style={{ color: '#F59E0B' }}>■</span> Idle &gt;24h</span>
          <span><span style={{ color: '#EF4444' }}>■</span> Idle &gt;72h</span>
          <span><span style={{ color: '#334155' }}>■</span> No activity</span>
        </div>
      </div>

      {loading && <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading…</div>}

      {!loading && data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Time axis header */}
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 80px 100px', gap: 12, padding: '0 0 8px 0', borderBottom: '1px solid #1e293b', fontSize: 11, color: '#475569' }}>
            <div>Project</div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{days}d ago</span>
              <span>Now</span>
            </div>
            <div>Current gap</div>
            <div>Last message</div>
          </div>

          {data.projects.map(proj => (
            <div
              key={proj.slug}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr 80px 100px',
                gap: 12,
                padding: '6px 0',
                borderBottom: '1px solid #0f172a',
                alignItems: 'center',
              }}
            >
              <Link
                href={`/projects/${proj.slug}`}
                style={{ color: '#7c3aed', fontSize: 12, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={proj.slug}
              >
                {proj.slug}
              </Link>
              <SwimlaneBar project={proj} windowDays={days} nowMs={nowMs} />
              <div style={{
                fontSize: 12,
                color: proj.currentGapHours >= 72 ? '#EF4444' : proj.currentGapHours >= 24 ? '#F59E0B' : '#22c55e',
                fontWeight: 600,
              }}>
                {fmtHours(proj.currentGapHours)}
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                {fmtTs(proj.lastMessageTs)}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && data?.projects.length === 0 && (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>No projects found.</div>
      )}

      <div style={{ marginTop: 24, color: '#334155', fontSize: 11, textAlign: 'right' }}>
        {data?.generatedAt ? `Generated ${fmtTs(data.generatedAt)}` : ''}
        {' · '}
        <Link href="/idle-fleet" style={{ color: '#475569' }}>Idle Fleet</Link>
        {' · '}
        <Link href="/fleet-timeline" style={{ color: '#475569' }}>Fleet Timeline</Link>
      </div>
    </div>
  )
}

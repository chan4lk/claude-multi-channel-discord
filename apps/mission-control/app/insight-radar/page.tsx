'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'
import type { InsightRadarResponse, RadarProject, RadarScores } from '../api/insight-radar/route'

const AXES: Array<{
  key: keyof RadarScores
  label: string
  href: string
  angleDeg: number
}> = [
  { key: 'health',          label: 'Health',         href: '/health-score',   angleDeg: 270 },
  { key: 'velocity',        label: 'Velocity',        href: '/turn-duration',  angleDeg: 330 },
  { key: 'memory',          label: 'Memory',          href: '/memory-radar',   angleDeg: 30  },
  { key: 'schedule',        label: 'Schedule',        href: '/schedules',      angleDeg: 90  },
  { key: 'toolDiversity',   label: 'Tool Diversity',  href: '/tool-heatmap',   angleDeg: 150 },
  { key: 'backlogCoverage', label: 'Backlog',         href: '/backlog',        angleDeg: 210 },
]

const PALETTE = ['#00F5FF', '#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6']
const MAX_SELECTED = 8

const PLATFORM_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  discord:  { bg: 'rgba(0,245,255,0.15)',   color: '#00F5FF', label: 'Discord'  },
  teams:    { bg: 'rgba(99,102,241,0.15)',  color: '#6366F1', label: 'Teams'    },
  whatsapp: { bg: 'rgba(16,185,129,0.15)', color: '#10B981', label: 'WhatsApp' },
}

function toRad(deg: number) { return (deg * Math.PI) / 180 }

function radarPoint(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = toRad(angleDeg)
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function scoreToRadius(score: number, maxR: number): number {
  return (score / 100) * maxR
}

function polygonPoints(scores: RadarScores, cx: number, cy: number, maxR: number): string {
  return AXES.map(({ key, angleDeg }) => {
    const r = scoreToRadius(scores[key], maxR)
    const [x, y] = radarPoint(cx, cy, r, angleDeg)
    return `${x},${y}`
  }).join(' ')
}

function avgScore(scores: RadarScores): number {
  const vals = Object.values(scores) as number[]
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
}

function deltaScores(a: RadarScores, b: RadarScores): RadarScores {
  return {
    health:          Math.abs(a.health - b.health),
    velocity:        Math.abs(a.velocity - b.velocity),
    memory:          Math.abs(a.memory - b.memory),
    schedule:        Math.abs(a.schedule - b.schedule),
    toolDiversity:   Math.abs(a.toolDiversity - b.toolDiversity),
    backlogCoverage: Math.abs(a.backlogCoverage - b.backlogCoverage),
  }
}

interface RadarChartProps {
  selected: RadarProject[]
  compareMode: boolean
}

function RadarChart({ selected, compareMode }: RadarChartProps) {
  const size = 400
  const cx = size / 2
  const cy = size / 2
  const maxR = 160
  const rings = [0.25, 0.5, 0.75, 1.0]

  const delta =
    compareMode && selected.length === 2
      ? deltaScores(selected[0].scores, selected[1].scores)
      : null

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: 'block', margin: '0 auto' }}
    >
      {/* Grid rings */}
      {rings.map((pct) => {
        const r = maxR * pct
        const pts = AXES.map(({ angleDeg }) => {
          const [x, y] = radarPoint(cx, cy, r, angleDeg)
          return `${x},${y}`
        }).join(' ')
        return (
          <polygon
            key={pct}
            points={pts}
            fill="none"
            stroke="rgba(0,245,255,0.12)"
            strokeWidth="1"
          />
        )
      })}

      {/* Ring % labels */}
      {rings.map((pct) => {
        const r = maxR * pct
        const [x, y] = radarPoint(cx, cy, r, 270)
        return (
          <text
            key={`ring-label-${pct}`}
            x={x + 4}
            y={y}
            fill="rgba(100,116,139,0.7)"
            fontSize="9"
            fontFamily="monospace"
          >
            {Math.round(pct * 100)}
          </text>
        )
      })}

      {/* Axis spokes */}
      {AXES.map(({ angleDeg }) => {
        const [x, y] = radarPoint(cx, cy, maxR, angleDeg)
        return (
          <line
            key={angleDeg}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="rgba(0,245,255,0.15)"
            strokeWidth="1"
          />
        )
      })}

      {/* Axis labels (clickable) */}
      {AXES.map(({ key, label, href, angleDeg }) => {
        const labelR = maxR + 28
        const [lx, ly] = radarPoint(cx, cy, labelR, angleDeg)
        const anchor =
          angleDeg === 270 || angleDeg === 90
            ? 'middle'
            : angleDeg < 180 || angleDeg === 330
            ? 'start'
            : 'end'
        return (
          <a key={key} href={href}>
            <text
              x={lx}
              y={ly + 4}
              fill="#00F5FF"
              fontSize="10"
              fontFamily="monospace"
              textAnchor={anchor}
              style={{ cursor: 'pointer', textDecoration: 'underline' }}
            >
              {label}
            </text>
          </a>
        )
      })}

      {/* Delta polygon (compare mode) */}
      {delta && (
        <polygon
          points={polygonPoints(delta, cx, cy, maxR)}
          fill="rgba(234,179,8,0.30)"
          stroke="#EAB308"
          strokeWidth="1.5"
          strokeDasharray="4 2"
        />
      )}

      {/* Project polygons */}
      {selected.map((proj, i) => {
        const color = PALETTE[i % PALETTE.length]
        const pts = polygonPoints(proj.scores, cx, cy, maxR)
        return (
          <g key={proj.slug}>
            <polygon
              points={pts}
              fill={color}
              fillOpacity={0.12}
              stroke={color}
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            {AXES.map(({ key, angleDeg }) => {
              const r = scoreToRadius(proj.scores[key], maxR)
              const [x, y] = radarPoint(cx, cy, r, angleDeg)
              return (
                <circle
                  key={`${proj.slug}-${key}`}
                  cx={x}
                  cy={y}
                  r={3}
                  fill={color}
                />
              )
            })}
          </g>
        )
      })}

      {/* Center dot */}
      <circle cx={cx} cy={cy} r={2} fill="rgba(0,245,255,0.4)" />
    </svg>
  )
}

export default function InsightRadarPage() {
  const [data, setData] = useState<InsightRadarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([])
  const [legendOpen, setLegendOpen] = useState(false)
  const initializedRef = useRef(false)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/insight-radar')
      if (res.ok) {
        const json = await res.json() as InsightRadarResponse
        setData(json)
        if (!initializedRef.current && json.projects.length > 0) {
          initializedRef.current = true
          setSelectedSlugs(json.projects.slice(0, 5).map((p) => p.slug))
        }
      }
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void fetchData()
    const id = setInterval(() => void fetchData(), 60_000)
    return () => clearInterval(id)
  }, [fetchData])

  function toggleProject(slug: string) {
    setSelectedSlugs((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug)
      if (prev.length >= MAX_SELECTED) return prev
      return [...prev, slug]
    })
  }

  const projects = data?.projects ?? []
  const selectedProjects = selectedSlugs
    .map((slug) => projects.find((p) => p.slug === slug))
    .filter(Boolean) as RadarProject[]

  const compareMode = selectedProjects.length === 2

  return (
    <div style={{ background: '#020811', minHeight: '100vh', fontFamily: 'monospace' }}>
      <SubPageHeader title="INSIGHT RADAR" />

      <div style={{ padding: '20px 24px' }}>
        {/* Page header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <h1 style={{
            fontFamily: 'Orbitron, monospace',
            fontSize: 18,
            fontWeight: 700,
            color: '#00F5FF',
            margin: 0,
            letterSpacing: 2,
          }}>
            CROSS-PROJECT INSIGHT RADAR
          </h1>
          <span style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 4,
            background: 'rgba(0,245,255,0.08)',
            color: '#00F5FF',
            border: '1px solid rgba(0,245,255,0.2)',
          }}>
            auto-refresh 60s
          </span>
          {compareMode && (
            <span style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
              background: 'rgba(234,179,8,0.12)',
              color: '#EAB308',
              border: '1px solid rgba(234,179,8,0.3)',
            }}>
              compare mode · delta polygon active
            </span>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#64748B', fontSize: 14 }}>
            Loading insight radar…
          </div>
        ) : projects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#64748B', fontSize: 14 }}>
            No projects found.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Left panel: project checklist */}
            <div style={{
              minWidth: 220,
              flex: '0 0 220px',
              background: 'rgba(0,245,255,0.04)',
              border: '1px solid rgba(0,245,255,0.12)',
              borderRadius: 8,
              padding: 16,
            }}>
              <div style={{ color: '#64748B', fontSize: 11, marginBottom: 12, letterSpacing: 1 }}>
                PROJECTS · {selectedSlugs.length}/{MAX_SELECTED}
              </div>
              {projects.map((proj, i) => {
                const checked = selectedSlugs.includes(proj.slug)
                const colorIdx = selectedSlugs.indexOf(proj.slug)
                const color = colorIdx >= 0 ? PALETTE[colorIdx % PALETTE.length] : '#64748B'
                const avg = avgScore(proj.scores)
                const platformStyle = PLATFORM_STYLES[proj.platform] ?? PLATFORM_STYLES.discord

                return (
                  <label
                    key={proj.slug}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 4px',
                      cursor: 'pointer',
                      borderBottom: i < projects.length - 1 ? '1px solid rgba(0,245,255,0.06)' : 'none',
                      opacity: !checked && selectedSlugs.length >= MAX_SELECTED ? 0.4 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && selectedSlugs.length >= MAX_SELECTED}
                      onChange={() => toggleProject(proj.slug)}
                      style={{ accentColor: color, width: 14, height: 14 }}
                    />
                    <span style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: checked ? color : 'transparent',
                      border: `1.5px solid ${checked ? color : '#334155'}`,
                      flexShrink: 0,
                    }} />
                    <span style={{ flex: 1, color: checked ? '#CBD5E1' : '#475569', fontSize: 12 }}>
                      {proj.slug}
                    </span>
                    {/* Platform badge */}
                    <span style={{
                      fontSize: 9,
                      padding: '1px 5px',
                      borderRadius: 3,
                      background: platformStyle.bg,
                      color: platformStyle.color,
                      fontWeight: 600,
                      letterSpacing: 0.5,
                    }}>
                      {platformStyle.label}
                    </span>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: avg >= 80 ? '#10B981' : avg >= 50 ? '#F59E0B' : '#EF4444',
                      minWidth: 26,
                      textAlign: 'right',
                    }}>
                      {avg}
                    </span>
                  </label>
                )
              })}

              {/* Score breakdown for selected */}
              {selectedProjects.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ color: '#64748B', fontSize: 10, marginBottom: 8, letterSpacing: 1 }}>
                    AXIS SCORES
                  </div>
                  {AXES.map(({ key, label }) => (
                    <div key={key} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
                      <span style={{ color: '#475569', fontSize: 10, flex: 1 }}>{label}</span>
                      {selectedProjects.map((proj, i) => {
                        const color = PALETTE[selectedSlugs.indexOf(proj.slug) % PALETTE.length]
                        const score = proj.scores[key]
                        return (
                          <span key={proj.slug} style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color,
                            minWidth: 26,
                            textAlign: 'right',
                          }}>
                            {score}
                          </span>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right panel: radar chart */}
            <div style={{ flex: 1, minWidth: 320 }}>
              <div style={{
                background: 'rgba(0,245,255,0.03)',
                border: '1px solid rgba(0,245,255,0.10)',
                borderRadius: 8,
                padding: 24,
              }}>
                {selectedProjects.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: '#475569', fontSize: 13 }}>
                    Select a project to visualize
                  </div>
                ) : (
                  <RadarChart selected={selectedProjects} compareMode={compareMode} />
                )}

                {/* Legend for selected projects */}
                {selectedProjects.length > 0 && (
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 12,
                    justifyContent: 'center',
                    marginTop: 16,
                  }}>
                    {selectedProjects.map((proj) => {
                      const idx = selectedSlugs.indexOf(proj.slug)
                      const color = PALETTE[idx % PALETTE.length]
                      return (
                        <div key={proj.slug} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            width: 12,
                            height: 3,
                            background: color,
                            borderRadius: 2,
                            display: 'inline-block',
                          }} />
                          <span style={{ fontSize: 11, color: '#94A3B8' }}>{proj.slug}</span>
                        </div>
                      )
                    })}
                    {compareMode && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          width: 12,
                          height: 3,
                          background: '#EAB308',
                          borderRadius: 2,
                          display: 'inline-block',
                          opacity: 0.7,
                        }} />
                        <span style={{ fontSize: 11, color: '#94A3B8' }}>delta</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Collapsible legend */}
              <div style={{
                marginTop: 16,
                border: '1px solid rgba(0,245,255,0.10)',
                borderRadius: 8,
                overflow: 'hidden',
              }}>
                <button
                  onClick={() => setLegendOpen((p) => !p)}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    background: 'rgba(0,245,255,0.04)',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    color: '#64748B',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    letterSpacing: 1,
                  }}
                >
                  <span style={{ transform: legendOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>▶</span>
                  AXIS LEGEND
                </button>
                {legendOpen && (
                  <div style={{ padding: '12px 16px', background: 'rgba(0,0,0,0.3)' }}>
                    {AXES.map(({ key, label, href }) => {
                      const descriptions: Record<keyof RadarScores, string> = {
                        health:          'Circuit breaker trip rate in last 7 days. Fewer trips = higher score. Score = max(0, 100 − trips × 15).',
                        velocity:        'User turn count in last 7 days across all transcripts. Score = min(100, turns × 5).',
                        memory:          'Memory file count + [[link]] density in project memory/ dir. Score = min(100, files × 10 + links × 2).',
                        schedule:        'Ratio of enabled schedules. Has schedules: enabled/total × 80 + 20. No schedules: 50 (neutral).',
                        toolDiversity:   'Unique tool names used in transcripts in last 7 days. Score = min(100, uniqueTools × 12).',
                        backlogCoverage: 'Ratio of [x] done vs [ ] pending items in BACKLOG.md. No backlog = 50 (neutral).',
                      }
                      return (
                        <div key={key} style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                            <Link href={href} style={{ color: '#00F5FF', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
                              {label}
                            </Link>
                            <span style={{ color: '#334155', fontSize: 10 }}>↗ {href}</span>
                          </div>
                          <div style={{ color: '#475569', fontSize: 11, lineHeight: 1.5 }}>
                            {descriptions[key]}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ color: '#1E3A5F', fontSize: 11, marginTop: 16 }}>
          {projects.length} projects · select up to {MAX_SELECTED} · 2 selected = compare mode
          {data?.generatedAt && ` · computed ${data.generatedAt.slice(11, 19)} UTC`}
        </div>
      </div>
    </div>
  )
}

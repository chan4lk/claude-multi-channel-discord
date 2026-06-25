'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'
import type { HealthScoreResponse } from '../api/health-score/route'

type SortKey = 'slug' | 'healthScore' | 'circuitTripRate' | 'watchdogKillRate' | 'contextPressure' | 'toolErrorRate' | 'goalAlignment'

function scoreBadgeStyle(score: number): React.CSSProperties {
  const bg = score >= 80 ? 'rgba(16,185,129,0.18)' : score >= 50 ? 'rgba(245,158,11,0.18)' : 'rgba(239,68,68,0.18)'
  const color = score >= 80 ? '#10B981' : score >= 50 ? '#F59E0B' : '#EF4444'
  return {
    display: 'inline-block',
    minWidth: 36,
    textAlign: 'center' as const,
    padding: '2px 7px',
    borderRadius: 5,
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: 700,
    background: bg,
    color,
  }
}

function Sparkline({ series, color }: { series: number[]; color: string }) {
  const w = 40, h = 14
  const max = Math.max(...series, 1)
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * w},${h - (v / max) * h}`).join(' ')
  return (
    <svg width={w} height={h} className="inline-block" style={{ verticalAlign: 'middle', marginLeft: 6 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function dimColor(score: number): string {
  return score >= 80 ? '#10B981' : score >= 50 ? '#F59E0B' : '#EF4444'
}

function DimCell({ score, series }: { score: number; series: number[] }) {
  const color = dimColor(score)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0 }}>
      <span style={scoreBadgeStyle(score)}>{score}</span>
      <Sparkline series={series} color={color} />
    </div>
  )
}

type ProjectRow = HealthScoreResponse['projects'][number]

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'slug', label: 'Project' },
  { key: 'healthScore', label: 'Health Score' },
  { key: 'circuitTripRate', label: 'Circuit Trip Rate' },
  { key: 'watchdogKillRate', label: 'Watchdog Kill Rate' },
  { key: 'contextPressure', label: 'Context Pressure' },
  { key: 'toolErrorRate', label: 'Tool Error Rate' },
  { key: 'goalAlignment', label: 'Goal Alignment' },
]

function rowValue(row: ProjectRow, key: SortKey): number | string {
  if (key === 'slug') return row.slug
  if (key === 'healthScore') return row.healthScore
  return row.dims[key as keyof ProjectRow['dims']].score
}

export default function HealthScorePage() {
  const [data, setData] = useState<HealthScoreResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('healthScore')
  const [sortAsc, setSortAsc] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/health-score')
      if (res.ok) setData(await res.json() as HealthScoreResponse)
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void fetchData()
    const id = setInterval(() => void fetchData(), 60_000)
    return () => clearInterval(id)
  }, [fetchData])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((p) => !p)
    else { setSortKey(key); setSortAsc(key === 'slug') }
  }

  const projects = data?.projects ?? []
  const sorted = [...projects].sort((a, b) => {
    const av = rowValue(a, sortKey)
    const bv = rowValue(b, sortKey)
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
    }
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number)
  })

  function exportJson() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'health-score.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ background: '#020811', minHeight: '100vh', fontFamily: 'monospace' }}>
      <SubPageHeader title="Project Health Score Card" />

      <div style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <h1 style={{
            fontFamily: 'Orbitron, monospace',
            fontSize: 18,
            fontWeight: 700,
            color: '#00F5FF',
            margin: 0,
            letterSpacing: 2,
          }}>
            PROJECT HEALTH SCORE CARD
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
          <button
            onClick={exportJson}
            style={{
              marginLeft: 'auto',
              padding: '4px 12px',
              borderRadius: 5,
              fontFamily: 'monospace',
              fontSize: 11,
              background: '#1E3A5F30',
              border: '1px solid #1E3A5F',
              color: '#94A3B8',
              cursor: 'pointer',
            }}
          >
            ↓ Export JSON
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748B', fontSize: 14 }}>
            Loading health scores…
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748B', fontSize: 14 }}>
            No projects found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 3px', minWidth: 800 }}>
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      style={{
                        textAlign: col.key === 'slug' ? 'left' : 'center',
                        padding: '6px 10px',
                        color: col.key === 'healthScore' ? '#00F5FF' : '#64748B',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        userSelect: 'none',
                        borderBottom: '1px solid #1E3A5F',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {col.label} {sortKey === col.key ? (sortAsc ? '↑' : '↓') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const isUnhealthy = row.healthScore < 50
                  return (
                    <tr
                      key={row.slug}
                      style={{ background: isUnhealthy ? 'rgba(239,68,68,0.08)' : 'transparent' }}
                    >
                      <td style={{ padding: '8px 10px', color: '#CBD5E1', fontSize: 13 }}>
                        <Link
                          href={`/projects/${row.slug}`}
                          style={{ color: '#CBD5E1', textDecoration: 'none' }}
                        >
                          {row.slug}
                        </Link>
                      </td>
                      <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                        <span style={scoreBadgeStyle(row.healthScore)}>{row.healthScore}</span>
                      </td>
                      <td style={{ textAlign: 'center', padding: '8px 6px' }}>
                        <DimCell score={row.dims.circuitTripRate.score} series={row.dims.circuitTripRate.series} />
                      </td>
                      <td style={{ textAlign: 'center', padding: '8px 6px' }}>
                        <DimCell score={row.dims.watchdogKillRate.score} series={row.dims.watchdogKillRate.series} />
                      </td>
                      <td style={{ textAlign: 'center', padding: '8px 6px' }}>
                        <DimCell score={row.dims.contextPressure.score} series={row.dims.contextPressure.series} />
                      </td>
                      <td style={{ textAlign: 'center', padding: '8px 6px' }}>
                        <DimCell score={row.dims.toolErrorRate.score} series={row.dims.toolErrorRate.series} />
                      </td>
                      <td style={{ textAlign: 'center', padding: '8px 6px' }}>
                        <DimCell score={row.dims.goalAlignment.score} series={row.dims.goalAlignment.series} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ color: '#1E3A5F', fontSize: 11, marginTop: 16 }}>
          {sorted.length} projects · circuit×0.25 + watchdog×0.20 + context×0.20 + toolError×0.20 + goalAlign×0.15
          {data?.generatedAt && ` · computed ${data.generatedAt.slice(11, 19)} UTC`}
        </div>
      </div>
    </div>
  )
}

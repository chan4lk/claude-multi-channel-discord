'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import SubPageHeader from '../../components/SubPageHeader'

// ── Shapes from existing APIs ────────────────────────────────────────────────

interface TurnQualityCell { slug: string; score: number; hour: string }
interface TurnQualityResponse { rows: TurnQualityCell[]; slugs: string[] }

interface MemoryHealthProject { slug: string; composite: number }
interface MemoryHealthResponse { projects: MemoryHealthProject[] }

interface GoalHeatmapResponse { slugs: string[]; cells: Array<{ slug: string; rate: number }> }

interface ContextPressureProject { slug: string; score: number }
interface ContextPressureResponse { projects: ContextPressureProject[] }

interface AnomalyEntry { slug: string; severity: 'warn' | 'critical' }
interface AnomaliesResponse { anomalies: AnomalyEntry[] }

interface FleetProject { slug: string }
interface FleetResponse { projects: FleetProject[] }

// ── Scorecard row ────────────────────────────────────────────────────────────

interface ScorecardRow {
  slug: string
  turnQuality: number | null     // 0-100 (avg last 24h)
  memoryHealth: number | null    // 0-100
  goalProgress: number | null    // 0-100 (avg hit rate * 100)
  contextPressure: number | null // 0-100 inverted (low pressure = high score)
  anomalyScore: number | null    // 0-100 inverted (0 anomalies = 100)
  overall: number | null
}

// Weights must sum to 1
const W = { turnQuality: 0.30, memoryHealth: 0.30, goalProgress: 0.20, contextPressure: 0.10, anomalyScore: 0.10 }

function computeOverall(row: ScorecardRow): number {
  let sum = 0, totalW = 0
  const dims: Array<[keyof typeof W, number | null]> = [
    ['turnQuality', row.turnQuality],
    ['memoryHealth', row.memoryHealth],
    ['goalProgress', row.goalProgress],
    ['contextPressure', row.contextPressure],
    ['anomalyScore', row.anomalyScore],
  ]
  for (const [key, val] of dims) {
    if (val !== null) { sum += val * W[key]; totalW += W[key] }
  }
  if (totalW === 0) return 0
  return Math.round(sum / totalW)
}

// ── Colors ───────────────────────────────────────────────────────────────────

function scoreColor(v: number | null): string {
  if (v === null) return '#475569'
  if (v >= 70) return '#10B981'
  if (v >= 40) return '#F59E0B'
  return '#EF4444'
}

function scoreBg(v: number | null): string {
  if (v === null) return '#1E3A5F20'
  if (v >= 70) return '#10B98118'
  if (v >= 40) return '#F59E0B18'
  return '#EF444418'
}

// ── Component ────────────────────────────────────────────────────────────────

type SortKey = 'slug' | 'turnQuality' | 'memoryHealth' | 'goalProgress' | 'contextPressure' | 'anomalyScore' | 'overall'

const COLUMNS: Array<{ key: SortKey; label: string; detail: string; href?: (slug: string) => string }> = [
  { key: 'turnQuality',    label: 'Turns',    detail: 'Avg quality score (24h)',       href: (s) => `/turn-quality?slug=${s}` },
  { key: 'memoryHealth',   label: 'Memory',   detail: 'Memory composite score',        href: () => '/memory-health' },
  { key: 'goalProgress',   label: 'Goals',    detail: 'Avg keyword hit rate (30d)',     href: () => '/goal-heatmap' },
  { key: 'contextPressure', label: 'Context', detail: 'Context pressure inverted',     href: () => '/context-pressure' },
  { key: 'anomalyScore',   label: 'Anomalies', detail: 'Anomaly score (inverted)',     href: () => '/anomalies' },
  { key: 'overall',        label: 'Overall',  detail: 'Weighted composite (30/30/20/10/10)' },
]

function ScoreCell({ value, href }: { value: number | null; href?: string }) {
  const display = value === null ? '—' : `${value}`
  const inner = (
    <span style={{
      display: 'inline-block', minWidth: 44, textAlign: 'center',
      padding: '3px 8px', borderRadius: 5, fontFamily: 'monospace', fontSize: 12,
      fontWeight: 700, background: scoreBg(value), color: scoreColor(value),
    }}>{display}</span>
  )
  if (href && value !== null) {
    return <Link href={href} style={{ textDecoration: 'none' }}>{inner}</Link>
  }
  return inner
}

export default function ScorecardPage() {
  const [rows, setRows] = useState<ScorecardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('overall')
  const [sortAsc, setSortAsc] = useState(true) // ascending = worst first for numeric
  const [expanded, setExpanded] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<string>('')

  const fetchData = useCallback(async () => {
    try {
      const [fleetRes, tqRes, mhRes, ghRes, cpRes, anRes] = await Promise.all([
        fetch('/api/fleet'),
        fetch('/api/turn-quality'),
        fetch('/api/memory-health'),
        fetch('/api/goal-heatmap'),
        fetch('/api/context-pressure'),
        fetch('/api/anomalies'),
      ])

      const fleet = fleetRes.ok ? await fleetRes.json() as FleetResponse : { projects: [] }
      const tq = tqRes.ok ? await tqRes.json() as TurnQualityResponse : { rows: [], slugs: [] }
      const mh = mhRes.ok ? await mhRes.json() as MemoryHealthResponse : { projects: [] }
      const gh = ghRes.ok ? await ghRes.json() as GoalHeatmapResponse : { slugs: [], cells: [] }
      const cp = cpRes.ok ? await cpRes.json() as ContextPressureResponse : { projects: [] }
      const an = anRes.ok ? await anRes.json() as AnomaliesResponse : { anomalies: [] }

      const slugs = fleet.projects.map((p) => p.slug).filter((s) => s !== 'master')

      // Aggregate turn quality per slug (avg of scores)
      const tqMap: Record<string, number[]> = {}
      for (const cell of tq.rows) {
        if (!tqMap[cell.slug]) tqMap[cell.slug] = []
        tqMap[cell.slug].push(cell.score)
      }
      const tqAvg: Record<string, number> = {}
      for (const [s, scores] of Object.entries(tqMap)) {
        tqAvg[s] = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      }

      // Memory health
      const mhMap: Record<string, number> = {}
      for (const p of mh.projects) mhMap[p.slug] = p.composite

      // Goal progress (avg rate across all cells for slug)
      const ghCellsBySlug: Record<string, number[]> = {}
      for (const c of gh.cells) {
        if (!ghCellsBySlug[c.slug]) ghCellsBySlug[c.slug] = []
        ghCellsBySlug[c.slug].push(c.rate)
      }
      const ghAvg: Record<string, number> = {}
      for (const [s, rates] of Object.entries(ghCellsBySlug)) {
        ghAvg[s] = Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100)
      }

      // Context pressure inverted
      const cpMap: Record<string, number> = {}
      for (const p of cp.projects) cpMap[p.slug] = Math.max(0, 100 - p.score)

      // Anomaly score inverted: count anomalies per slug
      const anCount: Record<string, number> = {}
      for (const a of an.anomalies) anCount[a.slug] = (anCount[a.slug] ?? 0) + 1
      const maxAnomaly = Math.max(...Object.values(anCount), 1)
      const anScore: Record<string, number> = {}
      for (const s of slugs) {
        const count = anCount[s] ?? 0
        anScore[s] = Math.round(Math.max(0, 100 - (count / maxAnomaly) * 100))
      }

      const built: ScorecardRow[] = slugs.map((slug) => {
        const row: ScorecardRow = {
          slug,
          turnQuality:    tqAvg[slug] ?? null,
          memoryHealth:   mhMap[slug] ?? null,
          goalProgress:   ghAvg[slug] ?? null,
          contextPressure: cpMap[slug] ?? null,
          anomalyScore:   anScore[slug] ?? null,
          overall: null,
        }
        row.overall = computeOverall(row)
        return row
      })

      setRows(built)
      setLastRefresh(new Date().toLocaleTimeString())
    } catch {
      // silently keep stale data
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
    const id = setInterval(() => void fetchData(), 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [fetchData])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((p) => !p)
    else { setSortKey(key); setSortAsc(key === 'slug') }
  }

  const sorted = [...rows].sort((a, b) => {
    if (sortKey === 'slug') {
      return sortAsc ? a.slug.localeCompare(b.slug) : b.slug.localeCompare(a.slug)
    }
    const av = a[sortKey] ?? -1
    const bv = b[sortKey] ?? -1
    return sortAsc ? av - bv : bv - av
  })

  const DETAIL_LINKS: Array<{ label: string; href: (slug: string) => string }> = [
    { label: 'Turn Quality', href: (s) => `/turn-quality?slug=${s}` },
    { label: 'Memory Health', href: () => '/memory-health' },
    { label: 'Goal Heatmap', href: () => '/goal-heatmap' },
    { label: 'Context Pressure', href: () => '/context-pressure' },
    { label: 'Anomalies', href: (s) => `/anomalies?slug=${s}` },
  ]

  return (
    <div style={{ background: '#080F1E', minHeight: '100vh', fontFamily: 'monospace' }}>
      <SubPageHeader title="Project Scorecard" />

      <div style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <span style={{ color: '#64748B', fontSize: 12 }}>
            Composite health per project — 30% turns + 30% memory + 20% goals + 10% context + 10% anomalies
          </span>
          <button
            onClick={() => void fetchData()}
            style={{
              marginLeft: 'auto', padding: '4px 12px', borderRadius: 5, fontFamily: 'monospace', fontSize: 11,
              background: '#1E3A5F30', border: '1px solid #1E3A5F', color: '#94A3B8', cursor: 'pointer',
            }}
          >↻ Refresh</button>
          {lastRefresh && (
            <span style={{ color: '#1E3A5F', fontSize: 11 }}>updated {lastRefresh}</span>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748B', fontSize: 14 }}>
            Loading scorecard…
          </div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748B', fontSize: 14 }}>
            No projects found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px', minWidth: 640 }}>
              <thead>
                <tr>
                  <th
                    onClick={() => toggleSort('slug')}
                    style={{
                      textAlign: 'left', padding: '6px 12px', color: '#64748B', fontSize: 11,
                      fontWeight: 600, cursor: 'pointer', userSelect: 'none',
                      borderBottom: '1px solid #1E3A5F',
                    }}
                  >
                    Project {sortKey === 'slug' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      title={col.detail}
                      style={{
                        textAlign: 'center', padding: '6px 8px', color: col.key === 'overall' ? '#00F5FF' : '#64748B',
                        fontSize: 11, fontWeight: 600, cursor: 'pointer', userSelect: 'none',
                        borderBottom: '1px solid #1E3A5F', whiteSpace: 'nowrap',
                      }}
                    >
                      {col.label} {sortKey === col.key ? (sortAsc ? '↑' : '↓') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const isExpanded = expanded === row.slug
                  const overallColor = scoreColor(row.overall)
                  const rowBg = (row.overall ?? 100) < 40
                    ? 'rgba(239,68,68,0.05)'
                    : (row.overall ?? 100) < 70
                      ? 'rgba(245,158,11,0.04)'
                      : 'transparent'
                  return [
                    <tr
                      key={row.slug}
                      onClick={() => setExpanded(isExpanded ? null : row.slug)}
                      style={{
                        background: rowBg, cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = '#0F2240' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = rowBg }}
                    >
                      <td style={{ padding: '8px 12px', color: '#CBD5E1', fontSize: 13, borderRadius: '6px 0 0 6px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: overallColor, fontSize: 10 }}>●</span>
                          {row.slug}
                          <span style={{ color: '#1E3A5F', fontSize: 10 }}>{isExpanded ? '▾' : '▸'}</span>
                        </span>
                      </td>
                      {COLUMNS.map((col) => (
                        <td key={col.key} style={{ textAlign: 'center', padding: '8px 6px' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ScoreCell
                            value={row[col.key] as number | null}
                            href={col.href ? col.href(row.slug) : undefined}
                          />
                        </td>
                      ))}
                    </tr>,
                    isExpanded && (
                      <tr key={`${row.slug}-expand`}>
                        <td
                          colSpan={COLUMNS.length + 1}
                          style={{
                            padding: '8px 12px 12px 24px',
                            background: '#0B1A2E',
                            borderBottom: '1px solid #1E3A5F',
                          }}
                        >
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {DETAIL_LINKS.map((lnk) => (
                              <Link
                                key={lnk.label}
                                href={lnk.href(row.slug)}
                                style={{
                                  padding: '4px 12px', borderRadius: 5, fontSize: 11,
                                  background: '#1E3A5F30', border: '1px solid #1E3A5F60',
                                  color: '#94A3B8', textDecoration: 'none',
                                }}
                              >
                                {lnk.label} →
                              </Link>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ color: '#1E3A5F', fontSize: 11, marginTop: 16 }}>
          {rows.length} projects · click column header to sort · click row to expand · auto-refreshes every 5 min
        </div>
      </div>
    </div>
  )
}

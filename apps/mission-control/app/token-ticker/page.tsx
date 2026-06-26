'use client'

import { useEffect, useRef, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { TokenTickerSnapshot, TopBurner } from '../api/token-ticker/route'

const BUCKET_COUNT = 24
const AMBER_MULTIPLIER = 2
const RED_BUDGET_PCT = 90

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function fmtModel(m: string): string {
  if (!m || m === 'unknown') return '—'
  const parts = m.split('-')
  return parts.slice(0, 3).join('-')
}

function RateColor({ rate, avg7d }: { rate: number; avg7d: number }) {
  if (avg7d > 0 && rate >= avg7d * RED_BUDGET_PCT / 100 * AMBER_MULTIPLIER) return '#EF4444'
  if (avg7d > 0 && rate >= avg7d * AMBER_MULTIPLIER) return '#F59E0B'
  return '#22D3EE'
}

function SparklineBar({ buckets, avg7dRate }: { buckets: number[]; avg7dRate: number }) {
  const max = Math.max(...buckets, 1)
  const W = 400
  const H = 64
  const n = BUCKET_COUNT
  const bw = W / n

  return (
    <svg width={W} height={H} className="w-full max-w-[400px]">
      {buckets.map((v, i) => {
        const h = Math.max((v / max) * H, v > 0 ? 2 : 0)
        const isLatest = i === n - 1
        const color = RateColor({ rate: v * 12, avg7d: avg7dRate })
        return (
          <rect
            key={i}
            x={i * bw + 0.5}
            y={H - h}
            width={bw - 1}
            height={h}
            fill={isLatest ? color : '#38BDF8'}
            opacity={isLatest ? 1 : 0.35 + (i / n) * 0.4}
          >
            <title>{fmtTokens(v)} tokens (5s bucket)</title>
          </rect>
        )
      })}
      {avg7dRate > 0 && (() => {
        const avgH = Math.max((avg7dRate / 12 / Math.max(max, 1)) * H, 1)
        const y = H - avgH
        return (
          <line
            x1={0}
            y1={y}
            x2={W}
            y2={y}
            stroke="#64748B"
            strokeWidth="1"
            strokeDasharray="3,3"
            opacity={0.6}
          />
        )
      })()}
    </svg>
  )
}

function BudgetGauge({ pct }: { pct: number }) {
  const clamped = Math.min(pct, 100)
  const color = pct >= RED_BUDGET_PCT ? '#EF4444' : pct >= 60 ? '#F59E0B' : '#4ADE80'
  const r = 52
  const cx = 64
  const cy = 64
  const circumference = 2 * Math.PI * r
  const dash = (clamped / 100) * circumference

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={128} height={128}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth="10" />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          fill={color}
          fontSize="18"
          fontWeight="bold"
          fontFamily="monospace"
        >
          {clamped}%
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fill="#64748B"
          fontSize="9"
          fontFamily="monospace"
        >
          monthly
        </text>
      </svg>
      <span
        className="text-[0.55rem] font-mono uppercase tracking-wider"
        style={{ color: color }}
      >
        {pct >= RED_BUDGET_PCT ? 'CRITICAL' : pct >= 60 ? 'ELEVATED' : 'NOMINAL'}
      </span>
    </div>
  )
}

function BurnerRow({ burner, rank }: { burner: TopBurner; rank: number }) {
  const colors = ['#22D3EE', '#38BDF8', '#7DD3FC']
  const c = colors[rank] ?? '#64748B'
  return (
    <div className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
      <span className="text-[0.6rem] font-mono" style={{ color: '#64748B' }}>#{rank + 1}</span>
      <span className="font-mono text-xs font-bold truncate flex-1" style={{ color: c }}>
        {burner.slug}
      </span>
      <span className="text-[0.6rem] font-mono text-slate-500 truncate max-w-[120px]">
        {fmtModel(burner.model)}
      </span>
      <span className="font-mono text-xs font-bold tabular-nums" style={{ color: c }}>
        {fmtTokens(burner.rate)}/min
      </span>
    </div>
  )
}

export default function TokenTickerPage() {
  const [snap, setSnap] = useState<TokenTickerSnapshot | null>(null)
  const [buckets, setBuckets] = useState<number[]>(Array(BUCKET_COUNT).fill(0))
  const [avg7dRate, setAvg7dRate] = useState(0)
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const tickRef = useRef(0)

  useEffect(() => {
    // Compute 7-day avg rate once for baseline comparison
    fetch('/api/token-ticker')
      .then((r) => r.json())
      .then((data: TokenTickerSnapshot) => {
        if (data.projectedMonthly > 0) {
          setAvg7dRate(Math.round(data.projectedMonthly / 30 / 24 / 60))
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const es = new EventSource('/api/token-ticker?stream=1')
    esRef.current = es

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as TokenTickerSnapshot
        setSnap(data)
        setConnected(true)

        tickRef.current += 1
        const bucketIdx = tickRef.current % BUCKET_COUNT

        setBuckets((prev) => {
          const next = [...prev]
          next[bucketIdx] = Math.round((data.tokensPerMin / 12))
          return next
        })
      } catch { /* ignore */ }
    }

    return () => {
      es.close()
      setConnected(false)
    }
  }, [])

  const rate = snap?.tokensPerMin ?? 0
  const rateColor = RateColor({ rate, avg7d: avg7dRate })

  return (
    <div className="min-h-screen bg-cyber-bg text-slate-200 flex flex-col">
      <SubPageHeader title="LIVE TOKEN BURN TICKER">
        <span
          className="text-[0.55rem] font-mono px-2 py-0.5 rounded-full border"
          style={{
            color: connected ? '#4ADE80' : '#EF4444',
            borderColor: connected ? '#4ADE8044' : '#EF444444',
          }}
        >
          {connected ? '● LIVE' : '○ OFFLINE'}
        </span>
      </SubPageHeader>

      <div className="flex-1 p-4 sm:p-6 flex flex-col gap-6 max-w-4xl mx-auto w-full">
        {/* Main counter */}
        <div className="rounded-xl border border-cyber-cyan/15 bg-cyber-surface/60 p-6 flex flex-col items-center gap-2">
          <div
            className="text-[0.6rem] font-mono uppercase tracking-[0.25em] mb-1"
            style={{ color: '#64748B' }}
          >
            Fleet Tokens / Minute
          </div>
          <div
            className="text-6xl sm:text-8xl font-black font-mono tabular-nums"
            style={{
              color: rateColor,
              textShadow: `0 0 30px ${rateColor}66`,
              transition: 'color 0.5s ease, text-shadow 0.5s ease',
            }}
          >
            {fmtTokens(rate)}
          </div>
          <div className="text-[0.6rem] font-mono text-slate-500">
            tokens/min · updates every 5s
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Sparkline */}
          <div className="sm:col-span-2 rounded-xl border border-cyber-cyan/15 bg-cyber-surface/60 p-4 flex flex-col gap-2">
            <div className="text-[0.6rem] font-mono uppercase tracking-wider text-slate-500">
              2-Minute Rolling Window (24 × 5s buckets)
            </div>
            <SparklineBar buckets={buckets} avg7dRate={avg7dRate} />
            <div className="flex items-center gap-3 text-[0.55rem] font-mono text-slate-600">
              <span className="flex items-center gap-1">
                <span className="inline-block w-6 border-t border-dashed border-slate-600" />
                7d avg rate
              </span>
              <span className="ml-auto">← 2 min ago · now →</span>
            </div>
          </div>

          {/* Budget gauge */}
          <div className="rounded-xl border border-cyber-cyan/15 bg-cyber-surface/60 p-4 flex flex-col items-center justify-center gap-2">
            <div className="text-[0.6rem] font-mono uppercase tracking-wider text-slate-500 text-center">
              Monthly Budget
            </div>
            <BudgetGauge pct={snap?.budgetPct ?? 0} />
            <div className="text-[0.6rem] font-mono text-slate-500 text-center">
              Projected: {fmtTokens(snap?.projectedMonthly ?? 0)}
            </div>
          </div>
        </div>

        {/* Top burners */}
        <div className="rounded-xl border border-cyber-cyan/15 bg-cyber-surface/60 p-4">
          <div className="text-[0.6rem] font-mono uppercase tracking-wider text-slate-500 mb-3">
            Top Burners (last 60s)
          </div>
          {snap?.topBurners && snap.topBurners.length > 0 ? (
            snap.topBurners.map((b, i) => (
              <BurnerRow key={b.slug} burner={b} rank={i} />
            ))
          ) : (
            <div className="text-center py-6 text-slate-600 text-sm font-mono">
              No active burn detected
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Rate', value: `${fmtTokens(rate)}/min`, color: rateColor },
            { label: 'Top Burner', value: snap?.topBurners[0]?.slug ?? '—', color: '#22D3EE' },
            { label: 'Monthly Proj.', value: fmtTokens(snap?.projectedMonthly ?? 0), color: '#A78BFA' },
            { label: 'Budget Used', value: `${snap?.budgetPct ?? 0}%`, color: snap?.budgetPct ?? 0 >= RED_BUDGET_PCT ? '#EF4444' : '#4ADE80' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg border border-white/5 bg-cyber-surface/40 p-3 flex flex-col gap-1">
              <div className="text-[0.55rem] font-mono uppercase tracking-wider text-slate-600">{label}</div>
              <div className="text-sm font-mono font-bold truncate" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

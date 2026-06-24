'use client'

import { useEffect, useState } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import FreshnessBadge from '../../components/FreshnessBadge'
import { useFreshness } from '../../lib/useFreshness'
import type { MarqueeResponse, MarqueeMetric, MetricHealth } from '../api/marquee/route'

const HEALTH_COLOR: Record<MetricHealth, string> = {
  good: '#10B981',
  warn: '#F59E0B',
  bad: '#EF4444',
  neutral: '#22D3EE',
}

function Card({ metric }: { metric: MarqueeMetric }) {
  const color = HEALTH_COLOR[metric.health]
  return (
    <div
      className="flex flex-col items-center justify-center shrink-0 rounded-xl border px-8 py-6 mx-3"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: `${color}33`, minWidth: 220 }}
    >
      <div className="font-mono font-bold leading-none" style={{ color, fontSize: '2.6rem' }}>
        {metric.value}
      </div>
      <div className="text-[0.6rem] font-mono text-slate-400 mt-3 uppercase tracking-[0.25em] text-center">
        {metric.label}
      </div>
    </div>
  )
}

export default function MarqueePage() {
  const { data, isStale, lastError, lastSuccessAt } = useFreshness<MarqueeResponse>('/api/marquee', 30_000)
  const loading = data === null && lastError === null
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduceMotion(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const metrics = data?.metrics ?? []

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ background: '#080f1c', color: '#E2E8F0' }}>
      <SubPageHeader title="Fleet Vitals Marquee">
        <span className="text-[0.6rem] font-mono text-slate-500">Always-on headline ticker</span>
        <FreshnessBadge isStale={isStale} lastError={lastError} lastSuccessAt={lastSuccessAt} />
      </SubPageHeader>

      {loading && <div className="text-center py-20 text-slate-600 font-mono text-sm">Loading…</div>}

      {!loading && metrics.length === 0 && (
        <div className="text-center py-20 text-slate-600 font-mono text-sm">No fleet data</div>
      )}

      {!loading && metrics.length > 0 && (
        <div className="mt-10">
          {reduceMotion ? (
            // Static, non-animated fallback for prefers-reduced-motion.
            <div className="flex flex-wrap justify-center gap-2">
              {metrics.map((m) => <Card key={m.key} metric={m} />)}
            </div>
          ) : (
            <div className="marquee-viewport">
              {/* Duplicated track for a seamless loop. */}
              <div className="marquee-track">
                {metrics.map((m) => <Card key={m.key} metric={m} />)}
                {metrics.map((m) => <Card key={`dup-${m.key}`} metric={m} />)}
              </div>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .marquee-viewport {
          overflow: hidden;
          width: 100%;
          mask-image: linear-gradient(to right, transparent, #000 6%, #000 94%, transparent);
          -webkit-mask-image: linear-gradient(to right, transparent, #000 6%, #000 94%, transparent);
        }
        .marquee-track {
          display: flex;
          width: max-content;
          animation: marquee-scroll 30s linear infinite;
        }
        @keyframes marquee-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  )
}

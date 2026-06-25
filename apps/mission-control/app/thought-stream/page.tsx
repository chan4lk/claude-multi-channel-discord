'use client'

import { useEffect, useState, useCallback } from 'react'
import SubPageHeader from '../../components/SubPageHeader'
import type { ThoughtStreamResponse, ThoughtEntry } from '../api/thought-stream/route'

const POLL_MS = 2000

function timeAgo(ts: string): string {
  const diffSec = Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 1000))
  if (diffSec < 60) return `${diffSec}s ago`
  const min = Math.floor(diffSec / 60)
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ago`
}

function ThoughtCard({ entry, expanded, onToggle }: {
  entry: ThoughtEntry
  expanded: boolean
  onToggle: () => void
}) {
  const preview = entry.thinkingText.slice(0, 300)
  const hasMore = entry.thinkingText.length > 300

  return (
    <div
      style={{
        border: `1px solid ${entry.inFlight ? '#06B6D4' : '#374151'}`,
        borderRadius: 8,
        padding: '14px 16px',
        cursor: 'pointer',
        background: entry.inFlight ? 'rgba(6,182,212,0.05)' : '#111827',
        transition: 'border-color 0.2s',
      }}
      onClick={onToggle}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        {entry.inFlight && (
          <span style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#06B6D4',
            animation: 'pulse 1.2s ease-in-out infinite',
          }} />
        )}
        <span style={{ color: '#22D3EE', fontWeight: 600, fontFamily: 'monospace' }}>
          {entry.slug}
        </span>
        <span style={{
          fontSize: 11,
          padding: '2px 7px',
          borderRadius: 4,
          background: entry.inFlight ? '#164E63' : '#1F2937',
          color: entry.inFlight ? '#67E8F9' : '#9CA3AF',
        }}>
          {entry.inFlight ? 'thinking…' : 'completed'}
        </span>
        <span style={{ marginLeft: 'auto', color: '#6B7280', fontSize: 12 }}>
          {timeAgo(entry.ts)}
        </span>
      </div>
      <div style={{ color: '#D1D5DB', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {expanded ? entry.thinkingText : preview}
        {!expanded && hasMore && (
          <span style={{ color: '#6B7280' }}> …</span>
        )}
      </div>
      {hasMore && (
        <div style={{ marginTop: 6, color: '#4B5563', fontSize: 11 }}>
          {expanded ? '▲ collapse' : `▼ show ${entry.thinkingText.length - 300} more chars`}
        </div>
      )}
    </div>
  )
}

export default function ThoughtStreamPage() {
  const [data, setData] = useState<ThoughtStreamResponse | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const poll = useCallback(() => {
    fetch('/api/thought-stream')
      .then((r) => r.json())
      .then((d: ThoughtStreamResponse) => setData(d))
      .catch(() => {})
  }, [])

  useEffect(() => {
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => clearInterval(id)
  }, [poll])

  function toggleExpand(slug: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  const entries = data?.entries ?? []
  const inFlightCount = entries.filter((e) => e.inFlight).length

  return (
    <div style={{ minHeight: '100vh', background: '#0F172A', color: '#E2E8F0', fontFamily: 'monospace' }}>
      <SubPageHeader title="Live Agent Thought Stream">
        {inFlightCount > 0 && (
          <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: '#164E63', color: '#67E8F9' }}>
            {inFlightCount} thinking
          </span>
        )}
        <span style={{ fontSize: 11, color: '#4B5563' }}>Real-time thinking blocks</span>
      </SubPageHeader>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
        {!data && (
          <div style={{ color: '#4B5563', textAlign: 'center', padding: 48 }}>Loading…</div>
        )}
        {data && entries.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: 48,
            color: '#4B5563',
            border: '1px dashed #1F2937',
            borderRadius: 8,
          }}>
            No active thinking blocks — all projects idle or in non-thinking mode.
          </div>
        )}
        {entries.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {entries.map((e) => (
              <ThoughtCard
                key={e.slug}
                entry={e}
                expanded={expanded.has(e.slug)}
                onToggle={() => toggleExpand(e.slug)}
              />
            ))}
          </div>
        )}

        {data && entries.length > 0 && (
          <div style={{ marginTop: 16, color: '#374151', fontSize: 11, textAlign: 'right' }}>
            Refreshes every {POLL_MS / 1000}s · last at {data.generatedAt.slice(11, 19)} UTC
          </div>
        )}
      </div>
    </div>
  )
}

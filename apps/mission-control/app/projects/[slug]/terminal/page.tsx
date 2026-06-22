'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

// Strip ANSI escape codes for plain text rendering
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '')
}

export default function TerminalPage() {
  const params = useParams()
  const slug = typeof params.slug === 'string' ? params.slug : Array.isArray(params.slug) ? params.slug[0] : ''

  const [lines, setLines] = useState<string[]>([])
  const [offline, setOffline] = useState(false)
  const [fullHistory, setFullHistory] = useState(false)
  const [connected, setConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }
    setConnected(false)
    setOffline(false)

    const url = `/api/projects/${encodeURIComponent(slug)}/terminal/stream${fullHistory ? '?full=1' : ''}`
    const es = new EventSource(url)
    eventSourceRef.current = es

    es.onopen = () => setConnected(true)

    es.onmessage = (e) => {
      try {
        const raw: string = JSON.parse(e.data)
        if (raw === '__OFFLINE__') {
          setOffline(true)
          setLines([])
          return
        }
        setOffline(false)
        const stripped = stripAnsi(raw)
        const nextLines = stripped.split('\n')
        setLines(nextLines)
        setLastUpdate(new Date())
      } catch {}
    }

    es.onerror = () => {
      setConnected(false)
    }
  }, [slug, fullHistory])

  useEffect(() => {
    if (!slug) return
    connect()
    return () => {
      eventSourceRef.current?.close()
    }
  }, [slug, connect])

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (!fullHistory) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [lines, fullHistory])

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      <header className="sticky top-0 z-30 border-b border-cyber-cyan/12 bg-[#060d1a]/90 backdrop-blur-md px-4 py-2.5">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href={`/projects/${encodeURIComponent(slug)}`}
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider"
          >
            ← {slug}
          </Link>
          <span className="text-[0.65rem] font-mono font-bold text-cyber-cyan uppercase tracking-widest">Terminal</span>

          <div
            className="flex items-center gap-1 text-[0.55rem] font-mono px-1.5 py-0.5 rounded"
            style={{
              color: offline ? '#EF4444' : connected ? '#4ADE80' : '#F59E0B',
              background: offline ? '#EF444410' : connected ? '#4ADE8010' : '#F59E0B10',
              border: `1px solid ${offline ? '#EF444430' : connected ? '#4ADE8030' : '#F59E0B30'}`,
            }}
          >
            <span>{offline ? '○' : connected ? '●' : '◌'}</span>
            <span>{offline ? 'session offline' : connected ? 'live' : 'connecting…'}</span>
          </div>

          <div className="flex-1" />

          <label className="flex items-center gap-1.5 cursor-pointer">
            <span className="text-[0.55rem] font-mono text-slate-500 uppercase tracking-wider">Full history</span>
            <div
              className="w-7 h-3.5 rounded-full relative transition-colors cursor-pointer"
              style={{ background: fullHistory ? 'rgba(0,245,255,0.4)' : 'rgba(255,255,255,0.1)' }}
              onClick={() => setFullHistory((v) => !v)}
            >
              <div
                className="absolute top-0.5 w-2.5 h-2.5 rounded-full transition-all"
                style={{
                  background: fullHistory ? '#00F5FF' : '#64748b',
                  left: fullHistory ? '1rem' : '0.125rem',
                }}
              />
            </div>
          </label>

          <button
            onClick={connect}
            className="text-[0.6rem] font-mono text-slate-400 hover:text-cyber-cyan transition-colors border border-slate-700 hover:border-cyber-cyan/30 px-2 py-1 rounded uppercase tracking-wider"
          >
            ↺ Refresh
          </button>
        </div>
      </header>

      <main className="flex-1 p-3 overflow-hidden">
        {offline ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="text-3xl opacity-20">◎</div>
            <p className="text-xs font-mono text-slate-500">
              No tmux session found for <span className="text-cyber-cyan">{slug}</span>
            </p>
            <p className="text-[0.55rem] font-mono text-slate-700">
              Session is offline or has not been started yet.
            </p>
          </div>
        ) : (
          <div
            className="rounded-lg border border-cyber-cyan/10 overflow-auto font-mono text-[0.65rem] leading-relaxed"
            style={{
              background: '#020810',
              color: '#94a3b8',
              height: 'calc(100dvh - 80px)',
              padding: '12px',
              whiteSpace: 'pre',
            }}
          >
            {lines.length === 0 && !offline && (
              <span className="text-slate-700 animate-pulse">Waiting for output…</span>
            )}
            {lines.map((line, i) => (
              <div key={i} style={{ minHeight: '1em' }}>{line || ' '}</div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </main>

      {lastUpdate && (
        <div className="px-4 pb-2 text-[0.5rem] font-mono text-slate-700">
          Read-only · Updated {lastUpdate.toLocaleTimeString()} · Polls every 1.5s
        </div>
      )}
    </div>
  )
}

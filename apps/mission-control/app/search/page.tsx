'use client'

import { Suspense, useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { SearchResult, SearchResponse } from '../api/search/route'

function HighlightSnippet({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark
        style={{
          background: 'rgba(0,245,255,0.2)',
          color: '#00F5FF',
          borderRadius: '2px',
          padding: '0 2px',
        }}
      >
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  )
}

function formatTs(ts?: string): string {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

function ResultCard({ result, q }: { result: SearchResult; q: string }) {
  const router = useRouter()

  function handleClick() {
    if (result.source === 'memory') {
      router.push('/memory-graph')
    } else {
      router.push(`/?transcript=${result.slug}`)
    }
  }

  const badgeStyle =
    result.source === 'memory'
      ? { color: '#A855F7', border: '1px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.1)' }
      : { color: '#F59E0B', border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.1)' }

  return (
    <button
      onClick={handleClick}
      className="w-full text-left rounded-lg border border-cyber-cyan/12 p-4 transition-all hover:border-cyber-cyan/30 hover:shadow-lg"
      style={{ background: 'rgba(0,245,255,0.03)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-[0.55rem] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
          style={badgeStyle}
        >
          {result.source}
          {result.memoryType ? ` · ${result.memoryType}` : ''}
        </span>
        <span className="text-sm font-mono text-cyber-cyan truncate">{result.slug}</span>
        <span className="flex-1" />
        {result.timestamp && (
          <span className="text-[0.6rem] font-mono text-slate-600 shrink-0">{formatTs(result.timestamp)}</span>
        )}
      </div>
      <p className="text-xs font-mono text-slate-400 leading-relaxed text-left break-words">
        <HighlightSnippet text={result.snippet} q={q} />
      </p>
    </button>
  )
}

function SearchInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialQ = searchParams.get('q') ?? ''

  const [inputVal, setInputVal] = useState(initialQ)
  const [data, setData] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const doSearch = useCallback((term: string) => {
    if (term.length < 2) {
      setData(null)
      return
    }
    setLoading(true)
    fetch(`/api/search?q=${encodeURIComponent(term)}`)
      .then((r) => r.json())
      .then((d: SearchResponse) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // Run search when URL ?q= changes
  useEffect(() => {
    const q = searchParams.get('q') ?? ''
    setInputVal(q)
    doSearch(q)
  }, [searchParams, doSearch])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = inputVal.trim()
    if (q.length < 2) return
    router.push(`/search?q=${encodeURIComponent(q)}`)
  }

  const memoryResults = data?.results.filter((r) => r.source === 'memory') ?? []
  const transcriptResults = data?.results.filter((r) => r.source === 'transcript') ?? []
  const searched = data !== null
  const noResults = searched && data.results.length === 0

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#060d1a' }}>
      {/* Header */}
      <header className="relative border-b border-cyber-cyan/12 bg-cyber-surface/70 backdrop-blur-md px-6 py-3">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-[0.6rem] font-mono text-slate-500 hover:text-cyber-cyan transition-colors uppercase tracking-wider"
          >
            ← Dashboard
          </Link>
          <h1
            className="text-lg font-black tracking-[0.18em] text-cyber-cyan"
            style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}
          >
            SEARCH
          </h1>
        </div>
      </header>

      {/* Search form */}
      <div className="px-6 py-6 max-w-3xl mx-auto w-full">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder="Search memories and transcripts…"
            autoFocus
            className="flex-1 bg-transparent border border-cyber-cyan/20 rounded-lg px-4 py-2.5 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyber-cyan/60 transition-colors"
            style={{ background: 'rgba(0,245,255,0.03)' }}
          />
          <button
            type="submit"
            disabled={inputVal.trim().length < 2}
            className="px-4 py-2.5 rounded-lg text-sm font-mono font-bold uppercase tracking-wider transition-all border"
            style={{
              color: '#00F5FF',
              borderColor: 'rgba(0,245,255,0.4)',
              background: 'rgba(0,245,255,0.08)',
            }}
          >
            Search
          </button>
        </form>
      </div>

      {/* Results */}
      <main className="flex-1 overflow-auto px-6 pb-8">
        <div className="max-w-3xl mx-auto space-y-6">
          {loading && (
            <div className="flex items-center justify-center h-40">
              <span className="text-xs font-mono text-slate-500 animate-pulse">Searching…</span>
            </div>
          )}

          {!loading && noResults && (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-slate-600">
              <span className="text-3xl opacity-30">⊘</span>
              <span className="text-xs font-mono">No matches across memories or transcripts</span>
            </div>
          )}

          {!loading && memoryResults.length > 0 && (
            <section className="space-y-3">
              <p className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider">
                Memory — {memoryResults.length} result{memoryResults.length !== 1 ? 's' : ''}
              </p>
              {memoryResults.map((r, i) => (
                <ResultCard key={`memory-${i}`} result={r} q={data?.query ?? ''} />
              ))}
            </section>
          )}

          {!loading && transcriptResults.length > 0 && (
            <section className="space-y-3">
              <p className="text-[0.6rem] font-mono text-slate-500 uppercase tracking-wider">
                Transcript — {transcriptResults.length} result{transcriptResults.length !== 1 ? 's' : ''}
              </p>
              {transcriptResults.map((r, i) => (
                <ResultCard key={`transcript-${i}`} result={r} q={data?.query ?? ''} />
              ))}
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-dvh flex items-center justify-center"
          style={{ background: '#060d1a' }}
        >
          <span className="text-xs font-mono text-slate-600 animate-pulse">Loading…</span>
        </div>
      }
    >
      <SearchInner />
    </Suspense>
  )
}

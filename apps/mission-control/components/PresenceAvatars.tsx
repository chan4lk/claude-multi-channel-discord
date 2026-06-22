'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

interface OperatorPresence {
  handle: string
  page: string
  slug?: string
  ts: number
}

// Deterministic adjective+noun from a random seed stored in localStorage
const ADJECTIVES = ['neon', 'swift', 'dark', 'void', 'stark', 'iron', 'cold', 'arc', 'deep', 'flux']
const NOUNS = ['hawk', 'wolf', 'ray', 'grid', 'node', 'core', 'mesh', 'gate', 'link', 'edge']

function generateHandle(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adj}-${noun}`
}

function getOrCreateHandle(): string {
  try {
    const stored = localStorage.getItem('mc_operator_handle')
    if (stored) return stored
    const handle = generateHandle()
    localStorage.setItem('mc_operator_handle', handle)
    return handle
  } catch {
    return 'operator'
  }
}

export default function PresenceAvatars() {
  const pathname = usePathname()
  const router = useRouter()
  const [operators, setOperators] = useState<OperatorPresence[]>([])
  const [myHandle, setMyHandle] = useState('')
  const [followTarget, setFollowTarget] = useState<string | null>(null)
  const [editingHandle, setEditingHandle] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [showTooltip, setShowTooltip] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Init handle
  useEffect(() => {
    const handle = getOrCreateHandle()
    setMyHandle(handle)
  }, [])

  // Ping on navigation
  useEffect(() => {
    if (!myHandle) return

    function ping() {
      const slug = pathname.startsWith('/projects/') ? pathname.split('/')[2] : undefined
      fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: myHandle, page: pathname, slug }),
      }).catch(() => {})
    }

    ping()
    if (pingRef.current) clearInterval(pingRef.current)
    pingRef.current = setInterval(ping, 20_000)

    return () => {
      if (pingRef.current) clearInterval(pingRef.current)
    }
  }, [myHandle, pathname])

  // SSE subscription
  useEffect(() => {
    const es = new EventSource('/api/presence')
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { operators: OperatorPresence[] }
        setOperators(data.operators.filter((op) => op.handle !== myHandle))
      } catch {}
    }

    es.onerror = () => {
      es.close()
    }

    return () => es.close()
  }, [myHandle])

  // Follow mode — navigate when followed operator navigates
  useEffect(() => {
    if (!followTarget) return
    const op = operators.find((o) => o.handle === followTarget)
    if (op && op.page !== pathname) {
      router.push(op.page)
    }
  }, [operators, followTarget, pathname, router])

  // Esc exits follow mode
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFollowTarget(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function saveHandle() {
    const trimmed = editValue.trim().slice(0, 32)
    if (trimmed) {
      try { localStorage.setItem('mc_operator_handle', trimmed) } catch {}
      setMyHandle(trimmed)
    }
    setEditingHandle(false)
  }

  if (operators.length === 0 && !editingHandle) return null

  return (
    <div className="flex flex-col items-center gap-1 px-1">
      {operators.slice(0, 4).map((op) => {
        const initials = op.handle.slice(0, 2).toUpperCase()
        const isFollowing = followTarget === op.handle
        return (
          <div key={op.handle} className="relative">
            <button
              onClick={() => setFollowTarget(isFollowing ? null : op.handle)}
              onMouseEnter={() => setShowTooltip(op.handle)}
              onMouseLeave={() => setShowTooltip(null)}
              className="flex items-center justify-center rounded-full text-[0.55rem] font-bold font-mono transition-all"
              style={{
                width: 24,
                height: 24,
                background: isFollowing ? 'rgba(167,139,250,0.3)' : 'rgba(34,211,238,0.12)',
                border: `1px solid ${isFollowing ? '#A78BFA' : 'rgba(34,211,238,0.3)'}`,
                color: isFollowing ? '#A78BFA' : '#22D3EE',
                boxShadow: isFollowing ? '0 0 8px rgba(167,139,250,0.4)' : 'none',
              }}
            >
              {initials}
            </button>
            {showTooltip === op.handle && (
              <div
                className="absolute left-full ml-2 px-2 py-1.5 rounded text-[0.6rem] font-mono whitespace-nowrap z-50 pointer-events-none"
                style={{
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: '#080f1c',
                  border: '1px solid rgba(34,211,238,0.2)',
                  color: '#94A3B8',
                }}
              >
                <div className="text-cyan-400 font-bold">{op.handle}</div>
                <div className="text-slate-500">{op.page}</div>
                {isFollowing && <div className="text-purple-400 mt-0.5">following · Esc to stop</div>}
                {!isFollowing && <div className="text-slate-600 mt-0.5">click to follow</div>}
              </div>
            )}
          </div>
        )
      })}

      {/* Own handle (click to edit) */}
      {editingHandle ? (
        <div className="flex flex-col items-center gap-0.5">
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveHandle(); if (e.key === 'Escape') setEditingHandle(false) }}
            className="w-[30px] text-[0.5rem] font-mono text-center rounded border bg-transparent outline-none"
            style={{ borderColor: '#22D3EE', color: '#22D3EE', padding: '2px 1px' }}
            maxLength={32}
          />
          <button
            onClick={saveHandle}
            className="text-[0.45rem] font-mono text-green-400"
          >
            OK
          </button>
        </div>
      ) : (
        myHandle && (
          <button
            onClick={() => { setEditValue(myHandle); setEditingHandle(true) }}
            title={`You: ${myHandle} (click to rename)`}
            className="flex items-center justify-center rounded-full text-[0.55rem] font-bold font-mono opacity-40 hover:opacity-80 transition-opacity"
            style={{
              width: 24,
              height: 24,
              background: 'rgba(100,116,139,0.12)',
              border: '1px solid rgba(100,116,139,0.3)',
              color: '#64748B',
            }}
          >
            {myHandle.slice(0, 2).toUpperCase()}
          </button>
        )
      )}
    </div>
  )
}

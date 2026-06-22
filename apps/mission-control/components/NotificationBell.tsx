'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFleet, type Notification, type NotificationType } from './FleetContext'

const TYPE_CONFIG: Record<NotificationType, { label: string; color: string; bg: string }> = {
  stall:          { label: 'stall',    color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  budget:         { label: 'budget',   color: '#F87171', bg: 'rgba(248,113,113,0.12)' },
  'circuit-open': { label: 'circuit',  color: '#FB923C', bg: 'rgba(251,146,60,0.12)' },
  watchdog:       { label: 'watchdog', color: '#A78BFA', bg: 'rgba(167,139,250,0.12)' },
}

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toISOString().slice(0, 10)
}

function NotifRow({ n, onRead }: { n: Notification; onRead: (id: number) => void }) {
  const router = useRouter()
  const cfg = TYPE_CONFIG[n.type]

  function handleSlugClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (n.slug) {
      onRead(n.id)
      router.push(`/?project=${n.slug}`)
    }
  }

  return (
    <div
      className="flex items-start gap-2.5 px-3 py-2.5 transition-colors"
      style={{
        background: n.read ? 'transparent' : 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        opacity: n.read ? 0.6 : 1,
      }}
    >
      <span
        className="flex-shrink-0 mt-0.5 text-[0.6rem] font-mono font-semibold px-1.5 py-0.5 rounded"
        style={{ background: cfg.bg, color: cfg.color }}
      >
        {cfg.label}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {n.slug && (
            <button
              onClick={handleSlugClick}
              className="font-mono text-[0.7rem] font-semibold truncate hover:underline"
              style={{ color: '#00F5FF' }}
            >
              {n.slug}
            </button>
          )}
          <span className="flex-shrink-0 font-mono text-[0.6rem]" style={{ color: '#334155' }}>
            {formatRelative(n.ts)}
          </span>
        </div>
        <p className="font-mono text-[0.68rem] mt-0.5 leading-tight" style={{ color: '#94A3B8' }}>
          {n.description}
        </p>
      </div>
      {!n.read && (
        <button
          onClick={() => onRead(n.id)}
          className="flex-shrink-0 text-[0.7rem] transition-colors"
          style={{ color: '#334155' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#94A3B8')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#334155')}
          title="Mark read"
        >
          ×
        </button>
      )}
    </div>
  )
}

export default function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead } = useFleet()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handleKey)
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((s) => !s)}
        title="Notifications"
        className="group relative flex items-center justify-center rounded transition-all"
        style={{
          width: 32,
          height: 30,
          color: open ? '#00F5FF' : unreadCount > 0 ? '#F59E0B' : '#374151',
          background: open ? 'rgba(0,245,255,0.1)' : 'transparent',
        }}
        onMouseEnter={(e) => { if (!open) (e.currentTarget as HTMLElement).style.color = '#22D3EE' }}
        onMouseLeave={(e) => { if (!open) (e.currentTarget as HTMLElement).style.color = unreadCount > 0 ? '#F59E0B' : '#374151' }}
      >
        <span className="text-sm leading-none select-none">🔔</span>
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-[0.5rem] font-mono font-bold leading-none"
            style={{
              minWidth: '0.9rem',
              height: '0.9rem',
              padding: '0 2px',
              background: '#EF4444',
              color: '#fff',
              animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
        <span
          className="absolute left-full ml-2.5 px-2 py-1 rounded text-[0.6rem] font-mono whitespace-nowrap pointer-events-none z-50 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: '#080f1c', color: '#94A3B8', border: '1px solid rgba(0,245,255,0.15)' }}
        >
          Notifications
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="fixed z-50"
          style={{
            left: 48,
            bottom: 40,
            width: 320,
            maxHeight: 480,
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(6,12,24,0.97)',
            border: '1px solid rgba(0,245,255,0.15)',
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-2 flex-shrink-0"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <span className="font-mono text-[0.7rem] font-semibold" style={{ color: '#E2E8F0' }}>
              Notifications
            </span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="font-mono text-[0.6rem] transition-colors"
                  style={{ color: '#475569' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#94A3B8')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#475569')}
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="font-mono text-[0.75rem] transition-colors"
                style={{ color: '#334155' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#94A3B8')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#334155')}
              >
                ×
              </button>
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <p className="font-mono text-[0.7rem]" style={{ color: '#334155' }}>No alerts yet</p>
              </div>
            ) : (
              notifications.map((n) => (
                <NotifRow key={n.id} n={n} onRead={markRead} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

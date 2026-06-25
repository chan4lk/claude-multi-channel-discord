'use client'

import { useEffect, useState, useCallback } from 'react'
import type { ContextAlert } from '../app/api/context-alerts/route'

const DISMISS_DURATION_MS = 10 * 60 * 1000

interface BannerAlert extends ContextAlert {
  dismissedUntil?: number
}

function etaLabel(eta: number): string {
  if (eta >= 999_990) return '∞'
  if (eta < 60) return `${eta}s`
  if (eta < 3600) return `~${Math.round(eta / 60)}m`
  return `~${(eta / 3600).toFixed(1)}h`
}

function alertColor(pct: number): { border: string; bg: string; text: string } {
  if (pct >= 90) return { border: '#EF4444', bg: '#1A0A0A', text: '#FCA5A5' }
  return { border: '#F59E0B', bg: '#1A130A', text: '#FCD34D' }
}

export default function ContextAlertBanner() {
  const [alerts, setAlerts] = useState<BannerAlert[]>([])
  const [dismissed, setDismissed] = useState<Record<string, number>>({})

  const loadAlerts = useCallback(async () => {
    try {
      const r = await fetch('/api/context-alerts', { cache: 'no-store' })
      const data = await r.json()
      setAlerts((data.alerts ?? []).map((a: ContextAlert) => ({ ...a })))
    } catch {
      // silent
    }
  }, [])

  useEffect(() => {
    loadAlerts()
    const id = setInterval(loadAlerts, 60_000)
    return () => clearInterval(id)
  }, [loadAlerts])

  const visibleAlerts = alerts.filter((a) => {
    const until = dismissed[a.slug]
    return !until || Date.now() > until
  })

  if (visibleAlerts.length === 0) return null

  const dismiss = (slug: string) => {
    setDismissed((prev) => ({ ...prev, [slug]: Date.now() + DISMISS_DURATION_MS }))
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 64,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 320,
      }}
    >
      {visibleAlerts.slice(0, 5).map((alert) => {
        const c = alertColor(alert.pressurePct)
        return (
          <div
            key={alert.slug}
            style={{
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 8,
              padding: '10px 14px',
              fontFamily: 'monospace',
              fontSize: 12,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              boxShadow: `0 0 12px ${c.border}40`,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ color: c.text, fontWeight: 700 }}>{alert.slug}</span>
                <span style={{
                  background: c.border + '30', color: c.text,
                  borderRadius: 3, padding: '1px 5px', fontSize: 10, fontWeight: 700,
                }}>
                  {alert.pressurePct}%
                </span>
              </div>
              <div style={{ color: '#64748B', fontSize: 11 }}>
                {alert.burnRatePerHour > 0
                  ? `~${etaLabel(alert.eta)} until limit`
                  : 'High context pressure'}
                {alert.burnRatePerHour > 0 && (
                  <span style={{ marginLeft: 6, color: '#475569' }}>
                    ({alert.burnRatePerHour.toLocaleString()} tok/h)
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => dismiss(alert.slug)}
              title="Dismiss for 10 minutes"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#475569', fontSize: 16, lineHeight: 1,
                padding: 0, flexShrink: 0,
              }}
            >×</button>
          </div>
        )
      })}
      {visibleAlerts.length > 5 && (
        <div style={{
          color: '#64748B', fontSize: 11, textAlign: 'right', fontFamily: 'monospace',
        }}>
          +{visibleAlerts.length - 5} more high-pressure projects
        </div>
      )}
    </div>
  )
}

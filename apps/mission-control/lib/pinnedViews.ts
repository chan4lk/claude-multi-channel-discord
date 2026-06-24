'use client'

// P184 — Pinned Views: a small localStorage-backed store of pinned nav hrefs,
// shared between NavDropdown (the star toggles) and PinnedViewsBar (the chips).
// Changes broadcast via a custom window event so both components stay in sync
// within the same tab; the native `storage` event covers other tabs.

import { useEffect, useState } from 'react'

export const PINNED_KEY = 'mc:pinnedViews'
export const MAX_PINS = 8
const CHANGE_EVENT = 'mc:pins-changed'

export function readPins(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === 'string') : []
  } catch {
    return []
  }
}

function writePins(pins: string[]): void {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(pins))
  } catch {
    /* ignore quota / disabled storage */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

/**
 * Toggle a pin. Returns true if the change was applied, false if it was a
 * no-op because the cap was already reached (caller can surface a hint).
 */
export function togglePin(href: string): boolean {
  const pins = readPins()
  const idx = pins.indexOf(href)
  if (idx >= 0) {
    pins.splice(idx, 1)
    writePins(pins)
    return true
  }
  if (pins.length >= MAX_PINS) return false
  pins.push(href)
  writePins(pins)
  return true
}

/** Reactive view of the pinned hrefs in pin order. */
export function usePinnedViews(): string[] {
  const [pins, setPins] = useState<string[]>([])
  useEffect(() => {
    setPins(readPins())
    const refresh = () => setPins(readPins())
    window.addEventListener(CHANGE_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  return pins
}

'use client'

import { useEffect, useState } from 'react'

interface InstanceEntry {
  instance_id: string
  host: string
  user: string
  api_key: string
  last_seen: string | null
  created_at: string
}

function isStale(lastSeen: string | null): boolean {
  if (!lastSeen) return true
  const diff = Date.now() - new Date(lastSeen).getTime()
  return diff > 5 * 60 * 1000
}

function formatRelative(ts: string | null): string {
  if (!ts) return 'never'
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function InstanceGrid() {
  const [instances, setInstances] = useState<InstanceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function fetchInstances() {
    try {
      const res = await fetch('/api/instances')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: InstanceEntry[] = await res.json()
      setInstances(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load instances')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchInstances()
    const interval = setInterval(fetchInstances, 30_000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="text-gray-500 text-sm py-4 text-center">Loading instances…</div>
    )
  }

  if (error) {
    return (
      <div className="text-red-400 text-sm py-4 text-center">Error: {error}</div>
    )
  }

  if (instances.length === 0) {
    return (
      <div className="text-gray-500 text-sm py-4 text-center">No instances registered.</div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {instances.map((inst) => {
        const stale = isStale(inst.last_seen)
        return (
          <div
            key={inst.instance_id}
            className="rounded-lg bg-gray-900 border border-gray-700 px-4 py-3 flex flex-col gap-1 hover:border-gray-500 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-base font-bold text-gray-100 truncate" title={inst.host}>
                {inst.host}
              </span>
              {stale ? (
                <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold bg-gray-700 text-gray-400">
                  stale
                </span>
              ) : (
                <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold bg-green-800 text-green-300">
                  active
                </span>
              )}
            </div>
            <span className="text-sm text-gray-400 truncate" title={inst.user}>
              {inst.user}
            </span>
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-gray-600 font-mono" title={inst.instance_id}>
                {inst.instance_id.slice(0, 8)}
              </span>
              <span className="text-xs text-gray-500">
                {formatRelative(inst.last_seen)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

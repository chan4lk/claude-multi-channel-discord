import { getWebhooks, getWebhookDeliveriesSince } from '../../../src/db'

export const dynamic = 'force-dynamic'

const DAYS_BACK = 7

export interface WebhookHealthCard {
  id: number
  name: string
  url: string
  enabled: boolean
  total: number
  success: number
  failed: number
  successRate: number // 0–100; 100 when no deliveries
  recentFailures: number // failures in the window
  lastFailureTs: number | null
  lastError: string | null
  codes: { code: string; count: number }[] // response-code distribution, desc
  daily: number[] // per-day volume, oldest→newest, length DAYS_BACK
}

export interface WebhookHealthResponse {
  cards: WebhookHealthCard[]
  overallRate: number // 0–100 across all deliveries
  totalDeliveries: number
  degraded: number // cards below the healthy threshold with traffic
  windowDays: number
}

const HEALTHY_RATE = 99

export async function GET(): Promise<Response> {
  const nowSec = Math.floor(Date.now() / 1000)
  const sinceTs = nowSec - DAYS_BACK * 86400
  const webhooks = getWebhooks()
  const deliveries = getWebhookDeliveriesSince(sinceTs)

  // Bucket deliveries by webhook_id.
  const byHook = new Map<number, typeof deliveries>()
  for (const d of deliveries) {
    const arr = byHook.get(d.webhook_id) ?? []
    arr.push(d)
    byHook.set(d.webhook_id, arr)
  }

  let totalAll = 0
  let successAll = 0

  const cards: WebhookHealthCard[] = webhooks.map((w) => {
    const rows = byHook.get(w.id) ?? []
    const total = rows.length
    const success = rows.filter((r) => r.status === 'success').length
    const failed = total - success
    totalAll += total
    successAll += success

    // Daily volume buckets, oldest→newest.
    const daily = new Array<number>(DAYS_BACK).fill(0)
    for (const r of rows) {
      const dayIdx = Math.floor((r.ts - sinceTs) / 86400)
      if (dayIdx >= 0 && dayIdx < DAYS_BACK) daily[dayIdx]++
    }

    // Response-code distribution.
    const codeMap = new Map<string, number>()
    let lastFailureTs: number | null = null
    let lastError: string | null = null
    for (const r of rows) {
      const code = r.response_code != null ? String(r.response_code) : (r.status === 'timeout' ? 'timeout' : 'err')
      codeMap.set(code, (codeMap.get(code) ?? 0) + 1)
      if (r.status !== 'success') {
        // rows are oldest-first, so the last failure seen is the most recent
        lastFailureTs = r.ts
        lastError = r.error ?? `HTTP ${r.response_code ?? '?'}`
      }
    }
    const codes = [...codeMap.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count)

    return {
      id: w.id,
      name: w.name || w.url,
      url: w.url,
      enabled: w.enabled === 1,
      total,
      success,
      failed,
      successRate: total === 0 ? 100 : Math.round((success / total) * 1000) / 10,
      recentFailures: failed,
      lastFailureTs,
      lastError,
      codes,
      daily,
    }
  })

  // Sort worst health first (lowest rate, then most traffic).
  cards.sort((a, b) => a.successRate - b.successRate || b.total - a.total)

  const degraded = cards.filter((c) => c.total > 0 && c.successRate < HEALTHY_RATE).length

  return Response.json({
    cards,
    overallRate: totalAll === 0 ? 100 : Math.round((successAll / totalAll) * 1000) / 10,
    totalDeliveries: totalAll,
    degraded,
    windowDays: DAYS_BACK,
  } satisfies WebhookHealthResponse)
}

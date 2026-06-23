// Composite "attention" scoring shared by the Attention Scoreboard (P174)
// and the Attention Heat Strip (P177). Single source of truth for the
// four-factor formula so the two views can never drift apart.
import type { FleetProject } from '../app/api/fleet/route'

export type FactorKey = 'budget' | 'headroom' | 'context' | 'queue'

export interface Factor {
  key: FactorKey
  label: string
  color: string
  score: number // 0..1
}

export interface AttentionScore {
  slug: string
  total: number // 0..100
  factors: Factor[]
  reason: string
}

// Each factor is scored 0..1 and weighted equally into the 0..100 composite.
export const WEIGHT = 0.25
export const ATTENTION_THRESHOLD = 50 // composite score that flags "needs attention"

export const FACTOR_META: Record<FactorKey, { label: string; color: string }> = {
  budget: { label: 'budget', color: '#ef4444' },
  headroom: { label: 'reap', color: '#f59e0b' },
  context: { label: 'context', color: '#22d3ee' },
  queue: { label: 'queue', color: '#a78bfa' },
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

export function scoreProject(p: FleetProject): AttentionScore {
  // Budget: usage fraction, floored up when status escalates.
  let budget = 0
  if (p.monthlyTokenBudget && p.monthlyTokenBudget > 0) {
    budget = clamp01((p.monthlyTokensUsed ?? 0) / p.monthlyTokenBudget)
  }
  if (p.budgetStatus === 'critical') budget = Math.max(budget, 0.8)
  if (p.budgetStatus === 'exhausted') budget = 1

  // Headroom: how close idle age is to the watchdog reap line.
  const headroom = p.stuckThresholdMinutes > 0 ? clamp01(p.ageMins / p.stuckThresholdMinutes) : 0

  // Context: urgency inverse of fill ETA (0m→1, ≥120m→0).
  let context = 0
  if (p.contextFillEtaMinutes != null && Number.isFinite(p.contextFillEtaMinutes)) {
    context = clamp01(1 - p.contextFillEtaMinutes / 120)
  }

  // Queue/circuit: open breaker is max; otherwise scale queue depth.
  const queue = p.circuitOpen ? 1 : clamp01((p.queuedCount ?? 0) / 5)

  const factors: Factor[] = [
    { key: 'budget', ...FACTOR_META.budget, score: budget },
    { key: 'headroom', ...FACTOR_META.headroom, score: headroom },
    { key: 'context', ...FACTOR_META.context, score: context },
    { key: 'queue', ...FACTOR_META.queue, score: queue },
  ]
  const total = factors.reduce((s, f) => s + f.score * WEIGHT, 0) * 100

  // Dominant factor → human reason tag.
  const dom = factors.reduce((a, b) => (b.score > a.score ? b : a))
  let reason = 'nominal'
  if (dom.score > 0.05) {
    if (dom.key === 'budget') reason = p.budgetStatus === 'exhausted' ? 'budget exhausted' : p.budgetStatus === 'critical' ? 'budget critical' : 'budget pressure'
    else if (dom.key === 'headroom') reason = headroom >= 0.85 ? 'near-reap' : 'idling'
    else if (dom.key === 'context') reason = 'context filling'
    else reason = p.circuitOpen ? 'breaker open' : 'queue backlog'
  }

  return { slug: p.slug, total, factors, reason }
}

// Green→amber→red ramp for a 0..100 attention score.
export function attentionColor(total: number): string {
  if (total >= ATTENTION_THRESHOLD) return '#ef4444'
  if (total >= 25) return '#f59e0b'
  if (total >= 10) return '#a3e635'
  return '#34d399'
}

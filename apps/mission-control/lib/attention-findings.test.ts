import { test, expect } from 'bun:test'
import {
  RULES,
  toAdvisorCards,
  toBriefResult,
  sevOrder,
  type Finding,
  type FleetSignals,
} from './attention-findings'

// A FleetSignals fixture with benign defaults; override per test.
function signals(overrides: Partial<FleetSignals> = {}): FleetSignals {
  return {
    slug: 'alpha', chatId: 'c1', isScheduled: false,
    ageMs: 0, ageMins: 0, ageHours: 0, ageDays: 0,
    contextPct: null, churn: 0, convDelta: null, highChurn: false,
    openAlerts: 0, memAgeDays: null, monthlyTokenBudget: undefined,
    monthlyUsed: undefined, circuitOpen: false,
    ...overrides,
  }
}

function runRules(s: FleetSignals): Finding[] {
  const out: Finding[] = []
  for (const rule of RULES) {
    const f = rule(s, { medianChurn: 0 })
    if (f) out.push(f)
  }
  return out
}

test('thrashing fires for declining convergence + high churn', () => {
  const found = runRules(signals({ convDelta: -0.05, churn: 100, highChurn: true }))
  expect(found.some((f) => f.signal === 'thrashing')).toBe(true)
})

test('circuit-open finding carries a command action', () => {
  const found = runRules(signals({ circuitOpen: true }))
  const circuit = found.find((f) => f.signal === 'circuit')
  expect(circuit?.action?.type).toBe('command')
})

test('a finding with an action surfaces in BOTH advisor and brief', () => {
  // The shared rule set is the single source — any actionable finding must
  // appear as an advisor card AND as a brief card (P208 AC5).
  const found = runRules(signals({ contextPct: 96 }))
  const ctx = found.find((f) => f.signal === 'context')
  expect(ctx).toBeDefined()

  const cards = toAdvisorCards(found)
  expect(cards.some((c) => c.id === ctx!.id)).toBe(true)

  const brief = toBriefResult(found, /* hasProjects */ true)
  expect(brief.findings.some((b) => b.message === ctx!.message)).toBe(true)
})

test('alert finding (no action) is brief-only, never an advisor card', () => {
  const found = runRules(signals({ openAlerts: 4 }))
  const alert = found.find((f) => f.signal === 'alerts')
  expect(alert).toBeDefined()
  expect(toAdvisorCards(found).some((c) => c.id === alert!.id)).toBe(false)
  expect(toBriefResult(found, true).findings.some((b) => b.message === alert!.message)).toBe(true)
})

test('all-nominal brief collapses to a single ok card', () => {
  const brief = toBriefResult([], /* hasProjects */ true)
  expect(brief.fleetStatus).toBe('nominal')
  expect(brief.findings).toHaveLength(1)
  expect(brief.findings[0].severity).toBe('ok')
})

test('empty fleet yields empty brief', () => {
  const brief = toBriefResult([], /* hasProjects */ false)
  expect(brief.fleetStatus).toBe('empty')
  expect(brief.findings).toHaveLength(0)
})

test('severity ordering: critical < warn < info < ok', () => {
  expect(sevOrder('critical')).toBeLessThan(sevOrder('warn'))
  expect(sevOrder('warn')).toBeLessThan(sevOrder('info'))
  expect(sevOrder('info')).toBeLessThan(sevOrder('ok'))
})

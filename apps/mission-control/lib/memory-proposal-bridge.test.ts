import { test, expect } from 'bun:test'
import { themeTokens, computeBridge, type BridgeMemory, type BridgeProposal } from './memory-proposal-bridge'

test('themeTokens drops stopwords and short tokens, stems trailing s', () => {
  const t = themeTokens('The scheduler fires schedules over the fleet')
  expect(t.has('scheduler')).toBe(true)
  expect(t.has('schedule')).toBe(true) // "schedules" stemmed
  expect(t.has('the')).toBe(false)
  expect(t.has('fleet')).toBe(false) // stopword
  expect(t.has('over')).toBe(false)
})

test('computeBridge links a memory and proposal sharing >= threshold terms', () => {
  const memories: BridgeMemory[] = [
    { id: 'm1', slug: 'alpha', text: 'Scheduler watchdog kills stuck claude subprocess after timeout' },
    { id: 'm2', slug: 'alpha', text: 'Unrelated note about discord chunking limits' },
  ]
  const proposals: BridgeProposal[] = [
    { id: 'p1', slug: 'alpha', title: 'Scheduler watchdog tuning', text: 'Scheduler watchdog tuning. The watchdog timeout for stuck subprocess needs tuning' },
  ]
  const g = computeBridge(memories, proposals, 2)
  expect(g.edges.length).toBe(1)
  expect(g.edges[0]!.source).toBe('m1')
  expect(g.edges[0]!.target).toBe('p1')
  expect(g.edges[0]!.weight).toBeGreaterThanOrEqual(2)
  expect(g.edges[0]!.terms).toContain('watchdog')
  // m2 has no overlap → dropped from node set
  expect(g.memories.map((n) => n.id)).toEqual(['m1'])
  expect(g.proposals.map((n) => n.id)).toEqual(['p1'])
})

test('threshold is tunable and excludes weak overlaps', () => {
  const memories: BridgeMemory[] = [{ id: 'm1', slug: 'a', text: 'budget alert threshold tracking' }]
  const proposals: BridgeProposal[] = [{ id: 'p1', slug: 'a', title: 'Budget pressure view', text: 'Budget pressure view for tracking spend' }]
  // share "budget" + "tracking" = 2 terms
  expect(computeBridge(memories, proposals, 2).edges.length).toBe(1)
  expect(computeBridge(memories, proposals, 3).edges.length).toBe(0)
})

test('empty inputs yield empty graph', () => {
  const g = computeBridge([], [], 2)
  expect(g.memories).toEqual([])
  expect(g.proposals).toEqual([])
  expect(g.edges).toEqual([])
})

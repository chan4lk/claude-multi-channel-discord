/**
 * bun src/org-graph.test.ts
 * Unit tests for the org-graph model builder and text/mermaid renderers.
 */
import { ChannelsConfigSchema } from './channels-config.ts'
import type { ChannelsConfig } from './channels-config.ts'
import {
  buildOrgGraph,
  renderGraphMermaid,
  renderGraphText,
  type GraphInputs,
} from './org-graph.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`${status}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

const MASTER_CHAT = '100000000000000000'
const ALPHA_CHAT = '100000000000000001'
const BETA_CHAT = '100000000000000002'
const GAMMA_CHAT = '100000000000000003'
const BOT_ID = '222222222222222222'
const NOW = 1_800_000_000_000

function makeConfig(overrides: Record<string, any> = {}): ChannelsConfig {
  return ChannelsConfigSchema.parse({
    master: { chatId: MASTER_CHAT },
    projects: {
      [MASTER_CHAT]: { slug: 'master' },
      [ALPHA_CHAT]: { slug: 'alpha' },
      [BETA_CHAT]: { slug: 'beta' },
      ...overrides,
    },
  })
}

function edgeBetween(graph: ReturnType<typeof buildOrgGraph>, fromLabel: string, toLabel: string) {
  const byId = new Map(graph.nodes.map(n => [n.id, n.label]))
  return graph.edges.find(e => byId.get(e.from) === fromLabel && byId.get(e.to) === toLabel)
}

// ---------------------------------------------------------------------------
// AC1 — mutual vs one-way peer edges
// ---------------------------------------------------------------------------
{
  const mutual = makeConfig({
    [ALPHA_CHAT]: { slug: 'alpha', peers: { allow: ['beta'] } },
    [BETA_CHAT]: { slug: 'beta', peers: { allow: ['alpha'] } },
  })
  const g = buildOrgGraph(mutual)
  const peerEdges = g.edges.filter(e => e.kind === 'peer')
  check('AC1: mutual peers → single edge', peerEdges.length === 1, `got ${peerEdges.length}`)
  check('AC1: mutual edge marked mutual', peerEdges[0]?.mutual === true)
  check('AC1: text renders ↔', renderGraphText(g).includes('↔ beta (peers)'))

  const oneWay = makeConfig({
    [ALPHA_CHAT]: { slug: 'alpha', peers: { allow: ['beta'] } },
  })
  const g2 = buildOrgGraph(oneWay)
  const e2 = edgeBetween(g2, 'alpha', 'beta')
  check('AC1: one-way edge not mutual', e2?.mutual === false)
  check('AC1: text marks one-way', renderGraphText(g2).includes('one-way — no consent back'))
}

// ---------------------------------------------------------------------------
// AC2 — role edges: resolvable vs stale
// ---------------------------------------------------------------------------
{
  const ok = makeConfig({
    [ALPHA_CHAT]: { slug: 'alpha', handoff: true, collab: { roles: { reviewer: 'beta' } } },
  })
  const g = buildOrgGraph(ok)
  const e = edgeBetween(g, 'alpha', 'beta')
  check('AC2: resolvable role edge exists', e?.kind === 'role' && e.role === 'reviewer')
  check('AC2: resolvable role not stale', e?.stale !== true)
  check('AC2: text renders role arrow', renderGraphText(g).includes('—reviewer→ beta'))

  const stale = makeConfig({
    [ALPHA_CHAT]: { slug: 'alpha', handoff: true, collab: { roles: { reviewer: 'deleted-proj' } } },
  })
  const g2 = buildOrgGraph(stale)
  const e2 = edgeBetween(g2, 'alpha', 'deleted-proj')
  check('AC2: stale role edge marked stale', e2?.stale === true)
  check('AC2: stale warning line present', g2.warnings.some(w => w.includes('reviewer') && w.includes('stale')))
  check('AC2: text renders (stale)', renderGraphText(g2).includes('(stale)'))
}

// ---------------------------------------------------------------------------
// AC3 — role configured while handoff flag off → dead edge warning
// ---------------------------------------------------------------------------
{
  const cfg = makeConfig({
    [ALPHA_CHAT]: { slug: 'alpha', collab: { roles: { reviewer: 'beta' } } },
  })
  const g = buildOrgGraph(cfg)
  check(
    'AC3: dead-edge warning names project + role',
    g.warnings.some(w => w.includes('alpha') && w.includes('reviewer') && w.includes('handoff flag off')),
  )
  const e = edgeBetween(g, 'alpha', 'beta')
  check('AC3: role edge marked dead', e?.dead === true)

  const on = makeConfig({
    [ALPHA_CHAT]: { slug: 'alpha', handoff: true, collab: { roles: { reviewer: 'beta' } } },
  })
  check('AC3: no dead warning when handoff on', buildOrgGraph(on).warnings.length === 0)
}

// ---------------------------------------------------------------------------
// AC4 — botPeers.allow → bot node + edge; shared bot dedups to one node
// ---------------------------------------------------------------------------
{
  const cfg = makeConfig({
    [ALPHA_CHAT]: { slug: 'alpha', botPeers: { allow: [BOT_ID] } },
    [BETA_CHAT]: { slug: 'beta', botPeers: { allow: [BOT_ID] } },
  })
  const g = buildOrgGraph(cfg)
  const botNodes = g.nodes.filter(n => n.kind === 'bot')
  check('AC4: single bot node for shared id', botNodes.length === 1, `got ${botNodes.length}`)
  check('AC4: bot node labelled', botNodes[0]?.label === `bot:${BOT_ID}`)
  const botEdges = g.edges.filter(e => e.kind === 'botPeer')
  check('AC4: two edges to shared bot', botEdges.length === 2)
  check('AC4: text renders bot peer edge', renderGraphText(g).includes(`⇢ bot:${BOT_ID} (bot peer)`))
}

// ---------------------------------------------------------------------------
// AC5 — decorations: disabled ⛔, autopilot 🤖, hermes 🛰; disabled never hidden
// ---------------------------------------------------------------------------
{
  const cfg = makeConfig({
    [ALPHA_CHAT]: { slug: 'alpha', disabled: true },
    [BETA_CHAT]: { slug: 'beta', autopilot: { enabled: true }, hermes: { enabled: true } },
  })
  const g = buildOrgGraph(cfg)
  const alpha = g.nodes.find(n => n.label === 'alpha')
  const beta = g.nodes.find(n => n.label === 'beta')
  check('AC5: disabled node present', alpha !== undefined)
  check('AC5: disabled flag set', alpha?.disabled === true)
  check('AC5: autopilot + hermes flags set', beta?.autopilot === true && beta?.hermes === true)
  const text = renderGraphText(g)
  check('AC5: text shows ⛔ 🤖 🛰', text.includes('⛔') && text.includes('🤖') && text.includes('🛰'))
}

// ---------------------------------------------------------------------------
// AC6 — schedule self-loops: enabled only, cadence summaries
// ---------------------------------------------------------------------------
{
  const cfg = makeConfig()
  const inputs: GraphInputs = {
    schedules: [
      { chatId: ALPHA_CHAT, enabled: true, at: '09:00' },
      { chatId: ALPHA_CHAT, enabled: false, interval: 'every 5m' },
      { chatId: BETA_CHAT, enabled: true, interval: 'every 30m' },
      { chatId: MASTER_CHAT, enabled: true, cron: '*/5 * * * *' },
    ],
  }
  const g = buildOrgGraph(cfg, inputs)
  const alpha = g.nodes.find(n => n.label === 'alpha')
  const beta = g.nodes.find(n => n.label === 'beta')
  const master = g.nodes.find(n => n.label === 'master')
  check('AC6: daily cadence on alpha', alpha?.schedules.join() === 'daily 09:00')
  check('AC6: paused schedule omitted', !alpha?.schedules.some(s => s.includes('5m')))
  check('AC6: interval cadence on beta', beta?.schedules.join() === 'every 30m')
  check('AC6: cron cadence on master', master?.schedules.join() === 'cron */5 * * * *')
  check('AC6: text renders ⏰', renderGraphText(g).includes('⏰ daily 09:00'))
}

// ---------------------------------------------------------------------------
// AC7 — stats overlay: open handoffs, idle age, warm/cold + degradation
// ---------------------------------------------------------------------------
{
  const cfg = makeConfig({
    [ALPHA_CHAT]: { slug: 'alpha', handoff: true, collab: { roles: { reviewer: 'beta' } } },
  })
  const inputs: GraphInputs = {
    nowMs: NOW,
    handoffs: [
      { state: 'pending', from: 'alpha', to: { kind: 'project', slug: 'beta', chatId: BETA_CHAT } },
      { state: 'pending', from: 'alpha', to: { kind: 'project', slug: 'beta', chatId: BETA_CHAT } },
      { state: 'done', from: 'alpha', to: { kind: 'project', slug: 'beta', chatId: BETA_CHAT } },
      { state: 'pending', from: 'ghost', to: { kind: 'project', slug: 'nowhere', chatId: '9'.repeat(18) } },
    ],
    activityMtimeMs: { [ALPHA_CHAT]: NOW - 3 * 60_000 },
    poolAlive: { [ALPHA_CHAT]: true },
  }
  const g = buildOrgGraph(cfg, inputs)
  const e = edgeBetween(g, 'alpha', 'beta')
  check('AC7: pending handoffs counted on edge', e?.openHandoffs === 2, `got ${e?.openHandoffs}`)
  const alpha = g.nodes.find(n => n.label === 'alpha')
  const beta = g.nodes.find(n => n.label === 'beta')
  check('AC7: idle age computed', alpha?.idleMs === 3 * 60_000)
  check('AC7: never-used project idle null', beta?.idleMs === null)
  check('AC7: warm from poolAlive', alpha?.warm === true && beta?.warm === false)
  const text = renderGraphText(g, { stats: true })
  check('AC7: text shows [2 open]', text.includes('[2 open]'))
  check('AC7: text shows warm + idle', text.includes('[warm, idle 3m]'))
  check('AC7: text shows idle never', text.includes('idle never'))

  // Degradation: no poolAlive at all → warm null, no warm/cold token in text.
  const g2 = buildOrgGraph(cfg, { nowMs: NOW })
  const a2 = g2.nodes.find(n => n.label === 'alpha')
  check('AC7: warm null without pool data', a2?.warm === null)
  const t2 = renderGraphText(g2, { stats: true })
  check('AC7: degraded stats omit warm/cold', !t2.includes('warm') && !t2.includes('cold'))
  check('AC7: stats off → no idle text', !renderGraphText(g2).includes('idle'))
}

// ---------------------------------------------------------------------------
// AC8 — mermaid output: fence, graph LR, sanitized ids, hostile slugs
// ---------------------------------------------------------------------------
{
  // Hostile ids: dashed slug (schema-legal), bot id (digit-leading label),
  // stale role value with dots/digits (role values are free strings).
  const cfg = makeConfig({
    [ALPHA_CHAT]: {
      slug: 'a-b',
      peers: { allow: ['beta'] },
      handoff: true,
      botPeers: { allow: [BOT_ID] },
      collab: { roles: { odd: '42-gone.x' } },
    },
    [GAMMA_CHAT]: { slug: 'gamma' },
  })
  const g = buildOrgGraph(cfg)
  const mermaid = renderGraphMermaid(g)
  check('AC8: starts with ```mermaid', mermaid.startsWith('```mermaid'))
  check('AC8: contains graph LR', mermaid.includes('graph LR'))
  check('AC8: ends with ```', mermaid.endsWith('```'))
  const idLines = mermaid.split('\n').filter(l => /^\s{2}\S+\[/.test(l))
  const idsOk = idLines.every(l => /^\s{2}[A-Za-z_][A-Za-z0-9_]*\[/.test(l))
  check('AC8: all node ids sanitized', idsOk, idLines.join(' | '))
  check('AC8: label keeps raw slug', mermaid.includes('["a-b'))
  check('AC8: digit-leading ghost label prefixed', mermaid.includes('n_42_gone_x['))

  // Stale edge renders dotted.
  const stale = makeConfig({
    [ALPHA_CHAT]: { slug: 'alpha', handoff: true, collab: { roles: { reviewer: 'gone' } } },
  })
  const m2 = renderGraphMermaid(buildOrgGraph(stale))
  check('AC8: stale edge dotted', m2.includes('-.->'))
  check('AC8: mermaid excludes warnings', !m2.includes('⚠'))
}

// ---------------------------------------------------------------------------
// Edge cases — empty registry, id collisions, self/master peer refs
// ---------------------------------------------------------------------------
{
  const empty = ChannelsConfigSchema.parse({ master: { chatId: MASTER_CHAT }, projects: {} })
  const g = buildOrgGraph(empty)
  check('edge: empty registry → master node only', g.nodes.length === 1 && g.nodes[0]?.label === 'master')
  check('edge: empty registry text no throw', renderGraphText(g).includes('_no projects_'))

  const collide = makeConfig({
    [ALPHA_CHAT]: { slug: 'a-b' },
    [BETA_CHAT]: { slug: 'a_b' },
  })
  const g2 = buildOrgGraph(collide)
  const ids = g2.nodes.map(n => n.id)
  check('edge: id collision suffixed unique', new Set(ids).size === ids.length, ids.join(','))

  const invalid = makeConfig({
    [ALPHA_CHAT]: { slug: 'alpha', peers: { allow: ['alpha', 'master', 'nosuch'] } },
  })
  const g3 = buildOrgGraph(invalid)
  check('edge: self peer ref warned', g3.warnings.some(w => w.includes('references itself')))
  check('edge: master peer ref warned', g3.warnings.some(w => w.includes('master project')))
  check('edge: unknown peer slug warned', g3.warnings.some(w => w.includes('unknown slug "nosuch"')))
  check('edge: invalid refs produce no edges', g3.edges.length === 0)
}

console.log(failed === 0 ? '\nAll org-graph checks passed.' : `\n${failed} check(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)

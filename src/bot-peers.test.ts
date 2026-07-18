/**
 * bun src/bot-peers.test.ts
 * Unit tests for BotPeerGate and effectiveBotPeerLimits.
 * Run: bun src/bot-peers.test.ts
 */
import { BotPeerGate, effectiveBotPeerLimits, effectiveStatusPatterns, isStatusPost } from './bot-peers.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`${status}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

// ---------------------------------------------------------------------------
// effectiveBotPeerLimits — fallback resolution
// ---------------------------------------------------------------------------
{
  // All defaults
  const lim = effectiveBotPeerLimits({}, {})
  check('limits: built-in maxConsecutive = 5', lim.maxConsecutive === 5)
  check('limits: built-in cooldownSeconds = 30', lim.cooldownSeconds === 30)
}
{
  // defaults override built-in
  const lim = effectiveBotPeerLimits({ botPeers: { maxConsecutive: 3, cooldownSeconds: 60 } }, {})
  check('limits: defaults.maxConsecutive wins over built-in', lim.maxConsecutive === 3)
  check('limits: defaults.cooldownSeconds wins over built-in', lim.cooldownSeconds === 60)
}
{
  // project overrides defaults
  const lim = effectiveBotPeerLimits(
    { botPeers: { maxConsecutive: 3, cooldownSeconds: 60 } },
    { botPeers: { maxConsecutive: 7, cooldownSeconds: 10 } },
  )
  check('limits: project.maxConsecutive wins over defaults', lim.maxConsecutive === 7)
  check('limits: project.cooldownSeconds wins over defaults', lim.cooldownSeconds === 10)
}
{
  // partial project override
  const lim = effectiveBotPeerLimits(
    { botPeers: { maxConsecutive: 3 } },
    { botPeers: { cooldownSeconds: 15 } },
  )
  check('limits: partial project override — maxConsecutive from defaults', lim.maxConsecutive === 3)
  check('limits: partial project override — cooldownSeconds from project', lim.cooldownSeconds === 15)
}

// ---------------------------------------------------------------------------
// BotPeerGate — counter progression
// ---------------------------------------------------------------------------
{
  let t = 1000
  const gate = new BotPeerGate(() => t)
  const limits = { maxConsecutive: 2, cooldownSeconds: 0 }
  const ch = 'ch1'

  const r1 = gate.check(ch, limits)
  check('counter: first message → deliver', r1.action === 'deliver')
  gate.recordDelivery(ch)

  t += 1  // advance past zero-cooldown window
  const r2 = gate.check(ch, limits)
  check('counter: second message → deliver', r2.action === 'deliver')
  gate.recordDelivery(ch)

  t += 1
  const r3 = gate.check(ch, limits)
  check('counter: third message → limit', r3.action === 'limit')
  check('counter: third message → notify=true (latch fires)', r3.action === 'limit' && (r3 as { action: 'limit'; notify: boolean }).notify === true)
}

// ---------------------------------------------------------------------------
// BotPeerGate — notice latch fires exactly once
// ---------------------------------------------------------------------------
{
  let t = 1000
  const gate = new BotPeerGate(() => t)
  const limits = { maxConsecutive: 1, cooldownSeconds: 0 }
  const ch = 'ch-latch'

  gate.recordDelivery(ch)  // simulate one prior delivery (counter = 1)

  t += 1
  const r1 = gate.check(ch, limits)
  check('latch: first over-limit → notify=true', r1.action === 'limit' && (r1 as { action: 'limit'; notify: boolean }).notify === true)

  t += 1
  const r2 = gate.check(ch, limits)
  check('latch: second over-limit → notify=false (latch held)', r2.action === 'limit' && (r2 as { action: 'limit'; notify: boolean }).notify === false)

  t += 1
  const r3 = gate.check(ch, limits)
  check('latch: third over-limit → notify still false', r3.action === 'limit' && (r3 as { action: 'limit'; notify: boolean }).notify === false)
}

// ---------------------------------------------------------------------------
// BotPeerGate — cooldown drop does NOT increment counter
// ---------------------------------------------------------------------------
{
  let t = 1000
  const gate = new BotPeerGate(() => t)
  const limits = { maxConsecutive: 2, cooldownSeconds: 30 }
  const ch = 'ch-cooldown'

  const r1 = gate.check(ch, limits)
  check('cooldown: first message → deliver', r1.action === 'deliver')
  gate.recordDelivery(ch)  // counter = 1, lastDelivery = 1000

  // within cooldown window (t still 1000)
  const r2 = gate.check(ch, limits)
  check('cooldown: immediate re-send → drop-cooldown', r2.action === 'drop-cooldown')

  // cooldown dropped message must not increment counter — verify by checking
  // that delivering past cooldown window still counts toward maxConsecutive
  t = 1000 + 30 * 1000 + 1  // just past cooldown
  const r3 = gate.check(ch, limits)
  check('cooldown: after window → deliver (counter still 1)', r3.action === 'deliver')
  gate.recordDelivery(ch)  // counter = 2, lastDelivery = t

  t = t + 30 * 1000 + 1  // advance past the cooldown for the second delivery
  const r4 = gate.check(ch, limits)
  check('cooldown: maxConsecutive=2, counter=2 → limit', r4.action === 'limit')
}

// ---------------------------------------------------------------------------
// BotPeerGate — human reset clears counter and latch
// ---------------------------------------------------------------------------
{
  let t = 1000
  const gate = new BotPeerGate(() => t)
  const limits = { maxConsecutive: 1, cooldownSeconds: 0 }
  const ch = 'ch-human'

  gate.recordDelivery(ch)  // counter = 1

  t += 1
  const r1 = gate.check(ch, limits)
  check('human-reset: before reset → limit (notify=true)', r1.action === 'limit' && (r1 as { action: 'limit'; notify: boolean }).notify === true)

  // latch is now set; human message arrives
  gate.recordHuman(ch)

  t += 1
  const r2 = gate.check(ch, limits)
  check('human-reset: after recordHuman → deliver', r2.action === 'deliver')
  gate.recordDelivery(ch)  // counter = 1 again

  t += 1
  const r3 = gate.check(ch, limits)
  check('human-reset: latch also cleared — notice fires again after reset', r3.action === 'limit' && (r3 as { action: 'limit'; notify: boolean }).notify === true)
}

// ---------------------------------------------------------------------------
// BotPeerGate — limit lowered below current counter (edge case)
// ---------------------------------------------------------------------------
{
  let t = 1000
  const gate = new BotPeerGate(() => t)
  const ch = 'ch-lowered'

  // Deliver 3 messages under a permissive limit
  for (let i = 0; i < 3; i++) {
    t += 1
    const r = gate.check(ch, { maxConsecutive: 10, cooldownSeconds: 0 })
    check(`limit-lowered: delivery ${i + 1}/3 → deliver`, r.action === 'deliver')
    gate.recordDelivery(ch)
  }

  // Now lower limit to 2 (below current counter of 3)
  t += 1
  const r = gate.check(ch, { maxConsecutive: 2, cooldownSeconds: 0 })
  check('limit-lowered: counter(3) >= lowered maxConsecutive(2) → limit immediately', r.action === 'limit')
}

// ---------------------------------------------------------------------------
// BotPeerGate — independent channels don't share state
// ---------------------------------------------------------------------------
{
  let t = 1000
  const gate = new BotPeerGate(() => t)
  const limits = { maxConsecutive: 1, cooldownSeconds: 0 }

  gate.recordDelivery('ch-a')  // ch-a counter = 1

  t += 1
  const ra = gate.check('ch-a', limits)
  const rb = gate.check('ch-b', limits)
  check('isolation: ch-a at limit', ra.action === 'limit')
  check('isolation: ch-b unaffected → deliver', rb.action === 'deliver')
}

// ---------------------------------------------------------------------------
// isStatusPost — status-post classification (P310)
// ---------------------------------------------------------------------------
{
  // Built-in defaults match observed shapes
  check('status: ⏳ progress tick matches built-ins', isStatusPost('⏳ Still working... (12 min elapsed — iteration 34/90)'))
  check('status: (no content) matches built-ins', isStatusPost('(no content)'))
  check('status: empty body matches built-ins', isStatusPost(''))
  check('status: whitespace-only body matches built-ins', isStatusPost('   '))
  check('status: substantive message does not match', !isStatusPost('Can you review PR #2? The fraud-scoring change is ready.'))
  check('status: hourglass mid-sentence does not match (anchored)', !isStatusPost('the ⏳ emoji means waiting'))
}
{
  // Explicit empty array disables the exemption
  check('status: [] disables exemption for ⏳ tick', !isStatusPost('⏳ Still working...', []))
  check('status: [] disables exemption for empty body', !isStatusPost('', []))
}
{
  // Custom patterns replace built-ins; invalid regex skipped silently
  check('status: custom pattern matches', isStatusPost('HEARTBEAT tick 42', ['^HEARTBEAT ']))
  check('status: custom patterns replace built-ins', !isStatusPost('⏳ Still working...', ['^HEARTBEAT ']))
  check('status: invalid regex skipped, valid one still applies', isStatusPost('HEARTBEAT tick', ['[invalid(', '^HEARTBEAT ']))
  check('status: all-invalid patterns → not status', !isStatusPost('anything', ['[invalid(']))
}
{
  // effectiveStatusPatterns resolution: project > defaults > undefined
  check('status patterns: none set → undefined (built-ins)', effectiveStatusPatterns({}, {}) === undefined)
  const viaDefaults = effectiveStatusPatterns({ botPeers: { statusPatterns: ['^A'] } }, {})
  check('status patterns: defaults win over built-ins', viaDefaults?.length === 1 && viaDefaults[0] === '^A')
  const viaProject = effectiveStatusPatterns(
    { botPeers: { statusPatterns: ['^A'] } },
    { botPeers: { allow: [], statusPatterns: [] } },
  )
  check('status patterns: project [] wins over defaults', Array.isArray(viaProject) && viaProject.length === 0)
}
{
  // AC1/AC2: status flood never trips the limit; substantive loop still does
  const gate = new BotPeerGate(() => 0)
  const limits = { maxConsecutive: 3, cooldownSeconds: 0 }
  // Simulate the server path: status posts are dropped before check/recordDelivery
  const flood = Array.from({ length: 10 }, () => '⏳ Still working... (2 min elapsed)')
  let delivered = 0
  for (const body of flood) {
    if (isStatusPost(body)) continue
    if (gate.check('ch-s', limits).action === 'deliver') {
      gate.recordDelivery('ch-s')
      delivered++
    }
  }
  check('flood: 10 status ticks → 0 counted deliveries', delivered === 0)
  check('flood: substantive message after flood still delivers', gate.check('ch-s', limits).action === 'deliver')

  // Substantive loop still trips at maxConsecutive
  let limited = false
  for (let i = 0; i < 5; i++) {
    const r = gate.check('ch-s', limits)
    if (r.action === 'limit') { limited = true; break }
    gate.recordDelivery('ch-s')
  }
  check('flood: substantive loop trips at maxConsecutive=3', limited)
}

// ---------------------------------------------------------------------------
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`)
  process.exit(1)
} else {
  console.log(`\nAll tests passed.`)
}

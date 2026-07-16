/**
 * bun src/bot-peers.test.ts
 * Unit tests for BotPeerGate and effectiveBotPeerLimits.
 * Run: bun src/bot-peers.test.ts
 */
import { BotPeerGate, effectiveBotPeerLimits } from './bot-peers.ts'

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
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`)
  process.exit(1)
} else {
  console.log(`\nAll tests passed.`)
}

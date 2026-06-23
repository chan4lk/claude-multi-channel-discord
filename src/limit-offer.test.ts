/**
 * bun src/limit-offer.test.ts
 * Unit tests for parseLimitMessage + computeLimitOffer (no Claude spawn).
 */
import { ChannelsConfigSchema } from './channels-config.ts'
import { computeLimitOffer, parseLimitMessage } from './limit-offer.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`${status}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

/** Deep-equality via JSON since `check` only takes a boolean. */
function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const CHAT_ID = '111111111111111111'

function makeConfig(opts: { limitFallback?: string[] } = {}) {
  const project: Record<string, unknown> = { slug: 'alpha' }
  if (opts.limitFallback) project.limitFallback = opts.limitFallback
  return ChannelsConfigSchema.parse({
    master: { chatId: '999999999999999999' },
    defaults: {
      providers: {
        minimax: { baseUrl: 'https://x', apiKeyEnv: 'MINIMAX_API_KEY' },
      },
    },
    projects: { [CHAT_ID]: project },
  })
}

// --- AC1: parseLimitMessage extracts model + reset verbatim -----------------
{
  const input = "You've hit your Sonnet limit · resets Jun 24, 7am (UTC)"
  const ev = parseLimitMessage(input)
  check('AC1: limitedModel is Sonnet', ev.limitedModel === 'Sonnet', `got ${ev.limitedModel}`)
  check('AC1: resetsAt verbatim', ev.resetsAt === 'Jun 24, 7am (UTC)', `got ${ev.resetsAt}`)
  check('AC1: raw is original input', ev.raw === input)
}

// --- AC6: parseLimitMessage on unrelated text → nulls -----------------------
{
  const input = 'some unrelated text'
  const ev = parseLimitMessage(input)
  check('AC6: limitedModel null', ev.limitedModel === null, `got ${ev.limitedModel}`)
  check('AC6: resetsAt null', ev.resetsAt === null, `got ${ev.resetsAt}`)
  check('AC6: raw is original input', ev.raw === input)
}

// --- AC3: offer skips the limited subscription model ------------------------
{
  const config = makeConfig()
  const { offerLines } = computeLimitOffer(config, CHAT_ID, 'alpha', 'Sonnet', {})
  check(
    'AC3: offers opus switch',
    offerLines.includes('!project model alpha --set opus'),
    offerLines.join(' | '),
  )
  check(
    'AC3: does not offer the limited sonnet',
    !offerLines.includes('!project model alpha --set sonnet'),
    offerLines.join(' | '),
  )
}

// --- AC4: provider offer is gated on env key presence -----------------------
{
  const config = makeConfig()
  const withKey = computeLimitOffer(config, CHAT_ID, 'alpha', 'Sonnet', { MINIMAX_API_KEY: 'k' })
  check(
    'AC4: provider line present when key set',
    withKey.offerLines.includes('!project provider alpha --set minimax'),
    withKey.offerLines.join(' | '),
  )

  const noKey = computeLimitOffer(config, CHAT_ID, 'alpha', 'Sonnet', {})
  check(
    'AC4: no provider line when key unset',
    !noKey.offerLines.some((l) => l.includes('provider alpha --set minimax')),
    noKey.offerLines.join(' | '),
  )
}

// --- AC5: limitFallback drives autoSwitch (model) ---------------------------
{
  const config = makeConfig({ limitFallback: ['opus'] })
  const { autoSwitch } = computeLimitOffer(config, CHAT_ID, 'alpha', 'Sonnet', {})
  check(
    'AC5: autoSwitch is model opus',
    eq(autoSwitch, { kind: 'model', value: 'opus' }),
    JSON.stringify(autoSwitch),
  )
}

// --- EC1/EC2: fallback skips entry equal to the limited model ---------------
{
  const config = makeConfig({ limitFallback: ['sonnet', 'opus'] })
  const { autoSwitch } = computeLimitOffer(config, CHAT_ID, 'alpha', 'Sonnet', {})
  check(
    'EC1/EC2: skips equal-to-limited sonnet, picks opus',
    autoSwitch?.value === 'opus',
    JSON.stringify(autoSwitch),
  )
}

// --- EC3: provider fallback only usable when API key is present -------------
{
  const config = makeConfig({ limitFallback: ['minimax'] })

  const noKey = computeLimitOffer(config, CHAT_ID, 'alpha', 'Sonnet', {})
  check(
    'EC3: provider fallback unusable when key unset → null',
    noKey.autoSwitch === null,
    JSON.stringify(noKey.autoSwitch),
  )

  const withKey = computeLimitOffer(config, CHAT_ID, 'alpha', 'Sonnet', { MINIMAX_API_KEY: 'k' })
  check(
    'EC3: provider fallback usable when key set',
    eq(withKey.autoSwitch, { kind: 'provider', value: 'minimax' }),
    JSON.stringify(withKey.autoSwitch),
  )
}

// --- No-fallback project → autoSwitch null ----------------------------------
{
  const config = makeConfig()
  const { autoSwitch } = computeLimitOffer(config, CHAT_ID, 'alpha', 'Sonnet', { MINIMAX_API_KEY: 'k' })
  check(
    'no-fallback: autoSwitch null',
    autoSwitch === null,
    JSON.stringify(autoSwitch),
  )
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')

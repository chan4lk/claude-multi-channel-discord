/**
 * bun src/channels-config.test.ts
 * Unit tests for the collab config schema, effectiveCollabTimeout, and
 * resolveCollabTarget.
 * Run: bun src/channels-config.test.ts
 */
import {
  ChannelsConfigSchema,
  effectiveCollabTimeout,
  resolveCollabTarget,
} from './channels-config.ts'
import type { ChannelsConfig } from './channels-config.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`${status}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

const MASTER_CHAT = '100000000000000000'
const ALPHA_CHAT = '100000000000000001'
const BETA_CHAT = '100000000000000002'
const BOT_ID = '222222222222222222'

function makeConfig(): ChannelsConfig {
  return ChannelsConfigSchema.parse({
    master: { chatId: MASTER_CHAT },
    projects: {
      [MASTER_CHAT]: { slug: 'master' },
      [ALPHA_CHAT]: {
        slug: 'alpha',
        botPeers: { allow: [BOT_ID] },
        collab: {
          roles: {
            reviewer: 'beta',
            helper: BOT_ID,
            ghost: 'nosuch',
          },
        },
      },
      [BETA_CHAT]: { slug: 'beta' },
    },
  })
}

// ---------------------------------------------------------------------------
// Schema round-trip — collab block parses; .strict() rejects unknown keys
// ---------------------------------------------------------------------------
{
  const config = makeConfig()
  const alpha = config.projects[ALPHA_CHAT]!
  check('schema: collab block round-trips through parse', alpha.collab?.roles?.reviewer === 'beta')
  check('schema: collab.timeoutMinutes optional (absent ok)', alpha.collab?.timeoutMinutes === undefined)

  const unknownKey = ChannelsConfigSchema.safeParse({
    projects: {
      [ALPHA_CHAT]: { slug: 'alpha', collab: { roles: {}, bogus: 1 } },
    },
  })
  check('schema: strict collab rejects unknown project keys', !unknownKey.success)

  const rolesInDefaults = ChannelsConfigSchema.safeParse({
    defaults: { collab: { roles: { reviewer: 'beta' } } },
  })
  check('schema: defaults.collab is limits-only (roles rejected)', !rolesInDefaults.success)

  const timeoutInDefaults = ChannelsConfigSchema.safeParse({
    defaults: { collab: { timeoutMinutes: 45 } },
  })
  check('schema: defaults.collab.timeoutMinutes accepted', timeoutInDefaults.success)

  const badTimeout = ChannelsConfigSchema.safeParse({
    projects: {
      [ALPHA_CHAT]: { slug: 'alpha', collab: { timeoutMinutes: 0 } },
    },
  })
  check('schema: collab.timeoutMinutes must be a positive int', !badTimeout.success)
}

// ---------------------------------------------------------------------------
// effectiveCollabTimeout — fallback resolution
// ---------------------------------------------------------------------------
{
  const config = makeConfig()
  const alpha = config.projects[ALPHA_CHAT]!
  check('timeout: built-in fallback = 30', effectiveCollabTimeout(config, alpha) === 30)

  config.defaults.collab = { timeoutMinutes: 45 }
  check('timeout: defaults.collab wins over built-in', effectiveCollabTimeout(config, alpha) === 45)

  alpha.collab = { ...alpha.collab, timeoutMinutes: 10 }
  check('timeout: project.collab wins over defaults', effectiveCollabTimeout(config, alpha) === 10)
}

// ---------------------------------------------------------------------------
// resolveCollabTarget — role → internal slug
// ---------------------------------------------------------------------------
{
  const config = makeConfig()
  const r = resolveCollabTarget(config, ALPHA_CHAT, 'reviewer')
  check('resolve: role → project kind', 'kind' in r && r.kind === 'project')
  check('resolve: role → project slug beta', 'kind' in r && r.kind === 'project' && r.slug === 'beta')
  check('resolve: role → project chatId', 'kind' in r && r.kind === 'project' && r.chatId === BETA_CHAT)
}

// ---------------------------------------------------------------------------
// resolveCollabTarget — role → external bot peer
// ---------------------------------------------------------------------------
{
  const config = makeConfig()
  const r = resolveCollabTarget(config, ALPHA_CHAT, 'helper')
  check('resolve: role → botPeer kind', 'kind' in r && r.kind === 'botPeer')
  check('resolve: role → botPeer id', 'kind' in r && r.kind === 'botPeer' && r.botId === BOT_ID)
  check('resolve: botPeer chatId is the source channel', 'kind' in r && r.kind === 'botPeer' && r.chatId === ALPHA_CHAT)
}

// ---------------------------------------------------------------------------
// resolveCollabTarget — literal values (no role match / no roles configured)
// ---------------------------------------------------------------------------
{
  const config = makeConfig()
  // beta has no collab block at all — literal slug still resolves.
  const r1 = resolveCollabTarget(config, BETA_CHAT, 'alpha')
  check('resolve: literal slug with no roles configured', 'kind' in r1 && r1.kind === 'project' && r1.slug === 'alpha' && r1.chatId === ALPHA_CHAT)

  // alpha has roles, but a non-role input falls through to literal resolution.
  const r2 = resolveCollabTarget(config, ALPHA_CHAT, 'beta')
  check('resolve: literal slug alongside configured roles', 'kind' in r2 && r2.kind === 'project' && r2.slug === 'beta')

  const r3 = resolveCollabTarget(config, ALPHA_CHAT, BOT_ID)
  check('resolve: literal bot-peer id in allow', 'kind' in r3 && r3.kind === 'botPeer' && r3.botId === BOT_ID)
}

// ---------------------------------------------------------------------------
// resolveCollabTarget — error paths
// ---------------------------------------------------------------------------
{
  const config = makeConfig()

  // Stale role: value points at a slug that no longer exists.
  const stale = resolveCollabTarget(config, ALPHA_CHAT, 'ghost')
  check('resolve: stale role value → error', 'error' in stale)
  check('resolve: stale error names the value', 'error' in stale && stale.error.includes('nosuch'))
  check('resolve: stale error lists configured roles', 'error' in stale && stale.error.includes('reviewer') && stale.error.includes('helper'))

  // Unknown literal, no roles configured — error hints "(none)".
  const unknown = resolveCollabTarget(config, BETA_CHAT, 'nosuch')
  check('resolve: unknown literal → error', 'error' in unknown && unknown.error.includes('nosuch'))
  check('resolve: no roles configured → "(none)" hint', 'error' in unknown && unknown.error.includes('(none)'))

  // Self-target refused.
  const self = resolveCollabTarget(config, ALPHA_CHAT, 'alpha')
  check('resolve: self-target → error', 'error' in self)
  check('resolve: self-target error names the value', 'error' in self && self.error.includes('alpha'))

  // Master target refused.
  const master = resolveCollabTarget(config, ALPHA_CHAT, 'master')
  check('resolve: master target → error', 'error' in master)
  check('resolve: master error names the value', 'error' in master && master.error.includes('master'))

  // Bot id not in the source project's allow list.
  const notAllowed = resolveCollabTarget(config, BETA_CHAT, BOT_ID)
  check('resolve: bot id not in allow → error', 'error' in notAllowed && notAllowed.error.includes(BOT_ID))

  // Unknown source chat.
  const noSource = resolveCollabTarget(config, '999999999999999999', 'beta')
  check('resolve: unknown source chat → error', 'error' in noSource)
}

// ---------------------------------------------------------------------------
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`)
  process.exit(1)
} else {
  console.log(`\nAll tests passed.`)
}

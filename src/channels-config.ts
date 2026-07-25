import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'

import { channelsFile } from './paths.ts'

export const SLUG_PATTERN = /^[a-z][a-z0-9_-]{0,30}$/

const SlugSchema = z.string().regex(SLUG_PATTERN, 'slug must be lowercase, 1-31 chars, [a-z0-9_-], start with a letter')
const ChatIdSchema = z.string().regex(/^\d{15,25}$|^[a-zA-Z0-9_:@.!-]{15,}$/, 'chat_id must be a Discord snowflake (15-25 digits) or a Teams conversation ID')

const ProjectGitSchema = z.object({
  // Accept both URL forms and SSH-style `git@host:path` — zod's .url()
  // rejects the SSH shorthand even though it's the canonical form
  // most people clone with.
  remote: z.string().min(1),
  branch: z.string().min(1).default('main'),
  credentials: z.string().min(1),
})

/**
 * Catalog entry for an Anthropic-compatible provider. The host's
 * ANTHROPIC_API_KEY env var (or whichever name `apiKeyEnv` points at)
 * supplies the key at spawn time; nothing is persisted in channels.json.
 *
 * Implicit "subscription" provider: when project.provider is unset and
 * no defaults.provider is configured, the per-channel claude inherits
 * the operator's existing Claude Code OAuth / keychain credentials —
 * no env override at all. To explicitly route a project to a third
 * party (e.g. MiniMax), define a provider here and set project.provider
 * to its name.
 */
const ProviderSchema = z.object({
  baseUrl: z.string().url(),
  /** Name of the env var the bot reads to get the provider's API key. */
  apiKeyEnv: z.string().min(1),
})
export type Provider = z.infer<typeof ProviderSchema>

/**
 * Flags handed to each per-project `claude` subprocess. These all map to
 * Claude Code CLI arguments. Arbitrary `extraArgs` are appended last and
 * win on conflict — useful for flags this schema doesn't model yet, but
 * remember they're operator-controlled so don't expose this surface to
 * untrusted Discord users.
 */
const ClaudeArgsSchema = z.object({
  permissionMode: z.enum(['auto', 'acceptEdits', 'plan', 'default']).optional(),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  /** Appended verbatim to the spawn argv. */
  extraArgs: z.array(z.string()).optional(),
})
export type ClaudeArgs = z.infer<typeof ClaudeArgsSchema>

const ProgressModeSchema = z.enum(['off', 'edit', 'post', 'phases'])
export type ProgressMode = z.infer<typeof ProgressModeSchema>

const VoiceProjectConfigSchema = z.object({
  enabled: z.boolean().default(false),
  kokoroVoice: z.string().default('af_bella'),
  maxTurnSeconds: z.number().int().positive().default(30),
  provider: z.enum(['local', 'openai-realtime']).default('local'),
})
export type VoiceProjectConfig = z.infer<typeof VoiceProjectConfigSchema>

/**
 * Cross-project peer dialogue config for a project.
 * `allow`: slugs of other projects this project may exchange messages with
 * (mutual consent required on both sides). `maxHops` / `cooldownSeconds`
 * are per-project overrides for the loop guards; fall back to
 * defaults.peers then built-in (maxHops 6, cooldownSeconds 15).
 */
const PeersSchema = z.object({
  allow: z.array(SlugSchema),
  maxHops: z.number().int().positive().optional(),
  cooldownSeconds: z.number().int().positive().optional(),
})
export type Peers = z.infer<typeof PeersSchema>

/**
 * Limits-only variant for defaults.peers — no allow list (allowlists are
 * always per-project; there is no safe global default for cross-project reach).
 * `.strict()` makes Zod error if `allow` is accidentally included.
 */
const PeerLimitsSchema = z.object({
  maxHops: z.number().int().positive().optional(),
  cooldownSeconds: z.number().int().positive().optional(),
}).strict()
export type PeerLimits = z.infer<typeof PeerLimitsSchema>

/**
 * Bot-peer dialogue config for a project.
 * `allow`: explicit list of Discord user-id snowflakes permitted to deliver
 * messages into this project's session as a machine peer.
 * `maxConsecutive` / `cooldownSeconds`: per-project overrides for the loop
 * guards; fall back to defaults.botPeers then built-in (5 / 30).
 */
const BotPeersSchema = z.object({
  allow: z.array(z.string().regex(/^\d{17,20}$/, 'each bot-peer id must be a Discord snowflake (17-20 digits)')),
  maxConsecutive: z.number().int().positive().optional(),
  cooldownSeconds: z.number().int().positive().optional(),
  statusPatterns: z.array(z.string()).optional(),
})
export type BotPeers = z.infer<typeof BotPeersSchema>

/**
 * Limits-only variant for defaults.botPeers — no allow list (allowlists are
 * always per-project; there is no safe global default for inbound bot reach).
 */
const BotPeerLimitsSchema = z.object({
  maxConsecutive: z.number().int().positive().optional(),
  cooldownSeconds: z.number().int().positive().optional(),
  statusPatterns: z.array(z.string()).optional(),
})
export type BotPeerLimits = z.infer<typeof BotPeerLimitsSchema>

/**
 * MCD-driven backlog autopilot config for a project.
 * `enabled`: activates the autopilot sweep for this project.
 * `file`: backlog filename to read/write (default 'BACKLOG.md').
 * `intervalMinutes` / `stallThreshold`: per-project overrides for the sweep
 * cadence and stall detection; fall back to defaults.autopilot then built-in
 * (intervalMinutes 30, stallThreshold 3).
 * `respectHeartbeatWindow`: when true, nudges fire only inside the project's
 * heartbeat.window (seed injections are exempt). Default true.
 * Runtime fields (MCD-maintained, persisted in channels.json):
 * `state` tracks the state machine; `seededAt`, `seedGoal`, `lastFireAt`,
 * `zeroDeltaCount`, `lastSnapshot` are updated by the sweep each tick.
 */
const AutopilotSchema = z.object({
  enabled: z.boolean(),
  file: z.string().optional(),
  intervalMinutes: z.number().int().positive().optional(),
  stallThreshold: z.number().int().positive().optional(),
  respectHeartbeatWindow: z.boolean().optional(),
  // Runtime fields — maintained by the autopilot sweep, not by the operator.
  state: z.enum(['seeding', 'running', 'halted', 'complete']).optional(),
  seededAt: z.string().optional(),
  seedGoal: z.string().optional(),
  lastFireAt: z.string().optional(),
  zeroDeltaCount: z.number().int().nonnegative().optional(),
  lastSnapshot: z.object({
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }).optional(),
})
export type AutopilotConfig = z.infer<typeof AutopilotSchema>

/**
 * Limits-only variant for defaults.autopilot — no `enabled` field (autopilot
 * is always opted in per-project). Built-in fallbacks: intervalMinutes 30,
 * stallThreshold 3.
 */
const DefaultsAutopilotSchema = z.object({
  intervalMinutes: z.number().int().positive().optional(),
  stallThreshold: z.number().int().positive().optional(),
})
export type DefaultsAutopilot = z.infer<typeof DefaultsAutopilotSchema>

/**
 * Passive days-scale backlog stall watch config for a project.
 * `enabled`: activates the watch sweep for this project (default true when
 * a backlog source exists — omit to keep it on, set false to opt out).
 * `staleBacklogDays`: days without backlog movement before an alert fires;
 * falls back to defaults.backlogWatch then built-in (3).
 * Skipped entirely when autopilot is enabled for the project — autopilot
 * owns stall signaling there.
 * Runtime fields (MCD-maintained, persisted in channels.json):
 * `lastSnapshot`, `lastDeltaAt`, `lastAlertAt` are updated by the sweep,
 * not by the operator.
 */
const BacklogWatchSchema = z.object({
  enabled: z.boolean().optional(),
  staleBacklogDays: z.number().optional(),
  // Runtime fields — maintained by the watch sweep, not by the operator.
  lastSnapshot: z.object({
    done: z.number(),
    total: z.number(),
  }).optional(),
  lastDeltaAt: z.string().optional(),
  lastAlertAt: z.string().optional(),
}).strict()
export type BacklogWatchConfig = z.infer<typeof BacklogWatchSchema>

/**
 * Limits-only variant for defaults.backlogWatch — no runtime fields (those
 * are always per-project). Built-in fallbacks: enabled true, staleBacklogDays 3.
 */
const DefaultsBacklogWatchSchema = z.object({
  enabled: z.boolean().optional(),
  staleBacklogDays: z.number().optional(),
}).strict()
export type DefaultsBacklogWatch = z.infer<typeof DefaultsBacklogWatchSchema>

const ProjectSchema = z.object({
  slug: SlugSchema,
  /**
   * Messaging platform this project is attached to. Omitted (discord) by default.
   * Set to 'teams' when the chatId is a Microsoft Teams conversation ID
   * rather than a Discord channel snowflake.
   * Set to 'whatsapp' when the project is bound to a WhatsApp contact/group
   * identified by `whatsappJid`.
   */
  platform: z.enum(['discord', 'teams', 'whatsapp']).optional(),
  /**
   * WhatsApp JID (Jabber ID) of the bound contact or group, e.g.
   * `15551234567@s.whatsapp.net` (individual) or `<id>@g.us` (group).
   * Required when `platform === 'whatsapp'`; ignored otherwise.
   */
  whatsappJid: z.string().optional(),
  model: z.string().optional(),
  git: ProjectGitSchema.optional(),
  claude: ClaudeArgsSchema.optional(),
  /**
   * References a key in defaults.providers. When set, the per-channel
   * claude is spawned with ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY env
   * overrides that route the model API call to that provider. Unset =
   * use the operator's Claude Code subscription auth.
   */
  provider: z.string().optional(),
  /**
   * Controls live tool-call progress posts to Discord during Claude turns.
   * 'off' (default): silent until reply tool fires.
   * 'post': one Discord message per tool_use start, edited on completion.
   * 'edit': one Discord message per turn, edited in-place with growing chain.
   */
  progressMode: ProgressModeSchema.optional(),
  /**
   * Allow this project's Claude to call `mcp__mcd__handoff` — sending a
   * task message into another project's session by slug. Off by default:
   * handoff grants lateral reach across project boundaries, so the
   * operator must opt each source project in (or flip defaults.handoff).
   */
  handoff: z.boolean().optional(),
  /**
   * Override the watchdog base threshold for this project. Default is 5 min.
   * Set higher for channels that run long pipelines (TTS, video rendering).
   */
  stuckThresholdMinutes: z.number().int().positive().optional(),
  /**
   * Ordered list of model names and/or provider aliases to auto-try when this
   * project hits a usage limit (429). e.g. ["opus", "minimax"]. Absent/empty →
   * offer-only (no auto-switch).
   */
  limitFallback: z.array(z.string()).optional(),
  /** Inject a compression prompt when input tokens exceed this % of the model context (0–100). Default 80. */
  contextWarningThresholdPct: z.number().int().min(1).max(100).optional(),
  voice: VoiceProjectConfigSchema.optional(),
  /** Run a session-distillation job after the project's claude process stops. */
  distillOnStop: z.boolean().optional(),
  /** Monthly token budget for this project. null / omitted = unlimited. */
  monthlyTokenBudget: z.number().int().positive().optional(),
  /**
   * Health score alert threshold (0–100). When set, the health alert monitor
   * posts to the master channel if the computed score drops below this value
   * for two consecutive evaluation cycles. No repeat until score recovers
   * above threshold + 5 (hysteresis).
   */
  healthScoreThreshold: z.number().int().min(0).max(100).optional(),
  heartbeat: z.object({
    mode: z.enum(['supervised', 'autonomous']).default('supervised'),
    window: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/).optional(),
    staleAfterMinutes: z.number().int().positive().default(60),
  }).optional(),
  /** ISO timestamp of the last autonomous injection into this project. */
  lastInjectedAt: z.string().optional(),
  /** Minimum minutes between autonomous injections for this project. */
  injectCooldownMinutes: z.number().optional(),
  /** When true, use develop-branch workflow for this project. */
  developBranch: z.boolean().optional(),
  /**
   * Per-project transcript size threshold in kilobytes before session rotation.
   * Falls back to RESUME_TRANSCRIPT_MAX_BYTES when unset.
   */
  sessionRotateThresholdKB: z.number().int().positive().optional(),
  /**
   * Bot-peer dialogue config. When present, messages from the listed Discord
   * user ids (bot accounts) are delivered into this project's Claude session
   * instead of being dropped. Loop guards (consecutive limit, cooldown) are
   * applied per FR3/FR4. Master channel is always excluded regardless of this
   * config. Absent = no bot messages accepted (default behavior preserved).
   */
  botPeers: BotPeersSchema.optional(),
  /**
   * Cross-project peer dialogue config. When present with a non-empty `allow`
   * list, the project's session gets the `ask_project` MCP tool and may
   * exchange messages with the listed peer slugs (mutual consent required).
   * Loop guards (hop budget, cooldown) are applied per FR3/FR4 of
   * cross-project-dialogue spec. Absent = no cross-project messaging.
   */
  peers: PeersSchema.optional(),
  /**
   * Backlog autopilot config. When present with `enabled: true`, MCD drives
   * the "create a backlog, then loop through all items" workflow for this
   * project: seeding a backlog if none exists, periodically injecting nudges
   * while unchecked items remain, detecting stalls and guardrail halts,
   * announcing completion, and re-arming when new items appear. Runtime fields
   * (`state`, `seededAt`, `lastFireAt`, etc.) are maintained by the sweep and
   * persisted here — do not edit them by hand. Absent = autopilot off.
   */
  autopilot: AutopilotSchema.optional(),
  /**
   * Passive backlog stall watch config. When a backlog source exists, the
   * hourly sweep snapshots done/total counts and alerts the master channel
   * after `staleBacklogDays` without movement while open items remain.
   * On by default (absent = enabled); set `enabled: false` to opt out.
   * Skipped when `autopilot.enabled` is true. Runtime fields
   * (`lastSnapshot`, `lastDeltaAt`, `lastAlertAt`) are maintained by the
   * sweep and persisted here — do not edit them by hand.
   */
  backlogWatch: BacklogWatchSchema.optional(),
}).superRefine((val, ctx) => {
  if (val.platform === 'whatsapp' && !val.whatsappJid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "whatsappJid is required when platform is 'whatsapp'",
      path: ['whatsappJid'],
    })
  }
})

const DefaultsGitSchema = z.object({
  userName: z.string().default('claude-bot'),
  userEmail: z.string().default('claude-bot@local'),
  credentials: z.string().optional(),
  branchPrefix: z.string().default('claude/'),
})

const MemoryConfigSchema = z.object({
  backupIntervalHours: z.number().int().nonnegative().default(6),
  r2: z.object({
    bucket: z.string(),
    endpoint: z.string().url(),
    accessKeyIdEnv: z.string(),
    secretAccessKeyEnv: z.string(),
  }).optional(),
}).optional()

export const HermesConfigSchema = z.object({
  enabled: z.boolean().default(false),
  binPath: z.string().default('hermes'),
  yolo: z.boolean().default(true),
  extraArgs: z.array(z.string()).default([]),
})
export type HermesConfig = z.infer<typeof HermesConfigSchema>

const DefaultsSchema = z.object({
  model: z.string().default('sonnet'),
  idleEvictMinutes: z.number().int().positive().default(15),
  maxConcurrent: z.number().int().positive().default(8),
  git: DefaultsGitSchema.default({}),
  /**
   * Claude CLI flags applied to every project subprocess unless the
   * project overrides them. permissionMode defaults to "auto" — same as the
   * upstream single-session bot's runner script — which keeps the bot
   * usable from Discord without per-tool prompts.
   */
  claude: ClaudeArgsSchema.default({ permissionMode: 'auto' }),
  /**
   * Catalog of Anthropic-compatible providers a project can route to.
   * Keys are operator-chosen aliases (e.g. "minimax", "azure-anthropic").
   * Per-project `provider` references one of these. Empty by default —
   * unconfigured projects use the operator's Claude subscription auth.
   */
  providers: z.record(z.string(), ProviderSchema).default({}),
  /**
   * Default provider alias for projects that don't specify one. Unset
   * means "use Claude subscription" (no env override at spawn).
   */
  provider: z.string().optional(),
  /** Global default for progressMode. Projects can override per-channel. */
  progressMode: ProgressModeSchema.default('off'),
  /**
   * Kill stale `mcd-<slug>-<ts>` tmux sessions from previous server
   * generations on boot. Disable when multiple MCD instances share one
   * tmux server. Absent ⇒ enabled.
   */
  orphanSweep: z.boolean().optional(),
  /** Global default for per-project `handoff`. Off unless opted in. */
  handoff: z.boolean().default(false),
  /** Default context-warning threshold % (0–100). Default 80. */
  contextWarningThresholdPct: z.number().int().min(1).max(100).default(80),
  memory: MemoryConfigSchema,
  hermes: HermesConfigSchema.optional(),
  /** How often (minutes) the autonomous inject sweep runs. */
  injectSweepIntervalMinutes: z.number().optional(),
  /** Proposal/line thresholds that trigger a batch autonomous injection. */
  batchThreshold: z.object({ proposals: z.number(), lines: z.number() }).optional(),
  /**
   * Default transcript size threshold in kilobytes before session rotation.
   * Falls back to RESUME_TRANSCRIPT_MAX_BYTES when unset. Projects can override
   * per-channel via their own sessionRotateThresholdKB field.
   */
  sessionRotateThresholdKB: z.number().int().positive().optional(),
  /**
   * Default bot-peer loop-guard limits. No `allow` field — allowlists are
   * always per-project. Built-in fallbacks: maxConsecutive 5, cooldownSeconds 30.
   */
  botPeers: BotPeerLimitsSchema.optional(),
  /**
   * Default cross-project peer loop-guard limits. No `allow` field —
   * allowlists are always per-project. Built-in fallbacks: maxHops 6,
   * cooldownSeconds 15.
   */
  peers: PeerLimitsSchema.optional(),
  /**
   * Default autopilot sweep limits. No `enabled` field — autopilot is always
   * opted in per-project. Built-in fallbacks: intervalMinutes 30,
   * stallThreshold 3.
   */
  autopilot: DefaultsAutopilotSchema.optional(),
  /**
   * Default backlog stall watch settings. No runtime fields — those are
   * always per-project. Built-in fallbacks: enabled true, staleBacklogDays 3.
   */
  backlogWatch: DefaultsBacklogWatchSchema.optional(),
})

const MasterSchema = z.object({
  chatId: ChatIdSchema,
  commandPrefix: z.string().default('!project'),
})

export const ChannelsConfigSchema = z.object({
  version: z.literal(1).default(1),
  master: MasterSchema.optional(),
  defaults: DefaultsSchema.default({}),
  projects: z.record(ChatIdSchema, ProjectSchema).default({}),
})

export type ChannelsConfig = z.infer<typeof ChannelsConfigSchema>
export type Project = z.infer<typeof ProjectSchema>

const EMPTY_CONFIG: ChannelsConfig = ChannelsConfigSchema.parse({})

export function loadConfig(path: string = channelsFile()): ChannelsConfig {
  if (!existsSync(path)) return EMPTY_CONFIG
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    throw new Error(`failed to read ${path}: ${(err as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${(err as Error).message}`)
  }
  const result = ChannelsConfigSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`${path} failed schema validation:\n${result.error.toString()}`)
  }
  // Slug uniqueness guard — schema doesn't express it.
  const seen = new Set<string>()
  for (const [chatId, project] of Object.entries(result.data.projects)) {
    if (seen.has(project.slug)) {
      throw new Error(`duplicate slug "${project.slug}" (last seen on chat_id ${chatId})`)
    }
    seen.add(project.slug)
  }
  return result.data
}

export function saveConfig(config: ChannelsConfig, path: string = channelsFile()): void {
  // Re-parse to apply defaults and reject malformed in-memory mutations before persisting.
  const validated = ChannelsConfigSchema.parse(config)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp.${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
}

export function findProjectByChatId(config: ChannelsConfig, chatId: string): Project | undefined {
  return config.projects[chatId]
}

/**
 * Resolve a project's effective provider. Returns null when the project
 * uses Claude subscription auth (no env override). Returns a non-null
 * value with the resolved API key when the project routes to a
 * configured third-party provider — at that point the spawn env should
 * set ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY to those values.
 *
 * Throws when the project references a provider alias that isn't in
 * `defaults.providers`, or when the provider's apiKeyEnv variable is
 * not set on the bot's process. The error string is operator-readable.
 */
export function resolveProvider(
  config: ChannelsConfig,
  project: Project,
): { name: string; baseUrl: string; apiKey: string } | null {
  const name = project.provider ?? config.defaults.provider
  if (!name) return null
  const def = config.defaults.providers[name]
  if (!def) {
    throw new Error(
      `provider "${name}" referenced by ${project.slug} but not in defaults.providers — add it or change the project's provider field`,
    )
  }
  const apiKey = process.env[def.apiKeyEnv]
  if (!apiKey) {
    throw new Error(
      `provider "${name}" requires env var ${def.apiKeyEnv} to be set on the bot process; not currently set`,
    )
  }
  return { name, baseUrl: def.baseUrl, apiKey }
}

/**
 * Merge per-project Claude CLI args with defaults. Scalar fields use
 * project-overrides-default semantics; arrays follow the most useful rule
 * for each (replace for tool allow/disallow lists; concat for extraArgs).
 */
export function resolveClaudeArgs(config: ChannelsConfig, project: Project): ClaudeArgs {
  const base = config.defaults.claude
  const over = project.claude ?? {}
  return {
    permissionMode: over.permissionMode ?? base.permissionMode,
    allowedTools: over.allowedTools ?? base.allowedTools,
    disallowedTools: over.disallowedTools ?? base.disallowedTools,
    extraArgs: [...(base.extraArgs ?? []), ...(over.extraArgs ?? [])],
  }
}

export function findProjectBySlug(config: ChannelsConfig, slug: string): { chatId: string; project: Project } | undefined {
  for (const [chatId, project] of Object.entries(config.projects)) {
    if (project.slug === slug) return { chatId, project }
  }
  return undefined
}

/** Whether a project may initiate cross-project handoff (project override, else defaults). */
export function handoffEnabled(config: ChannelsConfig, project: Project): boolean {
  return project.handoff ?? config.defaults.handoff
}

const PEER_LIMITS_BUILT_IN = { maxHops: 6, cooldownSeconds: 15 } as const

/**
 * Resolve effective peer loop-guard limits for a project.
 * Resolution order: project.peers → defaults.peers → built-in (maxHops 6, cooldownSeconds 15).
 */
export function effectivePeerLimits(
  config: ChannelsConfig,
  project: Project,
): { maxHops: number; cooldownSeconds: number } {
  return {
    maxHops:
      project.peers?.maxHops ??
      config.defaults.peers?.maxHops ??
      PEER_LIMITS_BUILT_IN.maxHops,
    cooldownSeconds:
      project.peers?.cooldownSeconds ??
      config.defaults.peers?.cooldownSeconds ??
      PEER_LIMITS_BUILT_IN.cooldownSeconds,
  }
}

export function isMasterChannel(config: ChannelsConfig, chatId: string): boolean {
  return config.master?.chatId === chatId
}

export function commandPrefix(config: ChannelsConfig): string {
  return config.master?.commandPrefix ?? '!project'
}

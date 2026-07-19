/**
 * BotPeerGate — loop-prevention gate for bot-peer inbound messages.
 * AC4 / AC5 / NFR1 / NFR2.
 *
 * All state is in-memory (per-process lifetime). A server restart resets
 * counters — documented as acceptable (NFR2).
 */

// Structural type compatible with channels-config.ts ProjectSchema and DefaultsSchema
// without importing them (T1 is parallel; we accept duck-typed params).
export interface BotPeersLimitsConfig {
  botPeers?: { maxConsecutive?: number; cooldownSeconds?: number; statusPatterns?: string[] }
}

export interface BotPeersProjectConfig {
  botPeers?: { allow?: string[]; maxConsecutive?: number; cooldownSeconds?: number; statusPatterns?: string[] }
}

export interface EffectiveLimits {
  maxConsecutive: number
  cooldownSeconds: number
}

const DEFAULT_MAX_CONSECUTIVE = 5
const DEFAULT_COOLDOWN_SECONDS = 30

/**
 * Resolve effective bot-peer limits:
 *   project overrides > defaults > built-in (5 / 30).
 */
export function effectiveBotPeerLimits(
  config: BotPeersLimitsConfig,
  project: BotPeersProjectConfig,
): EffectiveLimits {
  return {
    maxConsecutive:
      project.botPeers?.maxConsecutive ??
      config.botPeers?.maxConsecutive ??
      DEFAULT_MAX_CONSECUTIVE,
    cooldownSeconds:
      project.botPeers?.cooldownSeconds ??
      config.botPeers?.cooldownSeconds ??
      DEFAULT_COOLDOWN_SECONDS,
  }
}

/**
 * Built-in status-post shapes observed in the wild (finaudit 2026-07-18):
 * automated progress ticks, placeholder bodies, and empty messages. Anchored
 * so ordinary prose that merely mentions an hourglass still counts.
 */
export const DEFAULT_STATUS_PATTERNS: string[] = [
  '^\\s*$',
  '^⏳',
  '^\\(no content\\)$',
]

/**
 * Resolve the effective status-pattern list: project > defaults > undefined.
 * `undefined` means "use built-ins"; an explicit empty array disables the
 * exemption entirely.
 */
export function effectiveStatusPatterns(
  config: BotPeersLimitsConfig,
  project: BotPeersProjectConfig,
): string[] | undefined {
  return project.botPeers?.statusPatterns ?? config.botPeers?.statusPatterns
}

/**
 * True when the message body is a status/progress post that must be invisible
 * to the gate: no counter increment, no cooldown update, no injection.
 * Invalid regex strings are skipped; a too-broad pattern would re-open loop
 * risk, so callers should keep patterns anchored.
 */
export function isStatusPost(content: string, patterns?: string[]): boolean {
  const list = patterns ?? DEFAULT_STATUS_PATTERNS
  for (const src of list) {
    try {
      if (new RegExp(src, 'u').test(content)) return true
    } catch {
      // invalid pattern — skip it, keep checking the rest
    }
  }
  return false
}

export type GateResult =
  | { action: 'deliver' }
  | { action: 'drop-cooldown' }
  | { action: 'limit'; notify: boolean }

export class BotPeerGate {
  private consecutive = new Map<string, number>()
  private lastDeliveryMs = new Map<string, number>()
  private noticeSent = new Set<string>()

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Decide what to do with an inbound bot message.
   * Does NOT mutate state — call recordDelivery() if the caller accepts the
   * 'deliver' result and actually hands the message to pool.deliver().
   */
  check(chatId: string, limits: EffectiveLimits): GateResult {
    const nowMs = this.now()

    // Cooldown check — silent drop, no counter increment.
    const last = this.lastDeliveryMs.get(chatId)
    if (last !== undefined && nowMs - last < limits.cooldownSeconds * 1000) {
      return { action: 'drop-cooldown' }
    }

    // Consecutive-turn limit check.
    const count = this.consecutive.get(chatId) ?? 0
    if (count >= limits.maxConsecutive) {
      const notify = !this.noticeSent.has(chatId)
      if (notify) this.noticeSent.add(chatId)
      return { action: 'limit', notify }
    }

    return { action: 'deliver' }
  }

  /** Call after a bot message has been successfully handed to pool.deliver(). */
  recordDelivery(chatId: string): void {
    this.lastDeliveryMs.set(chatId, this.now())
    this.consecutive.set(chatId, (this.consecutive.get(chatId) ?? 0) + 1)
  }

  /** Call when a human message is delivered via the human path to this project. */
  recordHuman(chatId: string): void {
    this.consecutive.delete(chatId)
    this.noticeSent.delete(chatId)
  }
}

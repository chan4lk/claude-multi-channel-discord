import type { ChannelsConfig } from './channels-config.ts'

/**
 * Parsed representation of a usage-limit ("429"-style) message emitted by
 * the claude CLI when a model's quota is exhausted.
 */
export interface LimitHitEvent {
  limitedModel: string | null
  resetsAt: string | null
  raw: string
}

/**
 * Extract the limited model name and reset time from a limit message.
 * Reset time is captured verbatim — no Date parsing.
 *
 * Example:
 *   "You've hit your Sonnet limit · resets Jun 24, 7am (UTC)"
 *   → { limitedModel: 'Sonnet', resetsAt: 'Jun 24, 7am (UTC)', raw: <text> }
 */
export function parseLimitMessage(text: string): LimitHitEvent {
  const modelMatch = text.match(/hit your\s+(.+?)\s+limit\b/i)
  const resetMatch = text.match(/resets?\s+(.+?)\s*$/i)
  return {
    limitedModel: modelMatch ? modelMatch[1].trim() : null,
    resetsAt: resetMatch ? resetMatch[1].trim() : null,
    raw: text,
  }
}

/**
 * Compute the auto-switch decision and the operator-facing offer lines for a
 * project that just hit a usage limit.
 *
 * `offerLines` are always populated (subscription model switches + any
 * provider switches whose API key is present in `env`). `autoSwitch` is only
 * non-null when the project defines a `limitFallback` list and one of its
 * ordered entries is currently usable.
 */
export function computeLimitOffer(
  config: ChannelsConfig,
  chatId: string,
  slug: string,
  limitedModel: string | null,
  env: Record<string, string | undefined>,
): { autoSwitch: { kind: 'model' | 'provider'; value: string } | null; offerLines: string[] } {
  const project = config.projects[chatId]
  const providers = config.defaults.providers
  const offerLines: string[] = []

  const subscriptionCandidates = ['opus', 'sonnet'].filter(
    (m) => m.toLowerCase() !== (limitedModel ?? '').toLowerCase(),
  )
  for (const m of subscriptionCandidates) {
    offerLines.push(`!project model ${slug} --set ${m}`)
  }

  for (const [alias, def] of Object.entries(providers)) {
    if (env[def.apiKeyEnv]) {
      offerLines.push(`!project provider ${slug} --set ${alias}`)
    }
  }

  let autoSwitch: { kind: 'model' | 'provider'; value: string } | null = null
  const fallback = project?.limitFallback
  if (fallback?.length) {
    const limited = (limitedModel ?? '').toLowerCase()
    for (const entry of fallback) {
      if (entry.toLowerCase() === limited) continue
      const providerDef = providers[entry]
      if (providerDef) {
        if (env[providerDef.apiKeyEnv]) {
          autoSwitch = { kind: 'provider', value: entry }
          break
        }
        continue
      }
      autoSwitch = { kind: 'model', value: entry }
      break
    }
  }

  return { autoSwitch, offerLines }
}

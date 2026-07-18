# Spec: Bot-peer turn limit — exempt status posts

## Functional Requirements

- FR1: Inbound bot-peer messages classified before gating: status posts neither increment the consecutive counter nor get injected into the project session; they are fully invisible to the gate (no cooldown update either).
- FR2: Classification is regex-based via `statusPatterns?: string[]` on the project `botPeers` block, falling back to `defaults.botPeers.statusPatterns`, then built-in anchored defaults matching observed shapes: leading `⏳`, `(no content)`, empty/whitespace-only body.
- FR3: `statusPatterns: []` disables the exemption entirely (every message counts, current behavior).
- FR4: Invalid regex strings are skipped silently; remaining patterns still apply.
- FR5: Substantive messages count exactly as today; maxConsecutive stays 5 (per-channel override already exists).

## Acceptance Criteria

- AC1: Status flood (⏳ ticks) does not trip the consecutive-turn limit (unit test)
- AC2: Substantive message loop still trips at maxConsecutive (unit test)
- AC3: `statusPatterns` configurable on project + defaults botPeers schema; `[]` disables exemption (unit test)
- AC4: Status posts are not injected (server.ts drops before pool.deliver) — code-level check + gate unit test on classification
- AC5: `bun tsc --noEmit` clean; bot-peers suite extended and green

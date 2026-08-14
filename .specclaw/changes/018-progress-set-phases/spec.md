# Spec: progress --set phases

## Acceptance Criteria

- AC1: `!project progress <slug> --set phases` persists `progressMode: "phases"` to `channels.json`
- AC2: Error message for an invalid mode lists all four valid values (`off`, `edit`, `post`, `phases`)
- AC3: Help text lists `phases`
- AC4: Tests cover accept + reject paths; `bun tsc --noEmit` clean

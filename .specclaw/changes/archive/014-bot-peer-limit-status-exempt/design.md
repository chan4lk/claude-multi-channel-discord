# Design: Bot-peer status exemption

- `src/bot-peers.ts`: `DEFAULT_STATUS_PATTERNS` (anchored: `^\s*$`, `^⏳`, `^\(no content\)$`), exported pure `isStatusPost(content, patterns?)` — undefined patterns → built-ins, `[]` → always false, invalid regex skipped. `effectiveStatusPatterns(defaults, project)` resolves project > defaults > undefined. Interfaces gain `statusPatterns?: string[]`.
- `src/channels-config.ts`: `statusPatterns: z.array(z.string()).optional()` on BotPeersSchema + BotPeerLimitsSchema.
- `server.ts` handleBotInbound: compute content early; `isStatusPost(content, effectiveStatusPatterns(cfg.defaults, project))` → stderr log + return before gate.check. Gate untouched (classification stays outside; gate remains pure counter logic).
- No `!project set` flag in v1 — config-file-only (proposal scope).

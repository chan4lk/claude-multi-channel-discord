# Tasks: bot-peer-limit-status-exempt

## Wave 1

- [x] T1: isStatusPost + effectiveStatusPatterns + DEFAULT_STATUS_PATTERNS in src/bot-peers.ts; statusPatterns in channels-config schemas
- [x] T2: server.ts handleBotInbound early status drop

## Wave 2

- [x] T3: bot-peers.test.ts — flood exempt, substantive trips, [] disables, invalid regex skipped; full gate

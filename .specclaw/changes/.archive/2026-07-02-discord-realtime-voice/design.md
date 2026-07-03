# Design: Real-Time Voice Support for MCD Discord Bot

**Change:** discord-realtime-voice
**Created:** 2026-05-30

## Technical Approach

Add a self-contained `VoicePipeline` class in `src/voice-pipeline.ts` that manages one `VoiceSession` per guild. The pipeline is initialized in `server.ts` alongside the existing `ProjectPool` and `Scheduler`. Discord slash commands (`/voice join/leave/status`) are handled in `src/voice-commands.ts` and registered on the Discord `ready` event.

The audio processing chain per turn:
1. `@discordjs/voice` `receiver.subscribe(userId, { end: EndBehaviorType.AfterSilence, silenceDurationMs: 1000 })` → Opus stream
2. Collect Opus frames → decode via `@discordjs/opus` → write PCM16 WAV to temp file
3. Spawn `whisper.cpp` binary: `whisper -m <model> -f <wav> --output-txt --no-timestamps` → read stdout
4. Non-empty transcript → call `anthropic.messages.stream()` with session history → collect full response text
5. Spawn `kokoro-js` or `kokoro` Python subprocess with response text → get WAV output
6. Create `createAudioResource(wavStream)` → `AudioPlayer.play()` → await `idle` event
7. Post transcript to text channel, persist to SQLite

## Architecture

```
server.ts
  ├── VoicePipeline (new)
  │     └── Map<guildId, VoiceSession>
  │           ├── VoiceConnection (@discordjs/voice)
  │           ├── Map<userId, Uint8Array[]>  ← Opus frame buffer per speaker
  │           ├── Message[]                  ← Anthropic conversation history
  │           ├── chatId                     ← associated text channel
  │           └── turnQueue: Promise          ← serializes concurrent speakers
  └── Voice slash commands (registered on ready)
        /voice join → VoicePipeline.join(guildId, voiceChannelId, chatId)
        /voice leave → VoicePipeline.leave(guildId)
        /voice status → VoicePipeline.status(guildId)

src/voice-db.ts (new)
  └── voice.db (bun:sqlite, in STATE_DIR)
        └── voice_turns table

src/voice-commands.ts (new)
  └── buildVoiceCommandHandlers(pipeline, loadConfig)
        returns SlashCommandHandler[]
```

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/voice-pipeline.ts` | CREATE | `VoicePipeline` class: join/leave/status, per-user VAD+Opus capture, whisper STT, Claude API turn, Kokoro TTS, audio playback |
| `src/voice-commands.ts` | CREATE | Discord slash command definitions + interaction handlers for `/voice join/leave/status` |
| `src/voice-db.ts` | CREATE | `bun:sqlite` DB init, `voice_turns` schema, `insertVoiceTurn()` helper |
| `src/channels-config.ts` | MODIFY | Add `VoiceProjectConfig` zod schema + optional `voice` field on `ProjectSchema` |
| `server.ts` | MODIFY | Init `VoicePipeline` in `maybeInitProjectsBackend()`; register slash commands in `ready` handler; wire `interactionCreate` for `/voice` commands |
| `package.json` | MODIFY | Add `@discordjs/voice`, `@discordjs/opus`, `kokoro-js` |

## Data Model Changes

New SQLite database: `$STATE_DIR/voice.db`

```sql
CREATE TABLE IF NOT EXISTS voice_turns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     TEXT    NOT NULL,   -- Discord text channel snowflake
  guild_id    TEXT    NOT NULL,
  user_id     TEXT    NOT NULL,
  ts          TEXT    NOT NULL,   -- ISO8601 UTC
  user_text   TEXT    NOT NULL,   -- whisper transcript
  bot_text    TEXT    NOT NULL,   -- Claude response
  duration_ms INTEGER NOT NULL    -- wall time utterance→audio-end
);
CREATE INDEX IF NOT EXISTS voice_turns_chat_ts ON voice_turns(chat_id, ts);
```

New `channels.json` project field (zod schema addition):

```typescript
const VoiceProjectConfigSchema = z.object({
  enabled: z.boolean().default(false),
  kokoroVoice: z.string().default('af_bella'),
  maxTurnSeconds: z.number().int().positive().default(30),
})
// Added to ProjectSchema as:
voice: VoiceProjectConfigSchema.optional()
```

## API Changes

New Discord slash commands registered on bot ready:
- `/voice join` — no options; user must be in a voice channel
- `/voice leave` — no options
- `/voice status` — no options

All replies are ephemeral (visible only to the invoking user).

## Key Decisions

**D1: bun:sqlite over better-sqlite3 for voice.db**
`server.ts` runs in Bun runtime. `bun:sqlite` is zero-install, no native binding needed. `better-sqlite3` is used in the Next.js mission-control app because that app runs in Node.js. Mixing is fine — different processes, different files.

**D2: Separate voice.db, not mc.db**
`mc.db` is owned by the mission-control Next.js app. Writing to it from `server.ts` creates a cross-process write contention risk. `voice.db` is bot-owned.

**D3: kokoro-js npm over Python subprocess**
`kokoro-js` runs in JS/Bun context, avoids Python startup overhead (~300ms). Falls back to Python if `kokoro-js` is unavailable — the pipeline wrapper abstracts this.

**D4: One Claude turn at a time per voice session (serial queue)**
Parallel Claude turns for simultaneous speakers would produce interleaved audio playback and confused conversation history. A `turnQueue` promise chains turns. Utterances queued while a turn is in-flight are processed in order.

**D5: whisper.cpp via child_process spawn, not node-whisper**
`node-whisper` is a thin wrapper but adds an npm dependency and version-locks the binary interface. Direct `Bun.spawn(['whisper', '-m', model, '-f', wav, '--output-txt'])` is simpler and decouples from npm release cadence.

**D6: Conversation history in-memory, cleared on session end**
Proposal resolution: not persisted across restarts. The `voice_turns` SQLite log is the audit trail; it is not replayed into history on reconnect (too complex for v1).

**D7: System prompt from project's CLAUDE.md**
On `/voice join`, pipeline reads the project's `CLAUDE.md` file and uses its contents as the system prompt for the Anthropic API conversation. This gives voice turns the same persona/instructions as text turns.

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `@discordjs/opus` native binding fails to build | Medium | Document that `libopus-dev` and `node-gyp` must be available; add build check at startup |
| whisper.cpp binary not on PATH | High (first deploy) | Check at `/voice join` time, return operator-readable error + ephemeral Discord error |
| `kokoro-js` not yet stable for Bun | Medium | Implement Python subprocess fallback in `src/voice-pipeline.ts` behind feature flag |
| Audio latency > 10s on CPU-only host | Medium | whisper tiny is ~1s; Kokoro CPU ~2-3s; Claude API ~2-3s — total ~6-7s nominal. Document that GPU reduces this |
| Concurrent speaker queue growing unbounded | Low | Cap queue depth at 3; drop oldest if exceeded, log warning |
| Voice session memory leak on crash | Low | Attach `voiceStateUpdate` handler to detect bot kicked from voice; tear down session |

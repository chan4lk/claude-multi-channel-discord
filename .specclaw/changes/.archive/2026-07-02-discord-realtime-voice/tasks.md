# Tasks: Real-Time Voice Support for MCD Discord Bot

**Change:** discord-realtime-voice
**Created:** 2026-05-30
**Total Tasks:** 8

## Summary

3 waves. Wave 1 installs dependencies and wires config schema. Wave 2 builds the core voice pipeline (audio capture → STT → Claude → TTS → playback) in `src/voice-pipeline.ts`. Wave 3 adds slash commands, DB persistence, and wires everything into `server.ts`.

## Tasks

### Wave 1 — Foundation

- [x] `T1` — Add dependencies + voice config schema
  - Files: `package.json`, `src/channels-config.ts`
  - Estimate: small
  - Depends: —
  - Notes: Add `@discordjs/voice`, `@discordjs/opus`, `kokoro-js` to `package.json`. Add `VoiceProjectConfigSchema` (enabled, kokoroVoice, maxTurnSeconds with defaults) and optional `voice` field to `ProjectSchema` in `channels-config.ts`. Run `bun tsc --noEmit` to confirm types pass.

### Wave 2 — Core Pipeline

- [x] `T2` — Audio capture + VAD (src/voice-pipeline.ts, part 1)
  - Files: `src/voice-pipeline.ts` (CREATE)
  - Estimate: large
  - Depends: T1
  - Notes: Implement `VoicePipeline` class with `join(guildId, voiceChannelId, chatId, voiceConfig)`, `leave(guildId)`, `status(guildId)`. On join: create `VoiceConnection`, subscribe to `connectionReady`. For each speaker: `receiver.subscribe(userId, { end: EndBehaviorType.AfterSilence, silenceDurationMs: 1000 })` — collect Opus frames into per-user `Uint8Array[]` buffer. On stream `end` event: pass buffer to STT stage. Handle `voiceStateUpdate` on bot kicked.

- [x] `T3` — STT: Opus → PCM → whisper.cpp (src/voice-pipeline.ts, part 2)
  - Files: `src/voice-pipeline.ts` (MODIFY)
  - Estimate: medium
  - Depends: T2
  - Notes: Decode Opus frames to PCM16 using `@discordjs/opus` `OpusEncoder.decode()`. Write to temp WAV file (`/tmp/mcd-voice-<id>.wav`) with correct 48kHz/16bit/1ch header. Spawn `whisper` binary: `Bun.spawn(['whisper', '-m', modelPath, '-f', wavPath, '--output-txt', '--no-timestamps', '-l', 'en'])`. Read stdout for transcript. Kill process if `maxTurnSeconds` exceeded. Delete temp WAV after. Empty transcript → skip turn silently.

- [x] `T4` — Claude streaming API turn (src/voice-pipeline.ts, part 3)
  - Files: `src/voice-pipeline.ts` (MODIFY)
  - Estimate: medium
  - Depends: T3
  - Notes: On non-empty transcript: push user message to session `history` array. Call `anthropic.messages.stream({ model, system, messages: history, max_tokens: 1024 })`. Collect full `finalMessage.content[0].text`. Push assistant message to history. On API error: post error to text channel, do not kill voice session. Use project's provider config (same `resolveProvider()` logic as text pipeline).

- [x] `T5` — Kokoro TTS + Discord audio playback (src/voice-pipeline.ts, part 4)
  - Files: `src/voice-pipeline.ts` (MODIFY)
  - Estimate: medium
  - Depends: T4
  - Notes: Call Kokoro via `kokoro-js` API: `const kokoro = await KokoroTTS.from_pretrained(...); const audio = await kokoro.generate(text, { voice: kokoroVoice })`. Write WAV to temp file. Create `createAudioResource(fs.createReadStream(wavPath))`. `AudioPlayer.play(resource)`. Await `idle` event. Delete temp WAV. Implement Python subprocess fallback: `python3 -c "from kokoro import KPipeline; ..."` if `kokoro-js` throws on import. Kill subprocess if `maxTurnSeconds` exceeded.

### Wave 3 — Commands, Wiring, Persistence

- [x] `T6` — Slash commands (src/voice-commands.ts)
  - Files: `src/voice-commands.ts` (CREATE)
  - Estimate: small
  - Depends: T2
  - Notes: Export `voiceSlashCommands: RESTPostAPIApplicationGuildCommandsJSONBody[]` (the command definitions). Export `handleVoiceInteraction(interaction, pipeline, loadConfig)`. For `/voice join`: resolve user's current voice channel from `interaction.member.voice.channel`; load project config for `interaction.channelId`; check `voice.enabled`; call `pipeline.join(...)`. All replies `ephemeral: true`. `/voice leave` and `/voice status` straightforward.

- [x] `T7` — SQLite persistence (src/voice-db.ts)
  - Files: `src/voice-db.ts` (CREATE)
  - Estimate: small
  - Depends: —
  - Notes: Use `bun:sqlite`. Open `$STATE_DIR/voice.db`. `CREATE TABLE IF NOT EXISTS voice_turns (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, ts TEXT NOT NULL, user_text TEXT NOT NULL, bot_text TEXT NOT NULL, duration_ms INTEGER NOT NULL)`. Export `insertVoiceTurn(row)`. Create index on `(chat_id, ts)`.

- [x] `T8` — server.ts wiring + transcript-to-text-channel
  - Files: `server.ts`
  - Estimate: medium
  - Depends: T5, T6, T7
  - Notes: In `maybeInitProjectsBackend()`: init `VoicePipeline` with `onTurnComplete` callback that (a) calls `insertVoiceTurn()`, (b) fetches the text channel and posts transcript message. In `ready` handler: register slash commands via `client.application.commands.set(voiceSlashCommands)`. In `interactionCreate` handler: check `interaction.isChatInputCommand() && interaction.commandName === 'voice'`, delegate to `handleVoiceInteraction`. Run `bun tsc --noEmit` after.

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed

**Task format:**
```
- [ ] `T<n>` — <title>
  - Files: <files to create/modify>
  - Estimate: small | medium | large
  - Depends: <task ids> (if any)
  - Notes: <additional context>
```

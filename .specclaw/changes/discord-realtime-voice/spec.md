# Spec: Real-Time Voice Support for MCD Discord Bot

**Change:** discord-realtime-voice
**Created:** 2026-05-30
**Status:** 🟡 Draft

## Overview

Add a parallel voice pipeline to MCD that lets Claude participate in Discord voice channels. Users join a voice channel, invoke `/voice join` from the associated text channel, and the bot joins and begins listening. Each utterance is transcribed by local whisper.cpp (tiny model), sent to the Anthropic streaming API, and Claude's response is synthesized by Kokoro TTS and played back in the voice channel. After each turn, a transcript is posted to the text channel and persisted to SQLite. This pipeline operates entirely independently of the existing tmux/claude-CLI text pipeline.

## Requirements

### Functional Requirements

- **FR1:** `/voice join` slash command — bot joins the voice channel the commanding user is currently in. Fails with ephemeral error if the project has `voice.enabled = false` or if the user is not in a voice channel.
- **FR2:** `/voice leave` slash command — bot disconnects from the voice channel it is currently in for that guild.
- **FR3:** `/voice status` slash command — shows whether bot is in a voice channel for this guild and which channel.
- **FR4:** Always-on VAD — bot subscribes to each active speaker's Opus stream; silence ≥ 1000ms marks end-of-utterance.
- **FR5:** STT — utterance Opus frames decoded to PCM16 WAV, passed to local whisper.cpp `tiny` model. Transcript returned as UTF-8 text.
- **FR6:** Claude turn — transcript sent to Anthropic streaming API (`anthropic.messages.stream`) with per-session conversation history. Model and system prompt sourced from the project's `channels.json` config.
- **FR7:** TTS — Claude's text response synthesized by Kokoro TTS (voice per project config), output WAV streamed as Discord audio resource.
- **FR8:** Transcript post — after each completed turn, a formatted message is posted to the associated text channel: `🎙️ [username]: <user speech>\n🤖 Claude: <response>`.
- **FR9:** Persistence — each voice turn written to `voice_turns` SQLite table (chat_id, guild_id, user_id, ts, user_text, bot_text, duration_ms).
- **FR10:** Per-project voice config — `channels.json` projects support optional `voice: { enabled, kokoroVoice, maxTurnSeconds }` field. Defaults: `enabled: false`, `kokoroVoice: "af_bella"`, `maxTurnSeconds: 30`.
- **FR11:** Conversation memory scoped to voice session lifetime — history cleared when bot leaves or is disconnected.

### Non-Functional Requirements

- **NFR1:** Turn latency (end of speech → audio starts playing) ≤ 10s on modern hardware with whisper tiny + CPU Kokoro.
- **NFR2:** Concurrent speakers handled independently — separate VAD buffers per user; only one Claude turn in-flight per voice session at a time (queue if simultaneous utterances).
- **NFR3:** No memory leaks — voice session cleaned up fully (subscriptions, buffers, AudioPlayer) on disconnect.
- **NFR4:** Host resource bounding — whisper and Kokoro subprocesses killed if they exceed `maxTurnSeconds`.
- **NFR5:** Zero API calls — all STT and TTS fully local; only Anthropic API called for Claude turn (uses existing project provider config).

## Acceptance Criteria

- **AC1:** User is in voice channel → `/voice join` in associated text channel → bot appears in voice channel within 3s.
- **AC2:** `/voice join` when `voice.enabled = false` for project → ephemeral error "voice not enabled for this project".
- **AC3:** `/voice join` when user not in any voice channel → ephemeral error "you must be in a voice channel first".
- **AC4:** Bot in voice → user speaks → silence detected → whisper transcript produced → Claude responds → TTS audio plays in voice channel. End-to-end within 10s.
- **AC5:** After each turn, text channel receives transcript post with user speech and Claude response.
- **AC6:** `voice_turns` table in SQLite contains a row for each completed turn with correct chat_id, user_id, ts, user_text, bot_text.
- **AC7:** `/voice leave` → bot leaves voice channel, session history cleared.
- **AC8:** `/voice status` → shows "In voice channel: #channel-name" or "Not in a voice channel".
- **AC9:** Empty transcript (silence, noise) → no Claude turn triggered, no transcript post.
- **AC10:** whisper.cpp binary not found at configured path → `/voice join` fails with operator-readable error in stderr; ephemeral Discord error.

## Edge Cases

- User leaves voice channel mid-turn → turn completes if whisper/Claude/TTS already in-flight; bot does not auto-leave.
- Bot disconnected from voice by admin → voice session torn down, history cleared, no crash.
- Two users speak simultaneously → second utterance queued; processed after first turn completes.
- Claude response is very long → TTS processes full text; no truncation (Kokoro handles multi-sentence).
- whisper produces empty string (noise-only) → turn skipped silently.
- Anthropic API error during voice turn → error posted to text channel as plain text, bot remains in voice channel.
- Kokoro subprocess fails → error posted to text channel, bot remains in voice.
- `maxTurnSeconds` exceeded → subprocess killed, error posted to text channel.

## Dependencies

- `@discordjs/voice` — voice connection, audio receiver, AudioPlayer
- `@discordjs/opus` — Opus codec bindings (native; requires build tools or pre-built binary)
- `kokoro-js` — Kokoro TTS npm package (preferred over Python subprocess for Bun compatibility)
- `whisper.cpp` binary installed on host (operator responsible) + `ggml-tiny.en.bin` model
- `@anthropic-ai/sdk` — already available via Claude Code install; used for streaming API
- `bun:sqlite` — Bun built-in SQLite for voice_turns persistence

## Notes

- Voice pipeline is entirely independent of tmux/claude-CLI. No MCP tools, no file access, no session resume for voice turns.
- The `voice` config field on a project defaults `enabled: false` — no project gets voice unless explicitly opted in.
- `src/voice-db.ts` owns the `voice_turns` SQLite file. A separate DB file (`voice.db` in `STATE_DIR`) is used rather than piggy-backing on `mc.db` (which belongs to the mission-control Next.js app).

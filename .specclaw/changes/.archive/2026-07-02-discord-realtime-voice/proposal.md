# Proposal: Real-Time Voice Support for MCD Discord Bot

**Created:** 2026-05-30
**Status:** 🟡 Draft

## Problem

MCD is text-only. Users who want a conversational AI assistant in Discord voice channels can't use it. The current tmux → claude CLI pipeline has 3–5s minimum latency, making it fundamentally unsuitable for voice turns — but the demand for voice-accessible AI in Discord is real and growing.

## Proposed Solution

Add a parallel voice pipeline that operates independently of the text pipeline:

### 1. Voice channel join/leave
- Bot listens for `/voice join` and `/voice leave` slash commands (or `!project voice join/leave` master commands)
- Uses `@discordjs/voice` to connect to voice channels in the same guild
- One voice connection per guild (not per text channel)

### 2. Audio capture and transcription
- Capture Opus audio streams per speaker via `@discordjs/voice` `receiver.subscribe(userId)`
- Decode Opus → PCM, pipe to local **whisper.cpp** via `node-whisper` or child_process spawn
- VAD (voice activity detection) — silence threshold determines end-of-utterance before sending to STT
- Model file (e.g. `ggml-small.en.bin`) path configurable in `voice` config

### 3. Claude streaming via API (bypasses tmux/CLI)
- Voice turns call Anthropic streaming API directly (`anthropic.messages.stream`) — not the claude CLI
- Each voice session maintains a conversation history array (in-memory, scoped to voice connection lifetime)
- Model/system prompt pulled from the project config for that guild's associated text channel

### 4. Text-to-speech reply
- Synthesize Claude's response via local **Kokoro TTS** (via Python subprocess or `kokoro-js` npm package)
- Kokoro produces WAV/PCM output; pipe into `@discordjs/voice` `AudioPlayer` + `createAudioResource`
- Voice/speaker configurable (Kokoro supports multiple voices)

### 5. Configuration
- New `voice` section in `channels.json` defaults: `{ enabled, sttProvider, ttsProvider, model, maxTurnSeconds }`
- Per-guild voice config inheritable from defaults

## Scope

### In Scope
- `src/voice-pipeline.ts` (CREATE) — VoiceConnection manager, audio capture, STT, TTS, playback
- `src/voice-commands.ts` (CREATE) — slash command handlers (`/voice join`, `/voice leave`, `/voice status`)
- `server.ts` — wire voice pipeline into Discord client; register slash commands on ready
- `src/channels-config.ts` — add `voice` config section to zod schema
- `package.json` — add `@discordjs/voice`, `@discordjs/opus`, `node-whisper` (or spawn whisper.cpp binary)
- whisper.cpp binary + model file (`ggml-small.en.bin` or similar) installed on host
- Kokoro TTS (`kokoro-js` npm package or Python `kokoro` subprocess)
- Per-project voice config in `channels.json`: `{ enabled, whisperModel, kokoroVoice, maxTurnSeconds }`
- Voice transcript persistence to SQLite (new `voice_turns` table)
- Voice turn transcript posted to associated text channel after each turn

### Out of Scope
- Persistent voice conversation history across reconnects
- Multi-speaker diarization (who said what attribution in transcripts)
- API-based STT/TTS (all local — no Whisper API, no OpenAI TTS)
- Voice in DMs or group DMs
- Streaming audio response (TTS plays complete utterance, not token-by-token streaming)
- Push-to-talk mode (always-on VAD only in v1)

## Impact

- **Files affected:** ~4 new + 3 modified
- **Complexity:** high — new subsystem, audio codec handling, concurrent async streams per speaker
- **Risk:** medium-high
  - `@discordjs/voice` requires native Opus bindings (`@discordjs/opus`) — needs build tooling / pre-built binary
  - whisper.cpp must be installed on host with model file; spawn latency ~1-3s per utterance (small model)
  - Kokoro TTS latency depends on model size and host CPU/GPU
  - VAD threshold tuning affects UX significantly
  - Zero API costs — fully local, but host resource usage (CPU/RAM) is real
  - Voice pipeline is independent of tmux/claude-CLI — no session resume, no MCP tools, no file access

## Open Questions

All resolved:

1. ~~STT provider~~ → **local whisper.cpp**
2. ~~TTS provider~~ → **local Kokoro TTS**
3. ~~Post transcript to text channel?~~ → **yes** — each voice turn posts transcript to associated text channel
4. ~~Per-project vs per-guild voice config?~~ → **per-project** (each text channel project has independent voice config)
5. ~~Conversation memory~~ → **persist to SQLite** alongside text events in `mc.db` (or project-local DB)
6. ~~whisper.cpp model~~ → **tiny** (fastest, ~1s latency)
7. ~~Kokoro voice selection~~ → **per-project configurable** (voice name stored in project voice config)

---

**To proceed:** Review this proposal and approve to begin planning.

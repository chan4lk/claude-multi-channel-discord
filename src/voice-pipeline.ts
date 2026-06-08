import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  entersState,
  EndBehaviorType,
  createAudioPlayer,
  createAudioResource,
  type VoiceConnection,
  type AudioPlayer,
} from '@discordjs/voice'
import { OpusEncoder } from '@discordjs/opus'
import { writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync, unlinkSync, createReadStream } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import type { VoiceProjectConfig } from './channels-config.ts'

function voicePython(): string {
  return process.env.MCD_VOICE_PYTHON ?? `${homedir()}/.openclaw/voice-venv/bin/python`
}

function decodeOpusFramesToPcm16Mono(frames: Buffer[]): Buffer {
  const encoder = new OpusEncoder(48000, 2)
  const decoded: Buffer[] = []
  for (const frame of frames) {
    try { decoded.push(encoder.decode(frame)) } catch { /* skip malformed */ }
  }
  if (decoded.length === 0) return Buffer.alloc(0)

  const stereo = Buffer.concat(decoded)
  // stereo: 48kHz 2ch int16 LE → 16kHz 1ch int16 LE (3:1 downsample + mono mix)
  const inputSamples = Math.floor(stereo.byteLength / 4)
  const outputSamples = Math.floor(inputSamples / 3)
  const mono = Buffer.alloc(outputSamples * 2)
  for (let i = 0; i < outputSamples; i++) {
    const src = i * 3 * 4
    const l = stereo.readInt16LE(src)
    const r = stereo.readInt16LE(src + 2)
    mono.writeInt16LE(Math.round((l + r) / 2), i * 2)
  }
  return mono
}

// Decode a single Opus frame → PCM16 24kHz mono (for OpenAI Realtime API)
function decodeOpusFramePcm24kMono(frame: Buffer, encoder: OpusEncoder): Buffer {
  let stereo: Buffer
  try { stereo = encoder.decode(frame) } catch { return Buffer.alloc(0) }
  // stereo: 48kHz 2ch int16 LE → 24kHz 1ch int16 LE (2:1 downsample + mono mix)
  const inputSamples = Math.floor(stereo.byteLength / 4)
  const outputSamples = Math.floor(inputSamples / 2)
  const mono = Buffer.alloc(outputSamples * 2)
  for (let i = 0; i < outputSamples; i++) {
    const src = i * 2 * 4
    const l = stereo.readInt16LE(src)
    const r = stereo.readInt16LE(src + 2)
    mono.writeInt16LE(Math.round((l + r) / 2), i * 2)
  }
  return mono
}

function writeWav(path: string, pcm: Buffer, sampleRate: number): void {
  const header = Buffer.alloc(44)
  const dataSize = pcm.byteLength
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)   // PCM
  header.writeUInt16LE(1, 22)   // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28) // byteRate
  header.writeUInt16LE(2, 32)   // blockAlign
  header.writeUInt16LE(16, 34)  // bitsPerSample
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)
  writeFileSync(path, Buffer.concat([header, pcm]))
}

const FASTER_WHISPER_SCRIPT = `
import sys
from faster_whisper import WhisperModel
model_name, wav_path = sys.argv[1], sys.argv[2]
model = WhisperModel(model_name, device="cpu", compute_type="int8")
segs, _ = model.transcribe(wav_path, language="en")
print("".join(s.text for s in segs).strip(), end="")
`

async function runFasterWhisper(wavPath: string, maxTurnSeconds: number): Promise<string> {
  const model = process.env.MCD_WHISPER_MODEL ?? 'small.en'

  return new Promise((resolve) => {
    let out = ''
    const proc = spawn(voicePython(), ['-c', FASTER_WHISPER_SCRIPT, model, wavPath], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    proc.stdout?.on('data', (d: Buffer) => { out += d.toString() })
    const timer = setTimeout(() => { proc.kill(); resolve('') }, maxTurnSeconds * 1000)

    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? out.trim() : '')
    })
    proc.on('error', () => { clearTimeout(timer); resolve('') })
  })
}

const KOKORO_SCRIPT = `
import sys, wave, struct
from kokoro_onnx import Kokoro
model_path, voices_path, voice, out_path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
text = sys.stdin.read()
kokoro = Kokoro(model_path, voices_path)
samples, sr = kokoro.create(text, voice=voice, lang="en-us")
pcm16 = [max(-32768, min(32767, int(s * 32767))) for s in samples.tolist()]
with wave.open(out_path, "wb") as wf:
    wf.setnchannels(1)
    wf.setsampwidth(2)
    wf.setframerate(sr)
    wf.writeframes(struct.pack("<" + "h" * len(pcm16), *pcm16))
`

async function runKokoroTts(text: string, voice: string, outPath: string, maxTurnSeconds: number): Promise<boolean> {
  const modelPath = process.env.MCD_KOKORO_MODEL ??
    `${homedir()}/.claude/channels/discord-multi/projects/academy-videos/workspace/tools/tts/kokoro-v1.0.onnx`
  const voicesPath = process.env.MCD_KOKORO_VOICES ??
    `${homedir()}/.claude/channels/discord-multi/projects/academy-videos/workspace/tools/tts/voices-v1.0.bin`

  return new Promise((resolve) => {
    const proc = spawn(voicePython(), ['-c', KOKORO_SCRIPT, modelPath, voicesPath, voice, outPath], {
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    proc.stdin?.write(text)
    proc.stdin?.end()

    const timer = setTimeout(() => { proc.kill(); resolve(false) }, maxTurnSeconds * 1000)
    proc.on('close', (code) => { clearTimeout(timer); resolve(code === 0) })
    proc.on('error', () => { clearTimeout(timer); resolve(false) })
  })
}

export interface VoiceTurnResult {
  chatId: string
  guildId: string
  userId: string
  ts: string
  userText: string
  botText: string
  durationMs: number
}

interface VoiceSession {
  connection: VoiceConnection
  chatId: string
  guildId: string
  voiceChannelId: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  turnQueue: Promise<void>
  voiceConfig: VoiceProjectConfig
  audioPlayer: AudioPlayer
  systemPrompt: string
  projectDir: string
  // OpenAI Realtime provider fields
  realtimeWs?: WebSocket
  realtimeAudioChunks?: Buffer[]
  realtimeUserText?: string
  realtimeBotText?: string
  realtimeTurnStart?: number
  realtimeLastUserId?: string
  realtimeEncoder?: OpusEncoder
}

export class VoicePipeline {
  private sessions = new Map<string, VoiceSession>()
  private onTurnComplete: (result: VoiceTurnResult) => Promise<void>

  constructor(opts: { onTurnComplete: (result: VoiceTurnResult) => Promise<void> }) {
    this.onTurnComplete = opts.onTurnComplete
  }

  async join(opts: {
    guildId: string
    voiceChannelId: string
    adapterCreator: unknown
    chatId: string
    voiceConfig: VoiceProjectConfig
    systemPrompt: string
    projectDir: string
  }): Promise<void> {
    if (this.sessions.has(opts.guildId)) {
      this.teardown(opts.guildId)
    }

    const connection = joinVoiceChannel({
      channelId: opts.voiceChannelId,
      guildId: opts.guildId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapterCreator: opts.adapterCreator as any,
      selfDeaf: false,
      selfMute: false,
    })

    await entersState(connection, VoiceConnectionStatus.Ready, 5_000)
    process.stderr.write(`voice: joined guild ${opts.guildId} channel ${opts.voiceChannelId}\n`)

    const audioPlayer = createAudioPlayer()
    connection.subscribe(audioPlayer)

    const session: VoiceSession = {
      connection,
      chatId: opts.chatId,
      guildId: opts.guildId,
      voiceChannelId: opts.voiceChannelId,
      history: [],
      turnQueue: Promise.resolve(),
      voiceConfig: opts.voiceConfig,
      audioPlayer,
      systemPrompt: opts.systemPrompt,
      projectDir: opts.projectDir,
    }

    this.sessions.set(opts.guildId, session)
    this.attachReceiverHandlers(session)

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ])
      } catch {
        this.teardown(opts.guildId)
      }
    })
  }

  leave(guildId: string): void {
    this.teardown(guildId)
  }

  status(guildId: string): { active: boolean; voiceChannelId?: string } {
    const session = this.sessions.get(guildId)
    if (!session) return { active: false }
    return { active: true, voiceChannelId: session.voiceChannelId }
  }

  private teardown(guildId: string): void {
    const session = this.sessions.get(guildId)
    if (!session) return
    try { session.connection.destroy() } catch {}
    if (session.realtimeWs && session.realtimeWs.readyState === WebSocket.OPEN) {
      try { session.realtimeWs.close() } catch {}
    }
    this.sessions.delete(guildId)
  }

  private attachReceiverHandlers(session: VoiceSession): void {
    if (session.voiceConfig.provider === 'openai-realtime') {
      this.attachRealtimeHandlers(session)
      return
    }

    const { connection } = session

    connection.receiver.speaking.on('start', (userId: string) => {
      process.stderr.write(`voice: speaking start from ${userId} in guild ${session.guildId}\n`)
      const stream = connection.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1000,
        },
      })

      const frames: Buffer[] = []
      stream.on('data', (chunk: Buffer) => frames.push(chunk))
      stream.on('end', () => {
        process.stderr.write(`voice: utterance end from ${userId}, frames=${frames.length}\n`)
        if (frames.length === 0) return
        const framesCopy = frames.slice()
        session.turnQueue = session.turnQueue
          .then(() => this.onUtteranceEnd(session, userId, framesCopy))
          .catch((err: Error) => {
            process.stderr.write(`voice: turn error for ${userId} in guild ${session.guildId}: ${err.message}\n`)
          })
      })
    })
  }

  private attachRealtimeHandlers(session: VoiceSession): void {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      process.stderr.write(`voice: OPENAI_API_KEY not set — cannot use openai-realtime in guild ${session.guildId}\n`)
      return
    }

    session.realtimeEncoder = new OpusEncoder(48000, 2)
    session.realtimeAudioChunks = []

    const realtimeModel = process.env.MCD_REALTIME_MODEL ?? 'gpt-realtime'
    const ws = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${realtimeModel}`,
      // @ts-ignore — Bun WebSocket supports headers as second arg
      { headers: { 'Authorization': `Bearer ${apiKey}` } },
    )
    session.realtimeWs = ws

    ws.onopen = () => {
      process.stderr.write(`voice: OpenAI Realtime connected for guild ${session.guildId}\n`)
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          model: realtimeModel,
          output_modalities: ['audio'],
          instructions: session.systemPrompt,
          tools: [
            {
              type: 'function',
              name: 'list_files',
              description: 'List files in the project directory (prds/ folder and root files like BACKLOG.md)',
              parameters: {
                type: 'object',
                properties: {
                  subdir: { type: 'string', description: 'Subdirectory to list, e.g. "prds". Defaults to project root.' },
                },
                required: [],
              },
            },
            {
              type: 'function',
              name: 'read_file',
              description: 'Read a file from the project. Use paths like "BACKLOG.md" or "prds/my-feature.md".',
              parameters: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'File path relative to project root' },
                },
                required: ['path'],
              },
            },
            {
              type: 'function',
              name: 'write_file',
              description: 'Write or overwrite a file in the project. Creates parent dirs automatically. Use for saving PRDs or updating BACKLOG.md.',
              parameters: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'File path relative to project root, e.g. "prds/my-feature.md"' },
                  content: { type: 'string', description: 'Full file content to write' },
                },
                required: ['path', 'content'],
              },
            },
          ],
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24000 },
              turn_detection: { type: 'none' },
            },
            output: {
              format: { type: 'audio/pcm', rate: 24000 },
              voice: 'alloy',
            },
          },
        },
      }))
    }

    ws.onmessage = (event: MessageEvent) => {
      try {
        let raw: string
        if (typeof event.data === 'string') {
          raw = event.data
        } else if (event.data instanceof ArrayBuffer) {
          raw = Buffer.from(event.data).toString('utf8')
        } else {
          raw = Buffer.from(event.data as Uint8Array).toString('utf8')
        }
        const msg = JSON.parse(raw) as { type: string; [key: string]: unknown }
        if (msg.type.includes('output_audio') && msg.type.includes('delta')) {
          process.stderr.write(`voice: realtime audio delta keys=${Object.keys(msg).join(',')} guild=${session.guildId}\n`)
        } else if (!msg.type.includes('delta')) {
          process.stderr.write(`voice: realtime event type=${msg.type} guild=${session.guildId}\n`)
        }
        this.handleRealtimeEvent(session, msg)
      } catch (err) {
        process.stderr.write(`voice: realtime onmessage parse error: ${(err as Error).message}\n`)
      }
    }

    ws.onerror = () => {
      process.stderr.write(`voice: Realtime WS error in guild ${session.guildId}\n`)
    }

    ws.onclose = () => {
      process.stderr.write(`voice: Realtime WS closed for guild ${session.guildId}\n`)
    }

    const { connection } = session
    connection.receiver.speaking.on('start', (userId: string) => {
      process.stderr.write(`voice: realtime speaking start from ${userId} in guild ${session.guildId}\n`)
      session.realtimeLastUserId = userId
      if (!session.realtimeTurnStart) session.realtimeTurnStart = Date.now()

      const stream = connection.receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 1500 },
      })

      stream.on('data', (chunk: Buffer) => {
        if (!session.realtimeEncoder || ws.readyState !== WebSocket.OPEN) return
        const pcm24k = decodeOpusFramePcm24kMono(chunk, session.realtimeEncoder)
        if (pcm24k.byteLength === 0) return
        ws.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: pcm24k.toString('base64'),
        }))
      })

      stream.on('end', () => {
        if (ws.readyState !== WebSocket.OPEN) return
        process.stderr.write(`voice: realtime committing audio buffer for guild ${session.guildId}\n`)
        ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
      })
    })
  }

  private handleRealtimeEvent(session: VoiceSession, event: { type: string; [key: string]: unknown }): void {
    switch (event.type) {
      case 'response.audio.delta':
      case 'response.output_audio.delta': {
        const audioB64 = (event.delta ?? event.audio) as string | undefined
        if (audioB64) session.realtimeAudioChunks?.push(Buffer.from(audioB64, 'base64'))
        break
      }
      case 'response.audio.done':
      case 'response.output_audio.done': {
        session.turnQueue = session.turnQueue
          .then(() => this.playRealtimeAudio(session))
          .catch((err: Error) => {
            process.stderr.write(`voice: realtime playback error: ${err.message}\n`)
          })
        break
      }
      case 'response.audio_transcript.done':
      case 'response.output_audio_transcript.done': {
        session.realtimeBotText = (event.transcript ?? event.text) as string
        break
      }
      case 'conversation.item.input_audio_transcription.completed': {
        session.realtimeUserText = (event.transcript as string) ?? ''
        break
      }
      case 'response.done': {
        const userText = session.realtimeUserText ?? ''
        const botText = session.realtimeBotText ?? ''
        const userId = session.realtimeLastUserId ?? 'unknown'
        const durationMs = Date.now() - (session.realtimeTurnStart ?? Date.now())
        session.realtimeUserText = undefined
        session.realtimeBotText = undefined
        session.realtimeTurnStart = undefined
        if (userText || botText) {
          this.onTurnComplete({
            chatId: session.chatId,
            guildId: session.guildId,
            userId,
            ts: new Date().toISOString(),
            userText,
            botText,
            durationMs,
          }).catch((err: Error) => {
            process.stderr.write(`voice: onTurnComplete error: ${err.message}\n`)
          })
        }
        break
      }
      case 'response.function_call_arguments.done': {
        const name = event.name as string
        const callId = event.call_id as string
        let args: Record<string, string> = {}
        try { args = JSON.parse(event.arguments as string) } catch {}
        process.stderr.write(`voice: tool call name=${name} args=${JSON.stringify(args)} guild=${session.guildId}\n`)
        const output = this.executeFilesystemTool(session.projectDir, name, args)
        if (session.realtimeWs && session.realtimeWs.readyState === WebSocket.OPEN) {
          session.realtimeWs.send(JSON.stringify({
            type: 'conversation.item.create',
            item: { type: 'function_call_output', call_id: callId, output },
          }))
          session.realtimeWs.send(JSON.stringify({ type: 'response.create' }))
        }
        break
      }
      case 'error': {
        process.stderr.write(`voice: Realtime API error: ${JSON.stringify(event.error)}\n`)
        break
      }
    }
  }

  private executeFilesystemTool(projectDir: string, name: string, args: Record<string, string>): string {
    try {
      if (name === 'list_files') {
        const subdir = args.subdir ?? ''
        const target = subdir ? join(projectDir, subdir) : projectDir
        if (!existsSync(target)) return `Directory not found: ${subdir || '.'}`
        const entries = readdirSync(target, { withFileTypes: true })
        return entries.map(e => e.isDirectory() ? `${e.name}/` : e.name).join('\n') || '(empty)'
      }
      if (name === 'read_file') {
        const safePath = resolve(projectDir, args.path ?? '')
        if (!safePath.startsWith(projectDir)) return 'Error: path outside project directory'
        if (!existsSync(safePath)) return `File not found: ${args.path}`
        return readFileSync(safePath, 'utf8')
      }
      if (name === 'write_file') {
        const safePath = resolve(projectDir, args.path ?? '')
        if (!safePath.startsWith(projectDir)) return 'Error: path outside project directory'
        const dir = join(safePath, '..')
        mkdirSync(dir, { recursive: true })
        writeFileSync(safePath, args.content ?? '', 'utf8')
        return `Written: ${relative(projectDir, safePath)}`
      }
      return `Unknown tool: ${name}`
    } catch (err) {
      return `Error: ${(err as Error).message}`
    }
  }

  private async playRealtimeAudio(session: VoiceSession): Promise<void> {
    const chunks = session.realtimeAudioChunks ?? []
    session.realtimeAudioChunks = []
    if (chunks.length === 0) return
    const pcm = Buffer.concat(chunks)
    const wavPath = `/tmp/mcd-rt-${randomBytes(6).toString('hex')}.wav`
    try {
      writeWav(wavPath, pcm, 24000)
      const resource = createAudioResource(createReadStream(wavPath))
      session.audioPlayer.play(resource)
      await entersState(session.audioPlayer, AudioPlayerStatus.Idle, session.voiceConfig.maxTurnSeconds * 1000)
    } catch (err) {
      process.stderr.write(`voice: realtime audio playback error: ${(err as Error).message}\n`)
    } finally {
      try { unlinkSync(wavPath) } catch {}
    }
  }

  protected async onUtteranceEnd(
    session: VoiceSession,
    userId: string,
    frames: Buffer[],
  ): Promise<void> {
    const start = Date.now()

    const pcm = decodeOpusFramesToPcm16Mono(frames)
    if (pcm.byteLength === 0) return

    const wavPath = `/tmp/mcd-voice-${randomBytes(6).toString('hex')}.wav`
    writeWav(wavPath, pcm, 16000)

    let userText: string
    try {
      userText = await runFasterWhisper(wavPath, session.voiceConfig.maxTurnSeconds)
    } finally {
      try { unlinkSync(wavPath) } catch {}
    }

    process.stderr.write(`voice: STT result="${userText}" guild=${session.guildId}\n`)
    if (!userText) return // AC9: empty transcript → skip

    // T4: Claude API call (filled in next)
    const botText = await this.claudeTurn(session, userId, userText)
    if (!botText) return

    // T5: TTS + playback (filled in next)
    await this.ttsTurn(session, botText)

    await this.onTurnComplete({
      chatId: session.chatId,
      guildId: session.guildId,
      userId,
      ts: new Date().toISOString(),
      userText,
      botText,
      durationMs: Date.now() - start,
    })
  }

  protected async claudeTurn(session: VoiceSession, _userId: string, userText: string): Promise<string> {
    session.history.push({ role: 'user', content: userText })

    // Build prompt from history for claude -p (no API key needed — uses OAuth)
    const historyLines = session.history.map(m =>
      `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`
    ).join('\n')

    let botText = ''
    try {
      botText = await new Promise<string>((resolve, reject) => {
        const claudeBin = process.env.MCD_CLAUDE_BIN ?? 'claude'
        const args = ['-p', historyLines, '--system-prompt', session.systemPrompt, '--model', 'claude-sonnet-4-6']
        const proc = spawn(claudeBin, args, { env: process.env })
        let out = ''
        let err = ''
        proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
        proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
        proc.on('close', code => {
          if (code !== 0) reject(new Error(err || `claude exited ${code}`))
          else resolve(out.trim())
        })
      })
    } catch (err) {
      process.stderr.write(`voice: Claude error in guild ${session.guildId}: ${(err as Error).message}\n`)
      return ''
    }

    if (botText) session.history.push({ role: 'assistant', content: botText })
    return botText
  }

  protected async ttsTurn(session: VoiceSession, botText: string): Promise<void> {
    const wavPath = `/tmp/mcd-tts-${randomBytes(6).toString('hex')}.wav`
    try {
      const ok = await runKokoroTts(botText, session.voiceConfig.kokoroVoice, wavPath, session.voiceConfig.maxTurnSeconds)
      if (!ok) {
        process.stderr.write(`voice: TTS subprocess failed in guild ${session.guildId}\n`)
        return
      }
      const resource = createAudioResource(createReadStream(wavPath))
      session.audioPlayer.play(resource)
      await entersState(session.audioPlayer, AudioPlayerStatus.Idle, session.voiceConfig.maxTurnSeconds * 1000)
    } catch (err) {
      process.stderr.write(`voice: TTS error in guild ${session.guildId}: ${(err as Error).message}\n`)
    } finally {
      try { unlinkSync(wavPath) } catch {}
    }
  }
}

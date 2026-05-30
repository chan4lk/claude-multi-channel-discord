import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  EndBehaviorType,
  createAudioPlayer,
  type VoiceConnection,
  type AudioPlayer,
} from '@discordjs/voice'
import { OpusEncoder } from '@discordjs/opus'
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import Anthropic from '@anthropic-ai/sdk'
import type { VoiceProjectConfig } from './channels-config.ts'

const anthropic = new Anthropic()

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

async function runWhisper(wavPath: string, maxTurnSeconds: number): Promise<string> {
  const bin = process.env.MCD_WHISPER_BIN ?? 'whisper'
  const model = process.env.MCD_WHISPER_MODEL ?? 'ggml-tiny.en.bin'
  const outTxt = `${wavPath}.txt`

  return new Promise((resolve) => {
    const proc = spawn(bin, ['-m', model, '-f', wavPath, '-otxt', '-nt', '-np'], {
      stdio: 'ignore',
    })

    const timer = setTimeout(() => { proc.kill(); resolve('') }, maxTurnSeconds * 1000)

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) { resolve(''); return }
      try { resolve(readFileSync(outTxt, 'utf8').trim()) } catch { resolve('') }
      try { unlinkSync(outTxt) } catch {}
    })

    proc.on('error', () => { clearTimeout(timer); resolve('') })
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
    this.sessions.delete(guildId)
  }

  private attachReceiverHandlers(session: VoiceSession): void {
    const { connection } = session

    connection.receiver.speaking.on('start', (userId: string) => {
      const stream = connection.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1000,
        },
      })

      const frames: Buffer[] = []
      stream.on('data', (chunk: Buffer) => frames.push(chunk))
      stream.on('end', () => {
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
      userText = await runWhisper(wavPath, session.voiceConfig.maxTurnSeconds)
    } finally {
      try { unlinkSync(wavPath) } catch {}
    }

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

    let botText = ''
    try {
      const stream = anthropic.messages.stream({
        model: 'claude-sonnet-4-6',
        system: session.systemPrompt,
        messages: session.history,
        max_tokens: 1024,
      })
      const msg = await stream.finalMessage()
      botText = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
    } catch (err) {
      process.stderr.write(`voice: Claude API error in guild ${session.guildId}: ${(err as Error).message}\n`)
      return ''
    }

    if (botText) session.history.push({ role: 'assistant', content: botText })
    return botText
  }

  // Filled in by T5
  protected async ttsTurn(_session: VoiceSession, _botText: string): Promise<void> {}
}

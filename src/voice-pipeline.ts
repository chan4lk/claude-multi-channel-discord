import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  EndBehaviorType,
  createAudioPlayer,
  type VoiceConnection,
  type AudioPlayer,
} from '@discordjs/voice'
import type { VoiceProjectConfig } from './channels-config.ts'

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

  // Filled in by T3 (STT), T4 (Claude API), T5 (TTS)
  protected async onUtteranceEnd(
    _session: VoiceSession,
    _userId: string,
    _frames: Buffer[],
  ): Promise<void> {}
}

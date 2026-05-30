import {
  type ChatInputCommandInteraction,
  type RESTPostAPIApplicationGuildCommandsJSONBody,
  GuildMember,
  ChannelType,
} from 'discord.js'
import { loadConfig, findProjectByChatId } from './channels-config.ts'
import type { VoicePipeline } from './voice-pipeline.ts'
import { existsSync, readFileSync } from 'node:fs'
import { projectDir } from './paths.ts'

export const voiceSlashCommands: RESTPostAPIApplicationGuildCommandsJSONBody[] = [
  {
    name: 'voice',
    description: 'Control Claude voice participation in a voice channel',
    options: [
      {
        type: 1, // SUB_COMMAND
        name: 'join',
        description: 'Have Claude join the voice channel you are currently in',
      },
      {
        type: 1,
        name: 'leave',
        description: 'Have Claude leave the current voice channel',
      },
      {
        type: 1,
        name: 'status',
        description: 'Show whether Claude is in a voice channel for this guild',
      },
    ],
  },
]

export async function handleVoiceInteraction(
  interaction: ChatInputCommandInteraction,
  pipeline: VoicePipeline,
): Promise<void> {
  const sub = interaction.options.getSubcommand()

  if (sub === 'leave') {
    const guildId = interaction.guildId
    if (!guildId) {
      await interaction.reply({ content: 'Voice commands only work in a server.', ephemeral: true })
      return
    }
    const { active } = pipeline.status(guildId)
    if (!active) {
      await interaction.reply({ content: 'Not in a voice channel.', ephemeral: true })
      return
    }
    pipeline.leave(guildId)
    await interaction.reply({ content: 'Left the voice channel.', ephemeral: true })
    return
  }

  if (sub === 'status') {
    const guildId = interaction.guildId
    if (!guildId) {
      await interaction.reply({ content: 'Voice commands only work in a server.', ephemeral: true })
      return
    }
    const st = pipeline.status(guildId)
    const msg = st.active
      ? `In voice channel: <#${st.voiceChannelId}>`
      : 'Not in a voice channel.'
    await interaction.reply({ content: msg, ephemeral: true })
    return
  }

  // join
  const guildId = interaction.guildId
  if (!guildId) {
    await interaction.reply({ content: 'Voice commands only work in a server.', ephemeral: true })
    return
  }

  const member = interaction.member
  if (!(member instanceof GuildMember) || !member.voice.channel) {
    await interaction.reply({ content: 'You must be in a voice channel first.', ephemeral: true })
    return
  }

  const voiceChannel = member.voice.channel
  if (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice) {
    await interaction.reply({ content: 'Unsupported voice channel type.', ephemeral: true })
    return
  }

  const chatId = interaction.channelId
  const config = loadConfig()
  const project = findProjectByChatId(config, chatId)

  if (!project) {
    await interaction.reply({ content: 'No project configured for this text channel.', ephemeral: true })
    return
  }

  const voiceConfig = project.voice
  if (!voiceConfig?.enabled) {
    await interaction.reply({ content: 'Voice is not enabled for this project.', ephemeral: true })
    return
  }

  // Load system prompt from project CLAUDE.md
  let systemPrompt = `You are a voice assistant named Claude in a Discord voice channel for the project "${project.slug}". Keep responses concise for voice.`
  try {
    const claudeMdPath = `${projectDir(project.slug)}/CLAUDE.md`
    if (existsSync(claudeMdPath)) {
      systemPrompt = readFileSync(claudeMdPath, 'utf8')
    }
  } catch {}

  await interaction.deferReply({ ephemeral: true })

  try {
    await pipeline.join({
      guildId,
      voiceChannelId: voiceChannel.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      chatId,
      voiceConfig,
      systemPrompt,
    })
    await interaction.editReply(`Joined <#${voiceChannel.id}>. Listening...`)
  } catch (err) {
    process.stderr.write(`voice: failed to join channel in guild ${guildId}: ${(err as Error).message}\n`)
    await interaction.editReply(`Failed to join voice channel: ${(err as Error).message}`)
  }

}

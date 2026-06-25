import {
  type ChatInputCommandInteraction,
  type RESTPostAPIApplicationGuildCommandsJSONBody,
} from 'discord.js'
import { handleModel, type MasterContext, type MasterMutator } from './master-commands.ts'

/**
 * `/model` Discord native slash command. Unlike the master-channel
 * `!project model <slug>` verb, this operates on the project bound to the
 * channel the command is invoked in — no slug needed. Mirrors the
 * `/voice` command pattern (see voice-commands.ts).
 *
 *   /model show           — view the channel's current model
 *   /model set name:<m>    — set --model for this channel's project
 *   /model clear           — fall back to defaults.model
 *
 * Setting/clearing kills the running subprocess (via the mutator) so the
 * next message respawns with the new model. handleModel() reloads config
 * internally, so the synthesized MasterContext only needs the mutator.
 */
export const modelSlashCommands: RESTPostAPIApplicationGuildCommandsJSONBody[] = [
  {
    name: 'model',
    description: "View or change Claude's model for this channel's project",
    options: [
      {
        type: 1, // SUB_COMMAND
        name: 'show',
        description: 'Show the current model for this channel',
      },
      {
        type: 1,
        name: 'set',
        description: 'Set the model for this channel (respawns the subprocess)',
        options: [
          {
            type: 3, // STRING
            name: 'name',
            description: 'Model name, e.g. opus, sonnet, haiku, or a provider model id',
            required: true,
          },
          {
            type: 5, // BOOLEAN
            name: 'force',
            description: 'Bypass the unknown-alias guard (for non-standard model ids)',
            required: false,
          },
        ],
      },
      {
        type: 1,
        name: 'clear',
        description: 'Clear the override and fall back to the default model',
      },
    ],
  },
]

export async function handleModelInteraction(
  interaction: ChatInputCommandInteraction,
  deps: { mutator: MasterMutator; isAllowed: (userId: string) => boolean },
): Promise<void> {
  const sub = interaction.options.getSubcommand()
  const chatId = interaction.channelId

  // Mutations require authorization, mirroring the master mutation policy.
  if (sub !== 'show' && !deps.isAllowed(interaction.user.id)) {
    await interaction.reply({ content: 'Not authorized to change the model.', ephemeral: true })
    return
  }

  // handleModel reloads config itself; only mutator matters here.
  const ctx = { mutator: deps.mutator } as unknown as MasterContext

  let rest: string[]
  if (sub === 'set') {
    const name = interaction.options.getString('name', true)
    rest = [chatId, '--set', name]
    if (interaction.options.getBoolean('force')) rest.push('--force')
  } else if (sub === 'clear') {
    rest = [chatId, '--clear']
  } else {
    rest = [chatId]
  }

  await interaction.deferReply({ ephemeral: true })
  try {
    const text = await handleModel(rest, ctx)
    await interaction.editReply(text)
  } catch (err) {
    await interaction.editReply(`Failed: ${(err as Error).message}`)
  }
}

import {
  type ChatInputCommandInteraction,
  type RESTPostAPIApplicationGuildCommandsJSONBody,
} from 'discord.js'
import { handleProvider, type MasterContext, type MasterMutator } from './master-commands.ts'

/**
 * `/provider` Discord native slash command — sibling of `/model`
 * (see model-command.ts). Operates on the project bound to the channel
 * it's invoked in.
 *
 *   /provider show           — view current provider routing
 *   /provider set alias:<a>   — route to a provider alias from defaults.providers
 *   /provider clear           — back to Claude subscription auth
 *
 * Setting/clearing kills the running subprocess so the next message
 * respawns with the new env. handleProvider() reloads config internally,
 * so the synthesized MasterContext only needs the mutator.
 */
export const providerSlashCommands: RESTPostAPIApplicationGuildCommandsJSONBody[] = [
  {
    name: 'provider',
    description: "View or change the API provider routing for this channel's project",
    options: [
      {
        type: 1, // SUB_COMMAND
        name: 'show',
        description: 'Show the current provider routing for this channel',
      },
      {
        type: 1,
        name: 'set',
        description: 'Route this channel to a provider alias (respawns the subprocess)',
        options: [
          {
            type: 3, // STRING
            name: 'alias',
            description: 'Provider alias from defaults.providers, e.g. minimax',
            required: true,
          },
        ],
      },
      {
        type: 1,
        name: 'clear',
        description: 'Clear provider routing and use Claude subscription auth',
      },
    ],
  },
]

export async function handleProviderInteraction(
  interaction: ChatInputCommandInteraction,
  deps: { mutator: MasterMutator; isAllowed: (userId: string) => boolean },
): Promise<void> {
  const sub = interaction.options.getSubcommand()
  const chatId = interaction.channelId

  // Mutations require authorization, mirroring the master mutation policy.
  if (sub !== 'show' && !deps.isAllowed(interaction.user.id)) {
    await interaction.reply({ content: 'Not authorized to change the provider.', ephemeral: true })
    return
  }

  // handleProvider reloads config itself; only mutator matters here.
  const ctx = { mutator: deps.mutator } as unknown as MasterContext

  let rest: string[]
  if (sub === 'set') {
    const alias = interaction.options.getString('alias', true)
    rest = [chatId, '--set', alias]
  } else if (sub === 'clear') {
    rest = [chatId, '--clear']
  } else {
    rest = [chatId]
  }

  await interaction.deferReply({ ephemeral: true })
  try {
    const text = await handleProvider(rest, ctx)
    await interaction.editReply(text)
  } catch (err) {
    await interaction.editReply(`Failed: ${(err as Error).message}`)
  }
}

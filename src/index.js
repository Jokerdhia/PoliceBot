const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const pl = require('./commands/pl');
const kick = require('./commands/kick');
const bg = require('./commands/bg');
const rc = require('./commands/rc');
const { replyEphemeral } = require('./utils/replies');
const { scanAcceptedMembers, handleAcceptedRole, handleOnboardingButton, handleOnboardingModal } = require('./utils/onboarding');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent]
});

client.commands = new Collection([pl, kick, bg, rc].map((command) => [command.data.name, command]));

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Connecté en tant que ${readyClient.user.tag}`);
  console.log(`✅ Serveur configuré : ${config.guildId}`);
  console.log('✅ Commandes disponibles : /pl, /kick, /bg et /rc');

  const guild = await readyClient.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) {
    console.error('❌ Le bot ne trouve pas le serveur configuré. Vérifie GUILD_ID.');
    return;
  }

  await scanAcceptedMembers(guild);
});

client.on(Events.GuildMemberUpdate, handleAcceptedRole);

client.on(Events.InteractionCreate, async (interaction) => {
  if (await handleOnboardingButton(interaction)) return;
  if (await handleOnboardingModal(interaction)) return;
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Erreur non gérée sur /${interaction.commandName}:`, error);
    await replyEphemeral(interaction, '❌ Une erreur inattendue est survenue. Vérifie la console du bot.', 10000).catch(() => null);
  }
});

client.on(Events.Error, (error) => console.error('Erreur du client Discord :', error));
process.on('unhandledRejection', (error) => console.error('Promesse rejetée non gérée :', error));
process.on('uncaughtException', (error) => console.error('Exception non gérée :', error));

client.login(config.token).catch((error) => {
  console.error('❌ Connexion Discord impossible. Vérifie DISCORD_TOKEN.', error);
  process.exitCode = 1;
});

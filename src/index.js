const http = require('node:http');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const database = require('./database');
const commands = [
  require('./commands/pl'), require('./commands/kick'),
  require('./commands/bg'), require('./commands/rc'), require('./commands/ac'),
  require('./commands/rf'), require('./commands/unrf')
];
const { replyEphemeral } = require('./utils/replies');
const { handleAcceptedRole, handleOnboardingButton, handleOnboardingModal } = require('./utils/onboarding');

const BUILD_VERSION = '1.6.4-refused-cv-channel-env';
let ready = false;
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent] });
client.commands = new Collection(commands.map((command) => [command.data.name, command]));

const server = http.createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (request.url === '/') {
    response.writeHead(200);
    return response.end(JSON.stringify({ service: 'Police Bot Discord', version: BUILD_VERSION, status: ready ? 'online' : 'starting' }));
  }
  if (request.url === '/health') {
    try {
      const databaseLatencyMs = await database.ping();
      response.writeHead(ready ? 200 : 503);
      return response.end(JSON.stringify({ version: BUILD_VERSION, status: ready ? 'healthy' : 'starting', discord: client.isReady(), database: 'connected', databaseLatencyMs }));
    } catch (error) {
      response.writeHead(503);
      return response.end(JSON.stringify({ status: 'unhealthy', database: 'disconnected', error: error.message }));
    }
  }
  response.writeHead(404);
  response.end(JSON.stringify({ error: 'Not found' }));
});

client.once(Events.ClientReady, async (readyClient) => {
  ready = true;
  console.log(`✅ Connecté en tant que ${readyClient.user.tag}`);
  console.log(`✅ BUILD ${BUILD_VERSION}`);
  console.log('✅ /pl ne crée aucun badge et ne modifie aucun pseudo.');
  console.log('✅ Le badge est créé uniquement après envoi valide du formulaire.');
  console.log(`✅ Commandes disponibles : ${commands.map((c) => `/${c.data.name}`).join(', ')}`);
  const guild = await readyClient.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) return console.error('❌ Serveur introuvable. Vérifie GUILD_ID.');
  if (config.roles.acceptedCv === config.roles.academy) {
    console.error('❌ CONFIGURATION INCORRECTE : ACCEPTED_CV_ROLE_ID et ACADEMY_ROLE_ID sont identiques. Corrige les variables Render.');
  }
  const configuredAcceptedRole = await guild.roles.fetch(config.roles.acceptedCv).catch(() => null);
  console.log(`ℹ️ Rôle Accepted CV configuré : ${configuredAcceptedRole ? `${configuredAcceptedRole.name} (${configuredAcceptedRole.id})` : 'introuvable'}`);
  console.log('ℹ️ Scan automatique au démarrage désactivé pour éviter les anciens panneaux et les doublons.');
});
client.on(Events.GuildMemberUpdate, handleAcceptedRole);
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (await handleOnboardingButton(interaction)) return;
    if (await handleOnboardingModal(interaction)) return;
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (command) await command.execute(interaction);
  } catch (error) {
    console.error(`Erreur sur interaction ${interaction.id}:`, error);
    await replyEphemeral(interaction, '❌ Une erreur inattendue est survenue.', 10_000).catch(() => null);
  }
});
client.on(Events.Error, (error) => console.error('Erreur Discord :', error));
process.on('unhandledRejection', (error) => console.error('Promesse rejetée :', error));

async function shutdown(signal) {
  console.log(`🛑 Arrêt demandé (${signal})...`);
  ready = false;
  server.close();
  client.destroy();
  await database.close().catch(() => null);
  process.exit(0);
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

(async () => {
  try {
    await database.initializeDatabase();
    server.listen(config.port, '0.0.0.0', () => console.log(`✅ Serveur HTTP actif sur le port ${config.port}`));
    await client.login(config.token);
  } catch (error) {
    console.error('❌ Démarrage impossible :', error.message);
    await database.close().catch(() => null);
    process.exit(1);
  }
})();

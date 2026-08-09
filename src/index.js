const http = require('node:http');
const dns = require('node:dns');

// Render peut avoir une connectivité IPv6 variable vers le Gateway Discord.
// IPv4 en priorité évite les connexions Gateway qui restent bloquées au démarrage.
dns.setDefaultResultOrder('ipv4first');
const { Client, Collection, Events, GatewayIntentBits, MessageFlags, ActivityType, RESTEvents } = require('discord.js');
const config = require('./config');
const database = require('./database');
const commands = [
  require('./commands/pl'), require('./commands/kick'),
  require('./commands/bg'), require('./commands/rc'), require('./commands/ac'),
  require('./commands/rf'), require('./commands/unrf'), require('./commands/ready')
];
const { replyEphemeral } = require('./utils/replies');
const { handleAcceptedRole, handleOnboardingButton, handleOnboardingModal } = require('./utils/onboarding');
const { checkBlacklist } = require('./utils/blacklist');
const { isCvChannel, blockCvWriting } = require('./utils/cvChannelAccess');
const { diagnoseLogChannel } = require('./utils/logs');

const BUILD_VERSION = '1.8.2-interaction-ack';
const startedAt = Date.now();
let ready = false;
let databaseReady = false;
let discordLoginStartedAt = null;
let discordLoginError = null;
let lastInteractionAt = null;
let lastInteractionName = null;
let discordConnectInFlight = false;
let lastRateLimit = null;
// Les slash commands ont uniquement besoin de Guilds. Les intents privilégiés sont
// optionnels et ne sont activés que si les fonctionnalités correspondantes le demandent.
const gatewayIntents = [GatewayIntentBits.Guilds];
if (config.features.guildMembersIntent) gatewayIntents.push(GatewayIntentBits.GuildMembers);
if (config.features.messageContentIntent) {
  gatewayIntents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
}

const client = new Client({
  intents: gatewayIntents,
  failIfNotExists: false,
  allowedMentions: { parse: [], repliedUser: false }
});
client.commands = new Collection(commands.map((command) => [command.data.name, command]));

const server = http.createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  // Liveness Render : doit rester 200 tant que le processus HTTP fonctionne.
  // Ne dépend PAS de Discord, sinon Render marque le déploiement en échec
  // lorsque le Gateway Discord met plus de temps à se connecter.
  if (request.url === '/' || request.url === '/health') {
    response.writeHead(200);
    return response.end(JSON.stringify({
      service: 'Police Bot Discord',
      version: BUILD_VERSION,
      status: 'alive',
      discord: client.isReady() ? 'connected' : 'connecting',
      database: databaseReady ? 'initialized' : 'starting',
      discordLoginStartedAt,
      discordLoginError,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      lastInteractionAt,
      lastInteractionName,
      lastRateLimit,
      features: config.features
    }));
  }

  // Readiness/diagnostic complet pour vérification manuelle.
  if (request.url === '/ready') {
    let databaseLatencyMs = null;
    let databaseOk = false;
    try {
      databaseLatencyMs = await database.ping();
      databaseOk = true;
    } catch (error) {
      discordLoginError = discordLoginError || null;
    }

    const fullyReady = client.isReady() && databaseOk;
    // Endpoint de diagnostic manuel : toujours HTTP 200 pour être lisible dans le navigateur/Render.
    // Le champ status indique clairement si Discord + Neon sont réellement prêts.
    response.writeHead(200);
    return response.end(JSON.stringify({
      version: BUILD_VERSION,
      status: fullyReady ? 'ready' : 'not_ready',
      discord: client.isReady(),
      database: databaseOk ? 'connected' : 'disconnected',
      databaseLatencyMs,
      discordLoginError,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
    }));
  }

  response.writeHead(404);
  response.end(JSON.stringify({ error: 'Not found' }));
});

client.once(Events.ClientReady, async (readyClient) => {
  ready = true;
  console.log(`✅ Connecté en tant que ${readyClient.user.tag} (${readyClient.user.id})`);
  console.log(`✅ BUILD ${BUILD_VERSION}`);

  if (config.clientId !== readyClient.user.id) {
    console.error(`❌ CLIENT_ID incorrect : Render=${config.clientId}, bot connecté=${readyClient.user.id}. Les slash commands peuvent viser une autre application.`);
  } else {
    console.log('✅ CLIENT_ID correspond bien au bot connecté.');
  }

  readyClient.user.setPresence({
    activities: [{ name: 'HMPD • Recruitment', type: ActivityType.Watching }],
    status: 'online'
  });
  console.log('✅ /pl ne crée aucun badge et ne modifie aucun pseudo.');
  console.log('✅ Le badge est créé uniquement après envoi valide du formulaire.');
  console.log(`✅ Commandes disponibles : ${commands.map((c) => `/${c.data.name}`).join(', ')}`);
  const guild = readyClient.guilds.cache.get(config.guildId) || await readyClient.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) return console.error('❌ Serveur introuvable. Vérifie GUILD_ID.');

  if (config.features.syncCommandsOnStart) {
    try {
      await guild.commands.set(commands.map((command) => command.data.toJSON()));
      console.log(`✅ Slash commands synchronisées sur ${guild.name} (${guild.id}).`);
    } catch (error) {
      console.error('❌ Synchronisation des slash commands impossible :', error?.message || error);
    }
  } else {
    console.log('ℹ️ Synchronisation automatique des slash commands désactivée (économie de requêtes REST).');
  }
  if (config.roles.acceptedCv === config.roles.academy) {
    console.error('❌ CONFIGURATION INCORRECTE : ACCEPTED_CV_ROLE_ID et ACADEMY_ROLE_ID sont identiques. Corrige les variables Render.');
  }
  const configuredAcceptedRole = guild.roles.cache.get(config.roles.acceptedCv) || null;
  console.log(`ℹ️ Rôle Accepted CV configuré : ${configuredAcceptedRole ? `${configuredAcceptedRole.name} (${configuredAcceptedRole.id})` : 'introuvable'}`);
  console.log('ℹ️ Scan automatique au démarrage désactivé pour éviter les anciens panneaux et les doublons.');
  if (config.features.startupDiagnostics) {
    console.log('🔎 Diagnostic optionnel des salons et permissions…');
    await diagnoseLogChannel(guild, config.channels.acceptanceLogs, 'ACCEPTANCE_LOG_CHANNEL_ID');
    await diagnoseLogChannel(guild, config.channels.refusalLogs, 'REFUSED_CV_CHANNEL_ID');
    await diagnoseLogChannel(guild, config.channels.kickLogs, 'KICK_LOG_CHANNEL_ID');
    if (config.channels.cvPolice) {
      const cvChannel = guild.channels.cache.get(config.channels.cvPolice) || null;
      console.log(`ℹ️ Salon CV Police : ${cvChannel ? `${cvChannel.name} (${cvChannel.id})` : 'introuvable'}`);
    }
  } else {
    console.log('ℹ️ Diagnostics REST de démarrage désactivés (mode optimisé).');
  }
  if (config.channels.refusalLogs === config.channels.acceptanceLogs) {
    console.error('❌ REFUSED_CV_CHANNEL_ID pointe vers le salon Accepted Police. Mets un identifiant différent.');
  }
});
console.log(`ℹ️ Intents : Guilds=ON, GuildMembers=${config.features.guildMembersIntent ? 'ON' : 'OFF'}, MessageContent=${config.features.messageContentIntent ? 'ON' : 'OFF'}.`);

if (config.features.messageContentIntent) {
client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot || !isCvChannel(message.channel)) return;

  try {
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;

    const rejected = await database.isCvRejected(member.id);
    const blacklistResult = await checkBlacklist(message.guild, member.id);
    const verificationFailed = !blacklistResult.ok;
    const blacklisted = blacklistResult.ok && blacklistResult.blacklisted;

    if (!rejected && !blacklisted && !verificationFailed) return;

    await message.delete().catch(() => null);

    const blockReason = rejected
      ? 'CV Police refusé'
      : blacklisted
        ? 'Joueur blacklisté Police'
        : 'Vérification blacklist impossible';

    await blockCvWriting(member, blockReason).catch((error) => {
      console.error(`Impossible de bloquer ${member.user.tag} dans le salon CV Police :`, error);
    });

    const explanation = rejected
      ? 'Votre candidature Police a été refusée. Vous ne pouvez pas écrire ici tant que le refus n’est pas annulé.'
      : blacklisted
        ? 'Vous êtes blacklisté du recrutement Police et ne pouvez pas écrire dans ce salon.'
        : 'Votre message a été retiré car la vérification de la blacklist est momentanément indisponible.';

    await member.send(`🚫 **Accès au salon CV Police bloqué**
${explanation}`).catch(() => null);
  } catch (error) {
    console.error('Erreur protection salon CV Police :', error);
  }
});

} else if (config.channels.cvPolice) {
  console.log('ℹ️ Protection temps réel du salon CV désactivée : ENABLE_MESSAGE_CONTENT_INTENT=false.');
}
if (config.features.guildMembersIntent) {
  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    void handleAcceptedRole(oldMember, newMember).catch((error) =>
      console.error('❌ Erreur onboarding automatique GuildMemberUpdate :', error)
    );
  });
}

client.on(Events.InteractionCreate, async (interaction) => {
  const interactionStartedAt = Date.now();
  lastInteractionAt = new Date().toISOString();
  lastInteractionName = interaction.isChatInputCommand() ? `/${interaction.commandName}` : interaction.customId || interaction.type;

  try {
    // ACK des slash commands AVANT tout autre handler. Même si une dépendance (Neon, REST,
    // cache Discord) ralentit, Discord reçoit la réponse dans la fenêtre des ~3 secondes.
    if (interaction.isChatInputCommand()) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const command = client.commands.get(interaction.commandName);
      if (!command) {
        await interaction.editReply({ content: '❌ Cette commande n’est plus disponible. Réessaie dans quelques secondes.' });
        return;
      }

      await command.execute(interaction);

      const elapsed = Date.now() - interactionStartedAt;
      console.log(`✅ ${interaction.commandName} exécutée par ${interaction.user.tag} en ${elapsed} ms`);
      return;
    }

    // Boutons/modals ont leur propre ACK immédiat (showModal/deferReply).
    if (await handleOnboardingButton(interaction)) return;
    if (await handleOnboardingModal(interaction)) return;
  } catch (error) {
    console.error(`❌ Erreur interaction ${lastInteractionName} (${interaction.id}) :`, error);
    await replyEphemeral(
      interaction,
      `❌ Une erreur inattendue est survenue. Référence : \`${interaction.id}\`.`,
      12_000
    ).catch((replyError) => console.error('❌ Impossible de répondre à l’interaction en erreur :', replyError));
  }
});
client.rest.on(RESTEvents.RateLimited, (info) => {
  lastRateLimit = {
    at: new Date().toISOString(),
    route: info.route || 'unknown',
    global: Boolean(info.global),
    retryAfterMs: info.timeToReset ?? null
  };
  console.warn(`⚠️ Rate limit Discord REST : route=${info.route || 'unknown'} global=${Boolean(info.global)} reset≈${info.timeToReset ?? '?'}ms`);
});

client.on(Events.ShardError, (error, shardId) => {
  console.error(`❌ Gateway Discord shard ${shardId} :`, error?.message || error);
});
client.on(Events.ShardDisconnect, (event, shardId) => {
  console.warn(`⚠️ Gateway Discord déconnecté (shard ${shardId}) : code=${event?.code} reason=${event?.reason || 'inconnue'}`);
  if (event?.code === 4014) {
    console.error('❌ Discord refuse un intent privilégié. Désactive l’intent concerné dans Render ou active-le dans Developer Portal > Bot > Privileged Gateway Intents.');
  }
});
client.on(Events.ShardReconnecting, (shardId) => console.warn(`🔄 Reconnexion Gateway Discord (shard ${shardId})...`));
client.on(Events.Invalidated, () => console.error('❌ Session Discord invalidée. Vérifie le token du bot.'));
client.on(Events.Error, (error) => console.error('Erreur Discord :', error));
process.on('unhandledRejection', (error) => console.error('❌ Promesse rejetée :', error));
process.on('uncaughtException', (error) => console.error('❌ Exception non interceptée :', error));
process.on('warning', (warning) => console.warn('⚠️ Node warning :', warning));

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

async function connectDiscord() {
  if (client.isReady() || discordConnectInFlight) return;
  discordConnectInFlight = true;
  discordLoginStartedAt = new Date().toISOString();
  discordLoginError = null;
  console.log('🔐 Connexion au Gateway Discord (sans pré-test REST)...');

  const watchdog = setTimeout(() => {
    if (!client.isReady()) {
      discordLoginError = 'Gateway Discord non READY après 60 secondes';
      console.warn('⚠️ Gateway Discord toujours non READY après 60 secondes.');
      console.warn('ℹ️ Aucun test REST supplémentaire n’est lancé afin de ne pas aggraver un éventuel HTTP 429.');
      console.warn('ℹ️ Si Render utilise une IP partagée limitée par Discord, le code ne peut pas contourner ce blocage réseau.');
    }
  }, 60_000);
  watchdog.unref?.();

  try {
    await client.login(config.token);
    clearTimeout(watchdog);
    discordLoginError = null;
    console.log('✅ Authentification Gateway Discord acceptée.');
  } catch (error) {
    clearTimeout(watchdog);
    const message = error?.message || String(error);
    discordLoginError = message;
    console.error('❌ Connexion Gateway Discord impossible :', message);
    if (/token|invalid|401/i.test(message)) console.error('⛔ Vérifie DISCORD_TOKEN sur Render.');
    // Discord.js gère ses reconnexions internes. Pas de boucle maison agressive.
  } finally {
    discordConnectInFlight = false;
  }
}

(async () => {
  try {
    console.log(`🚀 Démarrage Police Bot ${BUILD_VERSION}...`);
    console.log(`ℹ️ Intents Gateway actifs : ${gatewayIntents.join(', ')}`);
    console.log(`ℹ️ Auto-sync commandes : ${config.features.syncCommandsOnStart ? 'ON' : 'OFF'} | Diagnostics démarrage : ${config.features.startupDiagnostics ? 'ON' : 'OFF'}`);

    // Ouvrir le port immédiatement : Render peut valider le service sans attendre Discord.
    server.listen(config.port, '0.0.0.0', () => console.log(`✅ Serveur HTTP actif sur le port ${config.port}`));

    await database.initializeDatabase();
    databaseReady = true;

    // Ne bloque pas le cycle de déploiement Render sur le Gateway Discord.
    void connectDiscord();
  } catch (error) {
    console.error('❌ Initialisation impossible :', error?.stack || error);
    // Le serveur reste en vie pour exposer les logs/health ; éviter les boucles de restart.
  }
})();

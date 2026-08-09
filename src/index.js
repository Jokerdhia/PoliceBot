const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');

// Render peut avoir une connectivité IPv6 variable vers le Gateway Discord.
// IPv4 en priorité évite les connexions Gateway qui restent bloquées au démarrage.
dns.setDefaultResultOrder('ipv4first');
const { Client, Collection, Events, GatewayIntentBits, MessageFlags, ActivityType } = require('discord.js');
const config = require('./config');
const database = require('./database');
const commands = [
  require('./commands/pl'), require('./commands/kick'),
  require('./commands/bg'), require('./commands/rc'), require('./commands/ac'),
  require('./commands/rf'), require('./commands/unrf')
];
const { replyEphemeral } = require('./utils/replies');
const { handleAcceptedRole, handleOnboardingButton, handleOnboardingModal } = require('./utils/onboarding');
const { checkBlacklist } = require('./utils/blacklist');
const { isCvChannel, blockCvWriting } = require('./utils/cvChannelAccess');
const { diagnoseLogChannel } = require('./utils/logs');

const BUILD_VERSION = '1.7.3-connection-diagnostics-fix';
const startedAt = Date.now();
let ready = false;
let databaseReady = false;
let discordLoginStartedAt = null;
let discordLoginError = null;
let lastInteractionAt = null;
let lastInteractionName = null;
// Intents strictement minimaux : les slash commands ont uniquement besoin de Guilds.
// Aucun intent privilégié n'est nécessaire pour /pl, /ac, /kick, /bg, /rc, /rf et /unrf.
const gatewayIntents = [GatewayIntentBits.Guilds];

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
      lastInteractionName
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
    response.writeHead(fullyReady ? 200 : 503);
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
  const guild = await readyClient.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) return console.error('❌ Serveur introuvable. Vérifie GUILD_ID.');

  try {
    await guild.commands.set(commands.map((command) => command.data.toJSON()));
    console.log(`✅ Slash commands synchronisées automatiquement sur ${guild.name} (${guild.id}).`);
  } catch (error) {
    console.error('❌ Synchronisation automatique des slash commands impossible :', error);
  }
  if (config.roles.acceptedCv === config.roles.academy) {
    console.error('❌ CONFIGURATION INCORRECTE : ACCEPTED_CV_ROLE_ID et ACADEMY_ROLE_ID sont identiques. Corrige les variables Render.');
  }
  const configuredAcceptedRole = await guild.roles.fetch(config.roles.acceptedCv).catch(() => null);
  console.log(`ℹ️ Rôle Accepted CV configuré : ${configuredAcceptedRole ? `${configuredAcceptedRole.name} (${configuredAcceptedRole.id})` : 'introuvable'}`);
  console.log('ℹ️ Scan automatique au démarrage désactivé pour éviter les anciens panneaux et les doublons.');
  console.log('🔎 Vérification des salons et permissions de logs…');
  await diagnoseLogChannel(guild, config.channels.acceptanceLogs, 'ACCEPTANCE_LOG_CHANNEL_ID');
  await diagnoseLogChannel(guild, config.channels.refusalLogs, 'REFUSED_CV_CHANNEL_ID');
  await diagnoseLogChannel(guild, config.channels.kickLogs, 'KICK_LOG_CHANNEL_ID');
  if (config.channels.refusalLogs === config.channels.acceptanceLogs) {
    console.error('❌ REFUSED_CV_CHANNEL_ID pointe vers le salon Accepted Police. Mets un identifiant différent.');
  }
  if (config.channels.cvPolice) {
    const cvChannel = await guild.channels.fetch(config.channels.cvPolice).catch(() => null);
    console.log(`ℹ️ Salon CV Police protégé : ${cvChannel ? `${cvChannel.name} (${cvChannel.id})` : 'introuvable'}`);
  } else {
    console.warn('⚠️ CV_POLICE_CHANNEL_ID absent : la protection du salon CV Police est désactivée.');
  }
});
console.log('ℹ️ Intents privilégiés désactivés : commandes slash actives sans GuildMembers/MessageContent.');

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

client.on(Events.InteractionCreate, async (interaction) => {
  const interactionStartedAt = Date.now();
  lastInteractionAt = new Date().toISOString();
  lastInteractionName = interaction.isChatInputCommand() ? `/${interaction.commandName}` : interaction.customId || interaction.type;

  try {
    if (await handleOnboardingButton(interaction)) return;
    if (await handleOnboardingModal(interaction)) return;
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: '❌ Cette commande n’est plus disponible. Réessaie dans quelques secondes.', flags: MessageFlags.Ephemeral });
      return;
    }

    // ACK immédiat : Discord exige une réponse en ~3 secondes. Toutes les commandes
    // travaillent ensuite avec editReply(), ce qui élimine « L’application ne répond plus ».
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await command.execute(interaction);

    const elapsed = Date.now() - interactionStartedAt;
    console.log(`✅ ${interaction.commandName} exécutée par ${interaction.user.tag} en ${elapsed} ms`);
  } catch (error) {
    console.error(`❌ Erreur interaction ${lastInteractionName} (${interaction.id}) :`, error);
    await replyEphemeral(
      interaction,
      `❌ Une erreur inattendue est survenue. Référence : \`${interaction.id}\`.`,
      12_000
    ).catch((replyError) => console.error('❌ Impossible de répondre à l’interaction en erreur :', replyError));
  }
});
client.on(Events.ShardError, (error, shardId) => {
  console.error(`❌ Gateway Discord shard ${shardId} :`, error?.message || error);
});
client.on(Events.ShardDisconnect, (event, shardId) => {
  console.warn(`⚠️ Gateway Discord déconnecté (shard ${shardId}) : code=${event?.code} reason=${event?.reason || 'inconnue'}`);
  if (event?.code === 4014) {
    console.error('❌ Discord refuse un intent privilégié. Désactive ENABLE_GUILD_MEMBERS_INTENT / ENABLE_MESSAGE_CONTENT_INTENT ou active-les dans Developer Portal > Bot > Privileged Gateway Intents.');
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

function discordHttps(pathname, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: 'https:',
      hostname: 'discord.com',
      port: 443,
      path: pathname,
      method: 'GET',
      family: 4,
      headers: {
        Authorization: `Bot ${config.token}`,
        'User-Agent': 'PoliceBot/1.7.3 (+Render)'
      },
      timeout: timeoutMs
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { if (body.length < 16384) body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('timeout', () => request.destroy(new Error(`timeout HTTPS Discord après ${timeoutMs} ms`)));
    request.on('error', reject);
    request.end();
  });
}

async function diagnoseDiscordAccess() {
  console.log('🧪 Test Discord REST (IPv4) avant Gateway...');
  try {
    const me = await discordHttps('/api/v10/users/@me');
    if (me.status === 401) {
      discordLoginError = 'DISCORD_TOKEN refusé par Discord (HTTP 401)';
      console.error('❌ DISCORD_TOKEN invalide/refusé (HTTP 401). Regénère le token dans Discord Developer Portal > Bot, puis remplace DISCORD_TOKEN sur Render.');
      return false;
    }
    if (me.status !== 200) {
      discordLoginError = `Discord REST /users/@me HTTP ${me.status}`;
      console.error(`❌ Discord REST répond HTTP ${me.status}. Le Gateway ne sera pas lancé tant que ce test échoue.`);
      return false;
    }
    let user = null;
    try { user = JSON.parse(me.body); } catch {}
    console.log(`✅ Token Discord accepté par l'API REST${user?.username ? ` : ${user.username} (${user.id})` : ''}.`);
    if (user?.id && user.id !== config.clientId) {
      console.error(`❌ CLIENT_ID ne correspond pas au token : CLIENT_ID=${config.clientId}, token=${user.id}. Corrige CLIENT_ID sur Render.`);
      discordLoginError = 'CLIENT_ID ne correspond pas au bot du DISCORD_TOKEN';
      return false;
    }

    const gateway = await discordHttps('/api/v10/gateway/bot');
    if (gateway.status !== 200) {
      discordLoginError = `Discord REST /gateway/bot HTTP ${gateway.status}`;
      console.error(`❌ Impossible d'obtenir le Gateway Discord : HTTP ${gateway.status}.`);
      return false;
    }
    let info = null;
    try { info = JSON.parse(gateway.body); } catch {}
    console.log(`✅ Gateway Discord accessible${info?.url ? ` : ${info.url}` : ''}.`);
    if (info?.session_start_limit) {
      const lim = info.session_start_limit;
      console.log(`ℹ️ Sessions Gateway : ${lim.remaining}/${lim.total} restantes, reset dans ${Math.ceil((lim.reset_after || 0)/1000)}s.`);
      if (lim.remaining === 0) {
        console.error('❌ Limite de démarrage de session Discord épuisée. Attends le reset indiqué avant de redéployer.');
        discordLoginError = 'Limite session_start_limit Discord épuisée';
        return false;
      }
    }
    return true;
  } catch (error) {
    discordLoginError = `Discord HTTPS inaccessible: ${error?.message || error}`;
    console.error('❌ Render ne parvient pas à joindre l’API Discord en HTTPS/IPv4 :', error?.message || error);
    return false;
  }
}

async function connectDiscord() {
  discordLoginStartedAt = new Date().toISOString();
  discordLoginError = null;

  const accessOk = await diagnoseDiscordAccess();
  if (!accessOk) {
    console.error('⛔ Connexion Gateway annulée : corrige le diagnostic ci-dessus puis redéploie.');
    return;
  }

  console.log('🔐 Connexion au Gateway Discord...');
  const warningTimer = setTimeout(() => {
    if (!client.isReady()) {
      console.warn('⚠️ Gateway Discord toujours non READY après 30 secondes alors que REST + token sont valides.');
      console.warn('⚠️ Le problème est maintenant isolé au WebSocket Gateway (réseau/proxy/Discord), pas à /pl ni à Neon.');
    }
  }, 30_000);
  warningTimer.unref?.();

  try {
    await client.login(config.token);
    clearTimeout(warningTimer);
    console.log('✅ Authentification Gateway Discord acceptée.');
  } catch (error) {
    clearTimeout(warningTimer);
    discordLoginError = error?.message || String(error);
    console.error('❌ Connexion Gateway Discord impossible :', discordLoginError);
  }
}

(async () => {
  try {
    console.log(`🚀 Démarrage Police Bot ${BUILD_VERSION}...`);
    console.log(`ℹ️ Intents Gateway : ${gatewayIntents.join(', ')}`);

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

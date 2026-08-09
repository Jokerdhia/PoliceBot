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

const BUILD_VERSION = '1.7.5-gateway-direct';
const startedAt = Date.now();
let ready = false;
let databaseReady = false;
let discordLoginStartedAt = null;
let discordLoginError = null;
let lastInteractionAt = null;
let lastInteractionName = null;
let discordRetryTimer = null;
let discordConnectInFlight = false;
let discordRetryCount = 0;
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
      lastInteractionName,
      discordRetryCount,
      discordRetryScheduled: Boolean(discordRetryTimer)
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
        'User-Agent': 'PoliceBot/1.7.5 (+Render)'
      },
      timeout: timeoutMs
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { if (body.length < 16384) body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
    });
    request.on('timeout', () => request.destroy(new Error(`timeout HTTPS Discord après ${timeoutMs} ms`)));
    request.on('error', reject);
    request.end();
  });
}

function getDiscordRetryAfter(result) {
  let seconds = 0;
  try {
    const parsed = JSON.parse(result?.body || '{}');
    const value = Number(parsed?.retry_after);
    if (Number.isFinite(value) && value > 0) seconds = value;
  } catch {}

  if (!seconds) {
    const header = Number(result?.headers?.['retry-after']);
    if (Number.isFinite(header) && header > 0) seconds = header;
  }
  if (!seconds) {
    const resetAfter = Number(result?.headers?.['x-ratelimit-reset-after']);
    if (Number.isFinite(resetAfter) && resetAfter > 0) seconds = resetAfter;
  }
  return Math.max(5, Math.ceil(seconds || 60));
}

function scheduleDiscordRetry(delaySeconds, reason) {
  if (client.isReady() || discordRetryTimer) return;

  const safeDelay = Math.min(Math.max(Number(delaySeconds) || 60, 10), 15 * 60);
  discordRetryCount += 1;
  discordLoginError = `${reason} — nouvelle tentative dans ${safeDelay}s`;
  console.warn(`⏳ ${reason}. Nouvelle tentative Discord dans ${safeDelay}s (tentative #${discordRetryCount}).`);

  discordRetryTimer = setTimeout(() => {
    discordRetryTimer = null;
    void connectDiscord();
  }, safeDelay * 1000);
  discordRetryTimer.unref?.();
}

async function diagnoseDiscordAccessNonBlocking() {
  // IMPORTANT: ce test est purement informatif.
  // Un HTTP 429 sur /users/@me ne doit JAMAIS empêcher le Gateway de démarrer.
  try {
    const me = await discordHttps('/api/v10/users/@me', 8000);

    if (me.status === 200) {
      let user = null;
      try { user = JSON.parse(me.body); } catch {}
      console.log(`✅ Discord REST accessible${user?.username ? ` : ${user.username} (${user.id})` : ''}.`);
      if (user?.id && user.id !== config.clientId) {
        console.error(`❌ CLIENT_ID ne correspond pas au token : CLIENT_ID=${config.clientId}, token=${user.id}.`);
      }
      return;
    }

    if (me.status === 401) {
      console.error('❌ Discord REST HTTP 401 : DISCORD_TOKEN est invalide ou a été régénéré.');
      return;
    }

    if (me.status === 429) {
      const retryAfter = getDiscordRetryAfter(me);
      console.warn(`⚠️ Discord REST HTTP 429 (Retry-After ≈ ${retryAfter}s). Le test REST est ignoré : tentative Gateway directe.`);
      return;
    }

    console.warn(`⚠️ Discord REST HTTP ${me.status}. Diagnostic ignoré : tentative Gateway directe.`);
  } catch (error) {
    console.warn('⚠️ Diagnostic REST Discord indisponible, sans blocage :', error?.message || error);
  }
}

async function connectDiscord() {
  if (client.isReady() || discordConnectInFlight) return;
  discordConnectInFlight = true;
  discordLoginStartedAt = new Date().toISOString();
  discordLoginError = null;

  // Le diagnostic REST part en parallèle et ne bloque jamais client.login().
  void diagnoseDiscordAccessNonBlocking();

  console.log('🔐 Connexion DIRECTE au Gateway Discord (aucun pré-test bloquant)...');

  let watchdog = null;
  try {
    watchdog = setTimeout(() => {
      if (!client.isReady()) {
        discordLoginError = 'Gateway Discord non READY après 60 secondes';
        console.warn('⚠️ Gateway Discord toujours non READY après 60 secondes.');
        console.warn('ℹ️ Si le REST affiche aussi HTTP 429, la limitation vient de Discord/IP Render et non de /pl.');
        console.warn('ℹ️ Le service reste actif. Évite les redéploiements répétés pendant le Retry-After.');
      }
    }, 60_000);
    watchdog.unref?.();

    await client.login(config.token);
    if (watchdog) clearTimeout(watchdog);
    discordRetryCount = 0;
    discordLoginError = null;
    console.log('✅ Authentification Gateway Discord acceptée.');
  } catch (error) {
    if (watchdog) clearTimeout(watchdog);
    const message = error?.message || String(error);
    discordLoginError = message;
    console.error('❌ Connexion Gateway Discord impossible :', message);

    // Pas de boucle rapide : Discord peut appliquer un rate-limit IP long.
    if (/401|token|invalid/i.test(message)) {
      console.error('⛔ Vérifie DISCORD_TOKEN sur Render.');
    } else if (/429|rate.?limit/i.test(message)) {
      scheduleDiscordRetry(15 * 60, `Gateway limité par Discord (${message})`);
    } else {
      scheduleDiscordRetry(5 * 60, `Gateway Discord indisponible (${message})`);
    }
  } finally {
    discordConnectInFlight = false;
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

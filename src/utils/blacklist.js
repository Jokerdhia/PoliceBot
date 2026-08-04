const { PermissionFlagsBits, ChannelType } = require('discord.js');
const config = require('../config');

function normalizeText(value) {
  return String(value || '').normalize('NFKC');
}

function messageContainsUser(message, userId) {
  const id = String(userId);
  if (message.mentions?.users?.has(id)) return true;

  const searchableParts = [message.content || ''];

  for (const embed of message.embeds || []) {
    try {
      searchableParts.push(JSON.stringify(embed.toJSON()));
    } catch {
      searchableParts.push(String(embed));
    }
  }

  for (const row of message.components || []) {
    try {
      searchableParts.push(JSON.stringify(row.toJSON()));
    } catch {
      searchableParts.push(String(row));
    }
  }

  for (const attachment of message.attachments?.values?.() || []) {
    searchableParts.push(attachment.name || '', attachment.description || '', attachment.url || '');
  }

  const text = normalizeText(searchableParts.join('\n'));
  return text.includes(`<@${id}>`) || text.includes(`<@!${id}>`) || text.includes(id);
}

function memberHasBlacklistRole(member) {
  return member.roles.cache.some((role) => {
    const name = normalizeText(role.name)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    return (
      name.includes('blacklist') ||
      name.includes('black listed') ||
      name.includes('liste noire') ||
      name.includes('banni recrutement') ||
      name.includes('interdit recrutement')
    );
  });
}

async function scanMessageChannel(channel, userId) {
  if (!channel?.isTextBased?.() || !channel.messages) {
    return { found: false, scanned: 0 };
  }

  const guildMember = channel.guild?.members?.me;
  const permissions = guildMember ? channel.permissionsFor(guildMember) : null;
  const canRead =
    permissions?.has(PermissionFlagsBits.ViewChannel) &&
    permissions?.has(PermissionFlagsBits.ReadMessageHistory);

  if (!canRead) {
    throw new Error(`Permissions insuffisantes dans #${channel.name || channel.id}.`);
  }

  let scanned = 0;

  // Les entrées blacklist sont souvent épinglées : on les vérifie d'abord.
  const pinned = await channel.messages.fetchPinned().catch(() => null);
  if (pinned) {
    for (const message of pinned.values()) {
      scanned += 1;
      if (messageContainsUser(message, userId)) {
        return { found: true, scanned, messageUrl: message.url };
      }
    }
  }

  let before;
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;

    for (const message of batch.values()) {
      scanned += 1;
      if (messageContainsUser(message, userId)) {
        return { found: true, scanned, messageUrl: message.url };
      }
    }

    before = batch.last()?.id;
    if (batch.size < 100 || !before) break;
  }

  return { found: false, scanned };
}

async function getChildThreads(channel) {
  if (!channel?.threads) return [];

  const threads = new Map();
  const addThreads = (collection) => {
    for (const thread of collection?.threads?.values?.() || collection?.values?.() || []) {
      threads.set(thread.id, thread);
    }
  };

  const active = await channel.threads.fetchActive().catch(() => null);
  addThreads(active);

  // Vérifie aussi les discussions archivées publiques et privées accessibles au bot.
  const publicArchived = await channel.threads.fetchArchived({ type: 'public', fetchAll: true }).catch(() => null);
  addThreads(publicArchived);

  const privateArchived = await channel.threads.fetchArchived({ type: 'private', fetchAll: true }).catch(() => null);
  addThreads(privateArchived);

  return [...threads.values()];
}

async function checkBlacklist(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);

  // Sécurité supplémentaire : certains serveurs utilisent un rôle Blacklist.
  if (member && memberHasBlacklistRole(member)) {
    return { ok: true, blacklisted: true, source: 'role', scanned: 0 };
  }

  const channel = await guild.channels.fetch(config.channels.blacklist).catch(() => null);
  if (!channel) {
    return {
      ok: false,
      blacklisted: false,
      reason: 'Le salon Blacklist est introuvable.'
    };
  }

  try {
    let totalScanned = 0;

    // Salon texte classique ou fil configuré directement.
    const direct = await scanMessageChannel(channel, userId);
    totalScanned += direct.scanned;
    if (direct.found) {
      return {
        ok: true,
        blacklisted: true,
        source: 'message',
        messageUrl: direct.messageUrl,
        scanned: totalScanned
      };
    }

    // Forum / salon avec fils : recherche dans tous les fils actifs et archivés.
    if (
      channel.type === ChannelType.GuildForum ||
      channel.type === ChannelType.GuildMedia ||
      channel.threads
    ) {
      const threads = await getChildThreads(channel);
      for (const thread of threads) {
        const result = await scanMessageChannel(thread, userId);
        totalScanned += result.scanned;
        if (result.found) {
          return {
            ok: true,
            blacklisted: true,
            source: 'thread',
            messageUrl: result.messageUrl,
            scanned: totalScanned
          };
        }
      }
    }

    return { ok: true, blacklisted: false, scanned: totalScanned };
  } catch (error) {
    return {
      ok: false,
      blacklisted: false,
      reason: error.message
    };
  }
}

module.exports = { checkBlacklist };

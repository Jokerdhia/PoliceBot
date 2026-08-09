const { PermissionFlagsBits, ChannelType } = require('discord.js');
const config = require('../config');

const cache = new Map();

function normalizeText(value) {
  return String(value || '').normalize('NFKC');
}

function messageContainsUser(message, userId) {
  const id = String(userId);
  if (message.mentions?.users?.has(id)) return true;
  const searchableParts = [message.content || ''];
  for (const embed of message.embeds || []) {
    try { searchableParts.push(JSON.stringify(embed.toJSON())); } catch { searchableParts.push(String(embed)); }
  }
  for (const row of message.components || []) {
    try { searchableParts.push(JSON.stringify(row.toJSON())); } catch { searchableParts.push(String(row)); }
  }
  for (const attachment of message.attachments?.values?.() || []) {
    searchableParts.push(attachment.name || '', attachment.description || '', attachment.url || '');
  }
  const text = normalizeText(searchableParts.join('\n'));
  return text.includes(`<@${id}>`) || text.includes(`<@!${id}>`) || text.includes(id);
}

function memberHasBlacklistRole(member) {
  return member.roles.cache.some((role) => {
    const name = normalizeText(role.name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return name.includes('blacklist') || name.includes('black listed') || name.includes('liste noire') ||
      name.includes('banni recrutement') || name.includes('interdit recrutement');
  });
}

function getCached(userId) {
  const item = cache.get(String(userId));
  if (!item || item.expiresAt <= Date.now()) {
    if (item) cache.delete(String(userId));
    return null;
  }
  return item.value;
}

function setCached(userId, value) {
  const ttl = value.blacklisted ? config.limits.blacklistPositiveCacheMs : config.limits.blacklistNegativeCacheMs;
  if (ttl <= 0) return;
  cache.set(String(userId), { value, expiresAt: Date.now() + ttl });
  if (cache.size > 1000) {
    const now = Date.now();
    for (const [key, item] of cache) if (item.expiresAt <= now) cache.delete(key);
  }
}

async function scanMessageChannel(channel, userId, remaining) {
  if (!channel?.isTextBased?.() || !channel.messages || remaining <= 0) return { found: false, scanned: 0 };
  const guildMember = channel.guild?.members?.me;
  const permissions = guildMember ? channel.permissionsFor(guildMember) : null;
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.ReadMessageHistory)) {
    throw new Error(`Permissions insuffisantes dans #${channel.name || channel.id}.`);
  }

  let scanned = 0;
  const pinned = await channel.messages.fetchPinned().catch(() => null);
  if (pinned) {
    for (const message of pinned.values()) {
      if (scanned >= remaining) break;
      scanned += 1;
      if (messageContainsUser(message, userId)) return { found: true, scanned, messageUrl: message.url };
    }
  }

  let before;
  while (scanned < remaining) {
    const limit = Math.min(100, remaining - scanned);
    const batch = await channel.messages.fetch({ limit, before });
    if (batch.size === 0) break;
    for (const message of batch.values()) {
      scanned += 1;
      if (messageContainsUser(message, userId)) return { found: true, scanned, messageUrl: message.url };
      if (scanned >= remaining) break;
    }
    before = batch.last()?.id;
    if (batch.size < limit || !before) break;
  }
  return { found: false, scanned };
}

async function getChildThreads(channel) {
  if (!channel?.threads) return [];
  const threads = new Map();
  const add = (collection) => {
    for (const thread of collection?.threads?.values?.() || collection?.values?.() || []) threads.set(thread.id, thread);
  };
  add(await channel.threads.fetchActive().catch(() => null));
  add(await channel.threads.fetchArchived({ type: 'public', fetchAll: true }).catch(() => null));
  add(await channel.threads.fetchArchived({ type: 'private', fetchAll: true }).catch(() => null));
  return [...threads.values()];
}

async function checkBlacklist(guild, userId, knownMember = null) {
  const cached = getCached(userId);
  if (cached) return { ...cached, cached: true };

  const member = knownMember || guild.members.cache.get(String(userId)) || await guild.members.fetch(userId).catch(() => null);
  if (member && memberHasBlacklistRole(member)) {
    const result = { ok: true, blacklisted: true, source: 'role', scanned: 0 };
    setCached(userId, result);
    return result;
  }

  const channel = await guild.channels.fetch(config.channels.blacklist).catch(() => null);
  if (!channel) return { ok: false, blacklisted: false, reason: 'Le salon Blacklist est introuvable.' };

  try {
    let totalScanned = 0;
    const max = config.limits.blacklistMaxMessages;
    const direct = await scanMessageChannel(channel, userId, max - totalScanned);
    totalScanned += direct.scanned;
    if (direct.found) {
      const result = { ok: true, blacklisted: true, source: 'message', messageUrl: direct.messageUrl, scanned: totalScanned };
      setCached(userId, result);
      return result;
    }

    if ((channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia || channel.threads) && totalScanned < max) {
      const threads = await getChildThreads(channel);
      for (const thread of threads) {
        if (totalScanned >= max) break;
        const result = await scanMessageChannel(thread, userId, max - totalScanned);
        totalScanned += result.scanned;
        if (result.found) {
          const value = { ok: true, blacklisted: true, source: 'thread', messageUrl: result.messageUrl, scanned: totalScanned };
          setCached(userId, value);
          return value;
        }
      }
    }

    const result = { ok: true, blacklisted: false, scanned: totalScanned, scanLimitReached: totalScanned >= max };
    setCached(userId, result);
    return result;
  } catch (error) {
    return { ok: false, blacklisted: false, reason: error.message };
  }
}

function invalidateBlacklistCache(userId) {
  if (userId) cache.delete(String(userId)); else cache.clear();
}

module.exports = { checkBlacklist, invalidateBlacklistCache };

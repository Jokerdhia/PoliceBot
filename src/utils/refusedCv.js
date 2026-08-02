const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const database = require('../database');

function messageContainsUser(message, userId) {
  if (message.mentions?.users?.has(userId)) return true;
  const directMention = `<@${userId}>`;
  const nicknameMention = `<@!${userId}>`;
  if (message.content?.includes(directMention) || message.content?.includes(nicknameMention)) return true;

  const embedText = message.embeds.map((embed) => JSON.stringify(embed.toJSON())).join('\n');
  return embedText.includes(directMention) || embedText.includes(nicknameMention) || embedText.includes(userId);
}

async function checkRefusedCv(guild, userId) {
  const dbEntry = await database.getRefusedCv(userId);
  if (dbEntry) {
    return { refused: true, source: 'database', reason: dbEntry.reason };
  }

  const channel = await guild.channels.fetch(config.channels.refusedCv).catch(() => null);
  if (!channel || !channel.isTextBased() || !channel.messages) {
    return { refused: false, source: 'none' };
  }

  const permissions = channel.permissionsFor(guild.members.me);
  const canRead =
    permissions?.has(PermissionFlagsBits.ViewChannel) &&
    permissions?.has(PermissionFlagsBits.ReadMessageHistory);
  if (!canRead) return { refused: false, source: 'unreadable' };

  let before;
  let scanned = 0;
  const maxMessages = 5000;
  while (scanned < maxMessages) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;

    for (const message of batch.values()) {
      scanned += 1;
      if (messageContainsUser(message, userId)) {
        return { refused: true, source: 'channel', reason: null, messageUrl: message.url };
      }
    }

    before = batch.last()?.id;
    if (batch.size < 100 || !before) break;
  }

  return { refused: false, source: 'none' };
}

module.exports = { checkRefusedCv };

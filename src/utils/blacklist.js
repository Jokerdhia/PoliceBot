const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');

function messageContainsUser(message, userId) {
  if (message.mentions?.users?.has(userId)) return true;

  const directMention = `<@${userId}>`;
  const nicknameMention = `<@!${userId}>`;

  if (message.content?.includes(directMention) || message.content?.includes(nicknameMention)) {
    return true;
  }

  const embedText = message.embeds
    .map((embed) => JSON.stringify(embed.toJSON()))
    .join('\n');

  return (
    embedText.includes(directMention) ||
    embedText.includes(nicknameMention) ||
    embedText.includes(userId)
  );
}

async function checkBlacklist(guild, userId) {
  const channel = await guild.channels.fetch(config.channels.blacklist).catch(() => null);

  if (!channel || !channel.isTextBased() || !channel.messages) {
    return {
      ok: false,
      blacklisted: false,
      reason: 'Le salon Blacklist est introuvable ou incompatible.'
    };
  }

  const permissions = channel.permissionsFor(guild.members.me);
  const canRead =
    permissions?.has(PermissionFlagsBits.ViewChannel) &&
    permissions?.has(PermissionFlagsBits.ReadMessageHistory);

  if (!canRead) {
    return {
      ok: false,
      blacklisted: false,
      reason: 'Le bot doit avoir Voir le salon et Voir les anciens messages dans le salon Blacklist.'
    };
  }

  let before;
  let scanned = 0;
  const maxMessages = 5000;

  while (scanned < maxMessages) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch((error) => {
      throw new Error(`Lecture du salon Blacklist impossible : ${error.message}`);
    });

    if (batch.size === 0) break;

    for (const message of batch.values()) {
      scanned += 1;

      if (messageContainsUser(message, userId)) {
        return {
          ok: true,
          blacklisted: true,
          messageUrl: message.url,
          scanned
        };
      }
    }

    before = batch.last()?.id;
    if (batch.size < 100 || !before) break;
  }

  return { ok: true, blacklisted: false, scanned };
}

module.exports = { checkBlacklist };

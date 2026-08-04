const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');

function isCvChannel(channel) {
  if (!channel || !config.channels.cvPolice) return false;
  return channel.id === config.channels.cvPolice || channel.parentId === config.channels.cvPolice;
}

async function fetchCvChannel(guild) {
  if (!config.channels.cvPolice) {
    throw new Error('CV_POLICE_CHANNEL_ID n’est pas configuré.');
  }

  const channel = await guild.channels.fetch(config.channels.cvPolice).catch(() => null);
  if (!channel) throw new Error('Le salon CV Police configuré est introuvable.');
  if (!channel.permissionOverwrites) {
    throw new Error('Le salon CV Police ne permet pas la gestion des permissions.');
  }
  return channel;
}

async function assertCanManageChannel(channel) {
  const me = channel.guild.members.me || await channel.guild.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions?.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error(`Le bot doit avoir la permission « Gérer les salons » dans #${channel.name || channel.id}.`);
  }
}

async function blockCvWriting(member, reason = 'Candidature Police bloquée') {
  const channel = await fetchCvChannel(member.guild);
  await assertCanManageChannel(channel);

  await channel.permissionOverwrites.edit(
    member,
    {
      SendMessages: false,
      SendMessagesInThreads: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
      AddReactions: false
    },
    { reason }
  );

  return channel;
}

async function restoreCvWriting(member, reason = 'Blocage candidature Police retiré') {
  const channel = await fetchCvChannel(member.guild);
  await assertCanManageChannel(channel);

  // null restaure les permissions héritées sans accorder un accès supplémentaire.
  await channel.permissionOverwrites.edit(
    member,
    {
      SendMessages: null,
      SendMessagesInThreads: null,
      CreatePublicThreads: null,
      CreatePrivateThreads: null,
      AddReactions: null
    },
    { reason }
  );

  return channel;
}

module.exports = {
  isCvChannel,
  blockCvWriting,
  restoreCvWriting
};

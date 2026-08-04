const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config');

async function resolveLogChannel(guild, channelId, label = 'logs') {
  if (!channelId) {
    return { ok: false, reason: `Aucun identifiant configuré pour le salon ${label}.` };
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    return { ok: false, reason: `Salon ${label} introuvable (${channelId}).` };
  }
  if (!channel.isTextBased() || typeof channel.send !== 'function') {
    return { ok: false, reason: `Le salon ${label} (${channelId}) n’accepte pas les messages.` };
  }

  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  const missing = [];
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) missing.push('Voir le salon');
  if (!permissions?.has(PermissionFlagsBits.SendMessages)) missing.push('Envoyer des messages');
  if (!permissions?.has(PermissionFlagsBits.EmbedLinks)) missing.push('Intégrer des liens');

  if (missing.length) {
    return {
      ok: false,
      reason: `Permissions manquantes dans #${channel.name} (${channelId}) : ${missing.join(', ')}.`
    };
  }

  return { ok: true, channel };
}

async function sendLog(guild, channelId, embed, label = 'logs') {
  try {
    const result = await resolveLogChannel(guild, channelId, label);
    if (!result.ok) {
      console.error(`❌ Log non envoyé : ${result.reason}`);
      return { ok: false, reason: result.reason };
    }

    const message = await result.channel.send({ embeds: [embed] });
    console.log(`✅ Log ${label} envoyé dans #${result.channel.name} (${result.channel.id}) • message ${message.id}`);
    return { ok: true, channelId: result.channel.id, messageId: message.id };
  } catch (error) {
    const reason = `Impossible d’envoyer le log ${label} dans ${channelId}: ${error.message}`;
    console.error(`❌ ${reason}`, error);
    return { ok: false, reason };
  }
}

async function diagnoseLogChannel(guild, channelId, label) {
  const result = await resolveLogChannel(guild, channelId, label);
  if (!result.ok) {
    console.error(`❌ ${label} : ${result.reason}`);
    return false;
  }
  console.log(`✅ ${label} : #${result.channel.name} (${result.channel.id}) — permissions OK`);
  return true;
}

function discordDate(date, style = 'F') {
  if (!date) return 'Inconnue';
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function accountAge(date) {
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  return `${days} jour${days > 1 ? 's' : ''}`;
}

function safeCode(value) {
  return `\`${String(value).replaceAll('`', '')}\``;
}

function recruitmentEmbed({ member, badge, rpName, recruiter }) {
  return new EmbedBuilder()
    .setColor(0x15803d)
    .setAuthor({
      name: `${member.guild.name.toUpperCase()} • PERSONNEL DIVISION`,
      iconURL: member.guild.iconURL({ size: 128 }) || undefined
    })
    .setTitle('✅ RECRUTEMENT OFFICIEL')
    .setDescription('Une nouvelle admission a été enregistrée dans le registre du département de police.')
    .addFields(
      {
        name: '👮 RESPONSABLE DU RECRUTEMENT',
        value: `${recruiter}\n**Identifiant Discord :** ${safeCode(recruiter.id)}`,
        inline: true
      },
      {
        name: '🛡️ NOUVEL OFFICIER',
        value: `${member}\n**Identifiant Discord :** ${safeCode(member.id)}`,
        inline: true
      },
      {
        name: '🪪 DOSSIER PROFESSIONNEL',
        value: [
          `**Nom RP :** ${safeCode(rpName)}`,
          `**Numéro de badge :** ${safeCode(badge)}`,
          `**Pseudo attribué :** ${safeCode(`[${badge}] ${rpName}`)}`,
          `**Grade initial :** <@&${config.roles.academy}>`
        ].join('\n'),
        inline: false
      },
      {
        name: '📅 INFORMATIONS DU COMPTE',
        value: [
          `**Compte créé :** ${discordDate(member.user.createdAt)}`,
          `**Ancienneté du compte :** ${accountAge(member.user.createdAt)}`,
          `**Arrivée sur le serveur :** ${discordDate(member.joinedAt)}`
        ].join('\n'),
        inline: false
      },
      {
        name: '🔄 MODIFICATIONS DES RÔLES',
        value: `**Ajoutés :** <@&${config.roles.police}> • <@&${config.roles.academy}>\n**Retiré :** <@&${config.roles.citizen}>`,
        inline: false
      }
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `${member.guild.name} • Registre sécurisé du personnel` })
    .setTimestamp();
}

function kickEmbed({ member, badge, rpName, recruiter, reason }) {
  return new EmbedBuilder()
    .setColor(0xb91c1c)
    .setAuthor({
      name: `${member.guild.name.toUpperCase()} • PERSONNEL DIVISION`,
      iconURL: member.guild.iconURL({ size: 128 }) || undefined
    })
    .setTitle('❌ RETRAIT DES EFFECTIFS')
    .setDescription('Une fin de service a été enregistrée dans le registre officiel du département de police.')
    .addFields(
      {
        name: '👮 RESPONSABLE DE LA DÉCISION',
        value: `${recruiter}\n**Identifiant Discord :** ${safeCode(recruiter.id)}`,
        inline: true
      },
      {
        name: '🛡️ MEMBRE CONCERNÉ',
        value: `${member}\n**Identifiant Discord :** ${safeCode(member.id)}`,
        inline: true
      },
      {
        name: '🪪 ANCIEN DOSSIER PROFESSIONNEL',
        value: `**Nom RP :** ${safeCode(rpName || member.displayName)}\n**Ancien badge :** ${badge ? safeCode(badge) : 'Non enregistré'}`,
        inline: false
      },
      {
        name: '📋 MOTIF DU RETRAIT',
        value: reason,
        inline: false
      },
      {
        name: '🔄 MODIFICATIONS DES RÔLES',
        value: `**Rôles gérables retirés**\n**Ajouté :** <@&${config.roles.citizen}>\n**Badge :** libéré dans la base de données`,
        inline: false
      }
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `${member.guild.name} • Registre sécurisé du personnel` })
    .setTimestamp();
}

function badgeUpdateEmbed({ member, rpName, oldBadge, newBadge, executor }) {
  return new EmbedBuilder()
    .setColor(0x1d4ed8)
    .setAuthor({
      name: `${member.guild.name.toUpperCase()} • PERSONNEL DIVISION`,
      iconURL: member.guild.iconURL({ size: 128 }) || undefined
    })
    .setTitle('🎖️ MODIFICATION DE BADGE')
    .setDescription('Une modification de numéro de badge a été enregistrée dans le registre officiel.')
    .addFields(
      {
        name: '👮 RESPONSABLE DE LA MODIFICATION',
        value: `${executor}\n**Identifiant Discord :** ${safeCode(executor.id)}`,
        inline: true
      },
      {
        name: '🛡️ OFFICIER CONCERNÉ',
        value: `${member}\n**Identifiant Discord :** ${safeCode(member.id)}`,
        inline: true
      },
      {
        name: '🪪 MISE À JOUR DU DOSSIER',
        value: [
          `**Nom RP :** ${safeCode(rpName)}`,
          `**Ancien badge :** ${safeCode(oldBadge)}`,
          `**Nouveau badge :** ${safeCode(newBadge)}`,
          `**Nouveau pseudo :** ${safeCode(`[${newBadge}] ${rpName}`)}`
        ].join('\n'),
        inline: false
      }
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `${member.guild.name} • Registre sécurisé du personnel` })
    .setTimestamp();
}

module.exports = {
  sendLog,
  diagnoseLogChannel,
  recruitmentEmbed,
  kickEmbed,
  badgeUpdateEmbed
};

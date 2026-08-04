const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const config = require('../config');
const database = require('../database');
const { canUsePoliceCommands } = require('../utils/permissions');
const { replyEphemeral } = require('../utils/replies');
const { sendLog } = require('../utils/logs');
const { checkBlacklist } = require('../utils/blacklist');
const { restoreCvWriting, blockCvWriting } = require('../utils/cvChannelAccess');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unrf')
    .setDescription('Annuler un refus de CV Police avec une justification obligatoire.')
    .addUserOption((option) =>
      option.setName('membre').setDescription('Le candidat à débloquer').setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('raison')
        .setDescription('Raison de l’annulation du refus')
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(1000)
    ),

  async execute(interaction) {
    if (!canUsePoliceCommands(interaction.member)) {
      return replyEphemeral(interaction, '❌ Accès refusé : le rôle **Recruitment** est obligatoire.', 7000);
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('membre', true);
    const reason = interaction.options.getString('raison', true).trim();

    if (user.bot) {
      return replyEphemeral(interaction, '❌ Un bot ne peut pas avoir un dossier de candidature Police.', 7000);
    }
    if (reason.length < 3) {
      return replyEphemeral(interaction, '❌ La raison doit contenir au moins 3 caractères.', 7000);
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return replyEphemeral(interaction, '❌ Ce membre est introuvable sur le serveur.', 7000);

    const previousRejection = await database.getRejectedCv(member.id);
    if (!previousRejection) {
      return replyEphemeral(interaction, `ℹ️ ${member} ne figure pas dans les CV Police refusés.`, 8000);
    }

    // Suppression et historique sont effectués dans une seule transaction PostgreSQL.
    const removed = await database.unrejectCv(member.id, interaction.user.id, reason);
    if (!removed) {
      return replyEphemeral(interaction, '❌ Le refus n’a pas pu être annulé. Réessaie.', 9000);
    }

    const stillRejected = await database.isCvRejected(member.id);
    if (stillRejected) {
      return replyEphemeral(interaction, '❌ Le déblocage n’a pas été confirmé par la base de données. Réessaie.', 10000);
    }

    const blacklistResult = await checkBlacklist(interaction.guild, member.id);
    let accessWarning = null;
    let remainsBlocked = false;

    if (!blacklistResult.ok) {
      remainsBlocked = true;
      accessWarning = `Blacklist non vérifiable : ${blacklistResult.reason}`;
      await blockCvWriting(member, 'Vérification blacklist impossible après /unrf').catch((error) => {
        accessWarning += ` • maintien du blocage impossible : ${error.message}`;
      });
    } else if (blacklistResult.blacklisted) {
      remainsBlocked = true;
      await blockCvWriting(member, 'Joueur toujours blacklisté après /unrf').catch((error) => {
        accessWarning = `Maintien du blocage impossible : ${error.message}`;
      });
    } else {
      try {
        await restoreCvWriting(member, `Refus CV annulé par ${interaction.user.tag} : ${reason}`);
      } catch (error) {
        remainsBlocked = true;
        accessWarning = `Permissions du salon CV non restaurées : ${error.message}`;
        console.error('Erreur restauration écriture salon CV sur /unrf :', error);
      }
    }

    const oldReason = previousRejection.reason || 'Non renseignée';
    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setAuthor({
        name: `${interaction.guild.name.toUpperCase()} • RECRUITMENT DIVISION`,
        iconURL: interaction.guild.iconURL({ size: 128 }) || undefined
      })
      .setTitle('✅ REFUS CV ANNULÉ')
      .setDescription(remainsBlocked
        ? `${member} n’est plus refusé, mais l’accès au salon CV Police reste bloqué.`
        : `${member} peut de nouveau écrire dans le salon CV Police, être accepté avec **/ac**, puis intégré avec **/pl**.`)
      .addFields(
        { name: '👤 CANDIDAT', value: `${member}\n**Discord ID :** \`${member.id}\``, inline: true },
        { name: '👮 RESPONSABLE', value: `${interaction.user}\n**Discord ID :** \`${interaction.user.id}\``, inline: true },
        { name: '📝 RAISON DE L’ANNULATION', value: reason, inline: false },
        { name: '📋 ANCIENNE RAISON DU REFUS', value: oldReason.slice(0, 1024), inline: false },
        { name: '🔓 NOUVEAU STATUT', value: remainsBlocked
          ? (blacklistResult.blacklisted
            ? 'Le refus est retiré, mais le blocage reste actif car le joueur est blacklisté.'
            : `Le refus est retiré, mais le blocage reste actif. ${accessWarning || ''}`.slice(0, 1024))
          : 'Le blocage du salon CV Police est retiré. Le rôle **Accepted CV Police** n’est pas ajouté automatiquement.', inline: false }
      )
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: 'Une trace de cette annulation est conservée dans la base de données.' })
      .setTimestamp();

    const logResult = await sendLog(interaction.guild, config.channels.refusalLogs, embed, 'REFUSED CV (/unrf)');
    const warnings = [];
    if (remainsBlocked) warnings.push(accessWarning || (blacklistResult.blacklisted ? 'joueur toujours blacklisté' : 'accès au salon encore bloqué'));
    if (!logResult.ok) warnings.push(`log annulation non envoyé : ${logResult.reason}`);

    return replyEphemeral(
      interaction,
      warnings.length
        ? `⚠️ Refus annulé pour ${member}. **Raison :** ${reason}\n${warnings.join(' • ')}`
        : `✅ Refus annulé pour ${member}. **Raison :** ${reason}\nLe joueur peut de nouveau écrire dans le salon CV Police. Tu peux maintenant utiliser **/ac**, puis **/pl**. Le log a été envoyé.`,
      14000
    );
  }
};

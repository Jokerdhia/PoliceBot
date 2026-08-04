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
    if (!blacklistResult.ok) {
      // Sécurité : on conserve le blocage du salon si la blacklist ne peut pas être vérifiée.
      await blockCvWriting(member, 'Vérification blacklist impossible après /unrf').catch(() => null);
      return replyEphemeral(
        interaction,
        `⚠️ Le refus a été annulé, mais le salon CV reste bloqué car la blacklist n’a pas pu être vérifiée : ${blacklistResult.reason}`,
        14000
      );
    }

    if (blacklistResult.blacklisted) {
      await blockCvWriting(member, 'Joueur toujours blacklisté après /unrf').catch(() => null);
    } else {
      try {
        await restoreCvWriting(member, `Refus CV annulé par ${interaction.user.tag} : ${reason}`);
      } catch (error) {
        console.error('Erreur restauration écriture salon CV sur /unrf :', error);
        return replyEphemeral(
          interaction,
          `⚠️ Le refus a été annulé, mais les permissions du salon CV Police n’ont pas pu être restaurées : ${error.message}`,
          14000
        );
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
      .setDescription(blacklistResult.blacklisted
        ? `${member} n’est plus refusé, mais reste **blacklisté** : il ne peut toujours pas écrire dans le salon CV Police.`
        : `${member} peut de nouveau écrire dans le salon CV Police, être accepté avec **/ac**, puis intégré avec **/pl**.`)
      .addFields(
        { name: '👤 CANDIDAT', value: `${member}\n**Discord ID :** \`${member.id}\``, inline: true },
        { name: '👮 RESPONSABLE', value: `${interaction.user}\n**Discord ID :** \`${interaction.user.id}\``, inline: true },
        { name: '📝 RAISON DE L’ANNULATION', value: reason, inline: false },
        { name: '📋 ANCIENNE RAISON DU REFUS', value: oldReason.slice(0, 1024), inline: false },
        { name: '🔓 NOUVEAU STATUT', value: blacklistResult.blacklisted
          ? 'Le refus est retiré, mais le blocage du salon reste actif car le joueur est blacklisté.'
          : 'Le blocage du salon CV Police est retiré. Le rôle **Accepted CV Police** n’est pas ajouté automatiquement.', inline: false }
      )
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: 'Une trace de cette annulation est conservée dans la base de données.' })
      .setTimestamp();

    await sendLog(interaction.guild, config.channels.refusalLogs, embed);
    return replyEphemeral(
      interaction,
      blacklistResult.blacklisted
        ? `⚠️ Refus annulé pour ${member}, mais le joueur reste blacklisté et ne peut pas écrire dans le salon CV Police.`
        : `✅ Refus annulé pour ${member}. **Raison :** ${reason}\nLe joueur peut de nouveau écrire dans le salon CV Police. Tu peux maintenant utiliser **/ac**, puis **/pl**.`,
      11000
    );
  }
};

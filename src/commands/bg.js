const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const database = require('../database');
const { canUsePoliceCommands } = require('../utils/permissions');
const { sendLog, badgeUpdateEmbed } = require('../utils/logs');
const { replyEphemeral } = require('../utils/replies');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bg')
    .setDescription('Changer uniquement le numéro de badge d’un policier.')
    .addUserOption((option) =>
      option.setName('membre').setDescription('Le policier concerné').setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('badge')
        .setDescription(`Nouveau badge entre ${config.badge.min} et ${config.badge.max}`)
        .setMinValue(config.badge.min)
        .setMaxValue(config.badge.max)
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!canUsePoliceCommands(interaction.member)) {
      return replyEphemeral(interaction, '❌ Accès refusé : le rôle **Recruitment** est obligatoire.', 7000);
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = interaction.options.getUser('membre', true);
    const newBadge = interaction.options.getInteger('badge', true);

    if (user.id === interaction.user.id) {
      return replyEphemeral(interaction, '❌ Tu ne peux pas modifier ton propre badge.', 7000);
    }

    if (user.bot) {
      return replyEphemeral(interaction, '❌ Cette commande ne peut pas cibler un bot.', 7000);
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return replyEphemeral(interaction, '❌ Ce membre est introuvable sur le serveur.', 7000);
    }

    const officer = await database.findByUserId(member.id);
    if (!officer) {
      return replyEphemeral(interaction, '❌ Ce membre n’est pas enregistré dans la police.', 7000);
    }

    if (!member.roles.cache.has(config.roles.police)) {
      return replyEphemeral(interaction, '❌ Ce membre ne possède pas le rôle Police.', 7000);
    }

    if (officer.badge === newBadge) {
      return replyEphemeral(interaction, `❌ Ce policier possède déjà le badge **${newBadge}**.`, 7000);
    }

    const badgeOwner = await database.findByBadge(newBadge);
    if (badgeOwner && badgeOwner.userId !== member.id) {
      return replyEphemeral(interaction, `❌ Le badge **${newBadge}** est déjà utilisé.`, 7000);
    }

    const botMember = interaction.guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      return replyEphemeral(interaction, '❌ Le bot doit avoir la permission **Gérer les pseudos**.', 9000);
    }

    if (!member.manageable) {
      return replyEphemeral(interaction, '❌ Je ne peux pas gérer ce membre. Place le rôle du bot au-dessus de ses rôles.', 9000);
    }

    const oldBadge = officer.badge;
    const oldNickname = member.nickname;
    const newNickname = `[${newBadge}] ${officer.rpName}`;

    if (newNickname.length > 32) {
      return replyEphemeral(interaction, '❌ Le nouveau pseudo dépasse la limite Discord de 32 caractères.', 7000);
    }

    try {
      await member.setNickname(newNickname, `Badge modifié par ${interaction.user.tag}`);
      await database.updateBadge(member.id, newBadge, interaction.user.id);

      const logSent = await sendLog(
        interaction.guild,
        config.channels.acceptanceLogs,
        badgeUpdateEmbed({
          member,
          rpName: officer.rpName,
          oldBadge,
          newBadge,
          executor: interaction.user
        })
      );

      const logNotice = logSent ? '' : '\n⚠️ Le badge est modifié, mais le log n’a pas pu être envoyé.';
      return replyEphemeral(
        interaction,
        `✅ Badge de ${member} modifié : **${oldBadge} → ${newBadge}**.\nNouveau pseudo : **${newNickname}**${logNotice}`
      );
    } catch (error) {
      console.error('Erreur /bg :', error);
      await member.setNickname(oldNickname).catch(() => null);
      return replyEphemeral(interaction, `❌ La modification du badge a échoué : ${error.message}`, 10000);
    }
  }
};

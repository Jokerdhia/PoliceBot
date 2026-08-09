const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const database = require('../database');
const { canUsePoliceCommands } = require('../utils/permissions');
const { resetToCitizen } = require('../utils/roles');
const { sendLog, kickEmbed } = require('../utils/logs');
const { replyEphemeral } = require('../utils/replies');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Retirer un membre de la police et lui attribuer Citizen.')
    .addUserOption((option) =>
      option
        .setName('membre')
        .setDescription('Le membre à retirer de la police')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('raison')
        .setDescription('Motif obligatoire du retrait de la police')
        .setMinLength(3)
        .setMaxLength(300)
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!canUsePoliceCommands(interaction.member)) {
      return replyEphemeral(
        interaction,
        '❌ Accès refusé : le rôle **Recruitment** est obligatoire.',
        7000
      );
    }

    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = interaction.options.getUser('membre', true);
    const reason = interaction.options.getString('raison', true).trim();

    if (user.id === interaction.user.id) {
      return replyEphemeral(
        interaction,
        '❌ Tu ne peux pas te retirer toi-même de la police.',
        7000
      );
    }

    if (user.bot) {
      return replyEphemeral(interaction, '❌ Cette commande ne peut pas cibler un bot.', 7000);
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return replyEphemeral(interaction, '❌ Ce membre est introuvable sur le serveur.', 7000);
    }

    const botMember = interaction.guild.members.me;
    const hasRequiredPermissions =
      botMember.permissions.has(PermissionFlagsBits.ManageRoles) &&
      botMember.permissions.has(PermissionFlagsBits.ManageNicknames);

    if (!hasRequiredPermissions) {
      return replyEphemeral(
        interaction,
        '❌ Le bot doit avoir les permissions **Gérer les rôles** et **Gérer les pseudos**.',
        9000
      );
    }

    if (!member.manageable) {
      return replyEphemeral(
        interaction,
        '❌ Je ne peux pas gérer ce membre. Place le rôle du bot au-dessus de ses rôles.',
        9000
      );
    }

    const officer = await database.findByUserId(member.id);

    // Le pseudo enregistré peut parfois contenir un ancien badge si le membre
    // a été recruté plusieurs fois. Au kick, on supprime toujours le préfixe
    // [123] et on restaure au minimum son nom RP sans badge.
    const cleanNickname = (value) => {
      if (!value) return null;
      const cleaned = String(value)
        .replace(/^\[\d{1,4}\]\s*/, '')
        .trim()
        .replace(/\s+/g, ' ');
      return cleaned || null;
    };

    const nicknameAfterKick =
      cleanNickname(officer?.originalNickname) ||
      cleanNickname(officer?.rpName) ||
      cleanNickname(member.displayName) ||
      null;

    try {
      await resetToCitizen(member);
      await member.setNickname(
        nicknameAfterKick,
        `Retrait police par ${interaction.user.tag} — ${reason}`
      );

      // Vérification après modification pour éviter qu'un ancien badge reste affiché.
      const refreshedMember = await interaction.guild.members.fetch(member.id, { force: true });
      if (/^\[\d{1,4}\]\s*/.test(refreshedMember.nickname || '')) {
        throw new Error('Le pseudo contient encore un badge après le retrait. Vérifie la hiérarchie du rôle du bot.');
      }

      const deletedData = await database.deleteAllPoliceData(member.id);
      const removedOfficer = deletedData.officer;

      const logSent = await sendLog(
        interaction.guild,
        config.channels.kickLogs,
        kickEmbed({
          member,
          badge: removedOfficer?.badge,
          rpName: removedOfficer?.rpName,
          recruiter: interaction.user,
          reason
        })
      );

      const logNotice = logSent.ok ? '' : '\n⚠️ Le retrait est réussi, mais le log n’a pas pu être envoyé.';
      return replyEphemeral(
        interaction,
        `✅ ${member} a été retiré de la police.\nTous ses rôles gérables ont été retirés, **Citizen** a été ajouté, le badge a été supprimé du pseudo et **toutes ses données Police ont été effacées de la base du bot**.${logNotice}`
      );
    } catch (error) {
      console.error('Erreur /kick :', error);
      return replyEphemeral(
        interaction,
        `❌ Le retrait a échoué : ${error.message}`,
        10000
      );
    }
  }
};

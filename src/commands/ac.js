const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const database = require('../database');
const { canUsePoliceCommands } = require('../utils/permissions');
const { checkBlacklist } = require('../utils/blacklist');
const { replyEphemeral } = require('../utils/replies');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ac')
    .setDescription('Accepter une candidature Police et lancer l’intégration du candidat.')
    .addUserOption((option) =>
      option
        .setName('membre')
        .setDescription('Le candidat à accepter')
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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = interaction.options.getUser('membre', true);
    if (user.id === interaction.user.id) {
      return replyEphemeral(interaction, '❌ Tu ne peux pas accepter ta propre candidature.', 7000);
    }
    if (user.bot) {
      return replyEphemeral(interaction, '❌ Un bot ne peut pas être accepté comme candidat.', 7000);
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return replyEphemeral(interaction, '❌ Ce membre est introuvable sur le serveur.', 7000);
    }

    const existingOfficer = await database.findByUserId(member.id);
    if (existingOfficer || member.roles.cache.has(config.roles.police) || member.roles.cache.has(config.roles.academy)) {
      return replyEphemeral(interaction, '❌ Ce membre est déjà enregistré ou possède déjà un rôle Police/Academy.', 8000);
    }

    if (member.roles.cache.has(config.roles.acceptedCv)) {
      return replyEphemeral(interaction, 'ℹ️ Ce membre possède déjà le rôle **Accepted CV Police**.', 7000);
    }

    const blacklistResult = await checkBlacklist(interaction.guild, member.id).catch((error) => ({
      ok: false,
      reason: error.message
    }));

    if (!blacklistResult.ok) {
      return replyEphemeral(
        interaction,
        '❌ Impossible de vérifier le salon **Blacklist**. Vérifie les permissions du bot.',
        10000
      );
    }
    if (blacklistResult.blacklisted) {
      return replyEphemeral(interaction, `⛔ Candidature refusée : ${member} figure dans la **Blacklist**.`, 10000);
    }

    const botMember = interaction.guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return replyEphemeral(interaction, '❌ Le bot doit avoir la permission **Gérer les rôles**.', 9000);
    }
    if (!member.manageable) {
      return replyEphemeral(interaction, '❌ Je ne peux pas gérer ce membre. Place le rôle du bot au-dessus de ses rôles.', 9000);
    }

    const acceptedRole = await interaction.guild.roles.fetch(config.roles.acceptedCv).catch(() => null);
    if (!acceptedRole) {
      return replyEphemeral(interaction, '❌ Le rôle **Accepted CV Police** est introuvable. Vérifie `ACCEPTED_CV_ROLE_ID`.', 10000);
    }
    if (acceptedRole.position >= botMember.roles.highest.position) {
      return replyEphemeral(interaction, '❌ Le rôle du bot doit être placé au-dessus du rôle **Accepted CV Police**.', 10000);
    }

    try {
      // /ac valide uniquement le CV : aucun rôle Police ou Academy n'est ajouté ici.
      await member.roles.add(config.roles.acceptedCv, `Candidature acceptée par ${interaction.user.tag}`);

      const refreshedMember = await interaction.guild.members.fetch(member.id);
      if (!refreshedMember.roles.cache.has(config.roles.acceptedCv)) {
        throw new Error('Discord n’a pas confirmé l’ajout du rôle Accepted CV Police.');
      }

      return replyEphemeral(
        interaction,
        `✅ La candidature de ${member} est acceptée.\n` +
        'Rôle ajouté : **Accepted CV Police**.\n' +
        'Les rôles **Police** et **Academy** seront ajoutés uniquement après le formulaire d’intégration.',
        10000
      );
    } catch (error) {
      console.error('Erreur commande /ac :', error);
      return replyEphemeral(interaction, `❌ Impossible d’ajouter le rôle : ${error.message}`, 10000);
    }
  }
};

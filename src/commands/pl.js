const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const database = require('../database');
const { canUsePoliceCommands } = require('../utils/permissions');
const { recruitMember } = require('../utils/roles');
const { replyEphemeral } = require('../utils/replies');
const { checkBlacklist } = require('../utils/blacklist');
const { sendOnboardingPrompt } = require('../utils/onboarding');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pl')
    .setDescription('Donner Police et Academy puis envoyer la demande de badge.')
    .addUserOption((option) =>
      option
        .setName('membre')
        .setDescription('Le membre à intégrer')
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
      return replyEphemeral(interaction, '❌ Tu ne peux pas te recruter toi-même.', 7000);
    }

    if (user.bot) {
      return replyEphemeral(interaction, '❌ Un bot ne peut pas être recruté.', 7000);
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return replyEphemeral(interaction, '❌ Ce membre est introuvable sur le serveur.', 7000);
    }

    let blacklistResult;
    try {
      blacklistResult = await checkBlacklist(interaction.guild, member.id);
    } catch (error) {
      console.error('Erreur de vérification Blacklist :', error);
      return replyEphemeral(
        interaction,
        '❌ Intégration bloquée : impossible de vérifier le salon **Blacklist**.',
        10000
      );
    }

    if (!blacklistResult.ok) {
      return replyEphemeral(interaction, `❌ Intégration bloquée : ${blacklistResult.reason}`, 10000);
    }

    if (blacklistResult.blacklisted) {
      return replyEphemeral(
        interaction,
        `⛔ Intégration refusée : ${member} est mentionné dans le salon **Blacklist**.`,
        10000
      );
    }

    const botMember = interaction.guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return replyEphemeral(
        interaction,
        '❌ Le bot doit avoir la permission **Gérer les rôles**.',
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

    const existingOfficer = await database.findByUserId(member.id);
    if (existingOfficer) {
      return replyEphemeral(
        interaction,
        `❌ Ce membre est déjà enregistré avec le badge **${existingOfficer.badge}**.`,
        7000
      );
    }

    const hadCitizenRole = member.roles.cache.has(config.roles.citizen);
    const hadAcceptedCvRole = Boolean(
      config.roles.acceptedCv && member.roles.cache.has(config.roles.acceptedCv)
    );
    // Le pseudo doit rester STRICTEMENT identique pendant /pl.
    const nicknameBeforePl = member.nickname;

    try {
      // /pl configure uniquement les rôles et ouvre une demande d'onboarding.
      // AUCUN badge, AUCUN enregistrement officer et AUCUN changement de pseudo ici.
      const updatedMember = await recruitMember(
        member,
        `Pré-intégration /pl par ${interaction.user.tag}`
      );

      await database.setOnboardingPending(updatedMember.id, interaction.user.id);

      const onboardingSent = await sendOnboardingPrompt(updatedMember);
      if (!onboardingSent) {
        await database.clearOnboardingPending(updatedMember.id).catch(() => null);
        throw new Error(
          'Le panneau de nom RP n’a pas pu être envoyé dans ONBOARDING_CHANNEL_ID.'
        );
      }

      return replyEphemeral(
        interaction,
        `✅ ${updatedMember} a été placé en **Police** et **Academy**.\n` +
        '✅ **Citizen** et **Accepted CV Police** ont été retirés.\n' +
        '📨 Le membre a été tagué dans le salon d’intégration.\n' +
        '⏳ Aucun badge n’a été créé et son pseudo Discord reste inchangé. Le badge sera attribué uniquement après le formulaire **Demander mon badge**.'
      );
    } catch (error) {
      console.error('Erreur /pl :', error);

      // Retour arrière si le panneau ne peut pas être envoyé.
      await member.roles.remove([config.roles.police, config.roles.academy]).catch(() => null);
      if (hadCitizenRole) {
        await member.roles.add(config.roles.citizen).catch(() => null);
      }
      if (hadAcceptedCvRole && config.roles.acceptedCv) {
        await member.roles.add(config.roles.acceptedCv).catch(() => null);
      }

      return replyEphemeral(
        interaction,
        `❌ L’intégration a échoué : ${error.message}`,
        10000
      );
    }
  }
};

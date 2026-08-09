const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const database = require('../database');
const { canUsePoliceCommands } = require('../utils/permissions');
const { checkBlacklist } = require('../utils/blacklist');
const { replyEphemeral } = require('../utils/replies');

function normalizeRoleName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

async function resolveAcceptedCvRole(guild) {
  const configured = await guild.roles.fetch(config.roles.acceptedCv).catch(() => null);
  const acceptedNames = new Set(['accepted cv police', 'accepted cv', 'cv police accepted', 'police accepted cv']);

  if (configured && acceptedNames.has(normalizeRoleName(configured.name))) {
    return configured;
  }

  await guild.roles.fetch().catch(() => null);
  const byName = guild.roles.cache.find((role) => acceptedNames.has(normalizeRoleName(role.name)));
  return byName || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ac')
    .setDescription('Donner uniquement le rôle Accepted CV Police à un candidat.')
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

    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = interaction.options.getUser('membre', true);
    if (user.id === interaction.user.id) {
      return replyEphemeral(interaction, '❌ Tu ne peux pas accepter ta propre candidature.', 7000);
    }
    if (user.bot) {
      return replyEphemeral(interaction, '❌ Un bot ne peut pas être accepté comme candidat.', 7000);
    }

    const member = interaction.options.getMember('membre') || await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return replyEphemeral(interaction, '❌ Ce membre est introuvable sur le serveur.', 7000);
    }

    const existingOfficer = await database.findByUserId(member.id);
    if (existingOfficer || member.roles.cache.has(config.roles.police)) {
      return replyEphemeral(interaction, '❌ Ce membre est déjà enregistré comme policier.', 8000);
    }

    // /rf et /unrf utilisent la même table PostgreSQL que /ac.
    // Aucun cache local : un /unrf prend effet immédiatement, sans redémarrage.
    const rejectedCv = await database.getRejectedCv(member.id);
    if (rejectedCv) {
      return replyEphemeral(
        interaction,
        `⛔ Action bloquée : ${member} figure dans les **CV Police refusés**.\n` +
        `Utilise **/unrf membre:${member.user.username}** avant de l’accepter.`,
        10000
      );
    }

    const blacklistResult = await checkBlacklist(interaction.guild, member.id, member).catch((error) => ({
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

    const acceptedRole = await resolveAcceptedCvRole(interaction.guild);
    if (!acceptedRole) {
      return replyEphemeral(interaction, '❌ Le rôle **Accepted CV Police** est introuvable. Vérifie son nom et `ACCEPTED_CV_ROLE_ID` dans Render.', 10000);
    }
    if (acceptedRole.position >= botMember.roles.highest.position) {
      return replyEphemeral(interaction, '❌ Le rôle du bot doit être placé au-dessus du rôle **Accepted CV Police**.', 10000);
    }

    try {
      // /ac doit laisser le candidat uniquement en attente avec Accepted CV Police.
      // Citizen est conservé. Police et Academy sont retirés s'ils étaient présents par erreur.
      const reason = `Candidature acceptée par ${interaction.user.tag}`;
      await member.roles.add(acceptedRole.id, reason);

      const rolesToRemove = [config.roles.police, config.roles.academy]
        .filter((roleId) => roleId && roleId !== acceptedRole.id && member.roles.cache.has(roleId));
      if (rolesToRemove.length > 0) {
        await member.roles.remove(rolesToRemove, 'Nettoyage des rôles avant intégration Accepted CV');
      }

      const refreshedMember = await interaction.guild.members.fetch(member.id, { force: true });
      if (!refreshedMember.roles.cache.has(acceptedRole.id)) {
        throw new Error('Discord n’a pas confirmé l’ajout du rôle Accepted CV Police.');
      }
      if (refreshedMember.roles.cache.has(config.roles.academy)) {
        throw new Error('Le rôle Academy est toujours présent. Vérifie la hiérarchie des rôles du bot.');
      }
      if (refreshedMember.roles.cache.has(config.roles.police)) {
        throw new Error('Le rôle Police est toujours présent. Vérifie la hiérarchie des rôles du bot.');
      }

      return replyEphemeral(
        interaction,
        `✅ La candidature de ${member} est acceptée.\n` +
        'Rôle ajouté : **Accepted CV Police**.\n' +
        'Le rôle **Citizen** reste présent. Utilise ensuite **/pl** pour ajouter Police et Academy et envoyer la demande de badge.',
        10000
      );
    } catch (error) {
      console.error('Erreur commande /ac :', error);
      return replyEphemeral(interaction, `❌ Impossible d’ajouter le rôle : ${error.message}`, 10000);
    }
  }
};

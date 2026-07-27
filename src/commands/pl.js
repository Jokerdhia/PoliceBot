const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const database = require('../database');
const { canUsePoliceCommands } = require('../utils/permissions');
const { recruitMember } = require('../utils/roles');
const { sendLog, recruitmentEmbed } = require('../utils/logs');
const { replyEphemeral } = require('../utils/replies');
const { checkBlacklist } = require('../utils/blacklist');
const { sendOnboardingPrompt } = require('../utils/onboarding');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pl')
    .setDescription('Recruter un membre avec un badge disponible attribué automatiquement.')
    .addUserOption((option) =>
      option
        .setName('membre')
        .setDescription('Le membre à recruter')
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

    // /pl accepte toujours le membre, même si son nom RP n’est pas encore défini.
    // Le nom actuel sert temporairement jusqu’à ce qu’il remplisse le panneau Academy.
    const rpName = (member.displayName || member.user.username)
      .replace(/^\[\d{3}\]\s*/, '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 25) || 'Nom RP à définir';

    let blacklistResult;
    try {
      blacklistResult = await checkBlacklist(interaction.guild, member.id);
    } catch (error) {
      console.error('Erreur de vérification Blacklist :', error);
      return replyEphemeral(
        interaction,
        '❌ Recrutement bloqué : impossible de vérifier le salon **Blacklist**. Vérifie les permissions du bot.',
        10000
      );
    }

    if (!blacklistResult.ok) {
      return replyEphemeral(
        interaction,
        `❌ Recrutement bloqué : ${blacklistResult.reason}`,
        10000
      );
    }

    if (blacklistResult.blacklisted) {
      return replyEphemeral(
        interaction,
        `⛔ Recrutement refusé : ${member} est mentionné dans le salon **Blacklist**.`,
        10000
      );
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

    const existingOfficer = await database.findByUserId(member.id);
    const hasPoliceRole = member.roles.cache.has(config.roles.police);
    const hasAcademyRole = member.roles.cache.has(config.roles.academy);

    if (existingOfficer && (hasPoliceRole || hasAcademyRole)) {
      return replyEphemeral(
        interaction,
        `❌ Ce membre est déjà enregistré avec le badge **${existingOfficer.badge}**.`,
        7000
      );
    }

    // Nettoie automatiquement un ancien enregistrement devenu incohérent
    // lorsque les rôles Police et Academy ont été retirés manuellement.
    if (existingOfficer && !hasPoliceRole && !hasAcademyRole) {
      await database.removeOfficer(member.id);
    }

    const badge = await database.getRandomAvailableBadge(config.badge.min, config.badge.max);

    if (badge === null) {
      return replyEphemeral(
        interaction,
        `❌ Aucun badge disponible entre **${config.badge.min}** et **${config.badge.max}**.`,
        9000
      );
    }

    const originalNickname = member.nickname;
    const policeNickname = `[${badge}] ${rpName}`;

    if (policeNickname.length > 32) {
      return replyEphemeral(
        interaction,
        '❌ Le pseudo final dépasse la limite Discord de 32 caractères.',
        7000
      );
    }

    const hadCitizenRole = member.roles.cache.has(config.roles.citizen);
    const hadAcceptedCvRole = Boolean(config.roles.acceptedCv && member.roles.cache.has(config.roles.acceptedCv));
    let rolesChanged = false;
    let nicknameChanged = false;

    try {
      const updatedMember = await recruitMember(member, `Recrutement /pl par ${interaction.user.tag}`);
      rolesChanged = true;

      await member.setNickname(policeNickname, `Recrutement par ${interaction.user.tag}`);
      nicknameChanged = true;

      await database.addOfficer({
        userId: member.id,
        badge,
        rpName,
        originalNickname,
        recruitedBy: interaction.user.id,
        recruitedAt: new Date().toISOString()
      });

      const onboardingSent = await sendOnboardingPrompt(member).catch(() => false);

      const logSent = await sendLog(
        interaction.guild,
        config.channels.acceptanceLogs,
        recruitmentEmbed({ member, badge, rpName, recruiter: interaction.user })
      );

      const logNotice = logSent ? '' : '\n⚠️ Le recrutement est réussi, mais le log n’a pas pu être envoyé.';
      return replyEphemeral(
        interaction,
        `✅ ${updatedMember} a été recruté avec le badge **${badge}**.\n` +
        `✅ Ajoutés : **Police**, **Academy**\n` +
        `✅ Retirés : **Citizen**, **Accepted CV Police**\n` +
        `Pseudo temporaire : **${policeNickname}**\n` +
        (onboardingSent ? '📨 Le membre a été tagué dans le panneau Academy pour définir son nom RP.' : '⚠️ Le panneau Academy n’a pas pu être envoyé.') +
        `${logNotice}`
      );
    } catch (error) {
      console.error('Erreur /pl :', error);

      try {
        await database.removeOfficer(member.id);
        if (rolesChanged) {
          await member.roles.remove([config.roles.police, config.roles.academy]).catch(() => null);
          if (hadCitizenRole) await member.roles.add(config.roles.citizen).catch(() => null);
          if (hadAcceptedCvRole && config.roles.acceptedCv) {
            await member.roles.add(config.roles.acceptedCv).catch(() => null);
          }
        }
        if (nicknameChanged) {
          await member.setNickname(originalNickname).catch(() => null);
        }
      } catch (rollbackError) {
        console.error('Erreur de retour arrière /pl :', rollbackError);
      }

      return replyEphemeral(
        interaction,
        `❌ Le recrutement a échoué : ${error.message}`,
        10000
      );
    }
  }
};

const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const config = require('../config');
const database = require('../database');
const { canUsePoliceCommands } = require('../utils/permissions');
const { recruitMember } = require('../utils/roles');
const { replyEphemeral } = require('../utils/replies');
const { checkBlacklist } = require('../utils/blacklist');
const { sendOnboardingPrompt } = require('../utils/onboarding');
const { sendLog } = require('../utils/logs');

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

    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

    // /pl doit être bloqué tant qu'un refus CV est actif.
    // /unrf supprime cet enregistrement et réautorise ensuite /ac puis /pl.
    let rejectedCv;
    try {
      rejectedCv = await database.getRejectedCv(member.id);
    } catch (error) {
      console.error('Erreur de vérification des CV refusés dans /pl :', error);
      return replyEphemeral(
        interaction,
        '❌ Intégration bloquée : impossible de vérifier les **CV Police refusés**.',
        10000
      );
    }

    if (rejectedCv) {
      return replyEphemeral(
        interaction,
        `⛔ Action bloquée : ${member} figure dans les **CV Police refusés**.\n` +
          'Utilise d’abord **/unrf**, puis **/ac**, avant de lancer **/pl**.',
        10000
      );
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
    const hadPoliceRole = member.roles.cache.has(config.roles.police);
    const hadAcademyRole = member.roles.cache.has(config.roles.academy);
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

      const confirmationEmbed = new EmbedBuilder()
        .setColor(0x15803d)
        .setAuthor({
          name: `${interaction.guild.name.toUpperCase()} • PERSONNEL DIVISION`,
          iconURL: interaction.guild.iconURL({ size: 128 }) || undefined
        })
        .setTitle('✅ PRÉ-INTÉGRATION RÉUSSIE')
        .setDescription(`${updatedMember} a été placé dans les effectifs de pré-intégration.`)
        .addFields(
          {
            name: '👮 RESPONSABLE DU RECRUTEMENT',
            value: `${interaction.user}
**Identifiant Discord :** \`${interaction.user.id}\``,
            inline: true
          },
          {
            name: '🛡️ NOUVEL OFFICIER',
            value: `${updatedMember}
**Identifiant Discord :** \`${updatedMember.id}\``,
            inline: true
          },
          {
            name: '🔄 MODIFICATIONS DES RÔLES',
            value: [
              `**Ajoutés :** <@&${config.roles.police}> • <@&${config.roles.academy}>`,
              `**Retirés :** <@&${config.roles.citizen}>${config.roles.acceptedCv ? ` • <@&${config.roles.acceptedCv}>` : ''}`
            ].join('\n'),
            inline: false
          },
          {
            name: '📨 PROCHAINE ÉTAPE',
            value: [
              'Le membre a été tagué dans le salon d’intégration.',
              'Aucun badge n’a encore été créé et son pseudo reste inchangé.',
              'Le badge sera attribué après le formulaire **Demander mon badge**.'
            ].join('\n'),
            inline: false
          }
        )
        .setThumbnail(updatedMember.user.displayAvatarURL({ size: 256 }))
        .setFooter({ text: `${interaction.guild.name} • Pré-intégration du personnel` })
        .setTimestamp();

      const logSent = await sendLog(
        interaction.guild,
        config.channels.acceptanceLogs,
        confirmationEmbed
      );

      if (!logSent.ok) {
        console.warn(`⚠️ /pl réussi mais log non envoyé : ${logSent.reason}`);
      }

      // La commande est déjà acquittée auprès de Discord. On supprime ensuite la réponse
      // éphémère pour garder le salon propre sans provoquer « L’application ne répond plus ».
      await interaction.deleteReply().catch(() => null);
      return null;
    } catch (error) {
      console.error('Erreur /pl :', error);

      // Retour arrière si le panneau ne peut pas être envoyé.
      const rolesAddedByCommand = [];
      if (!hadPoliceRole) rolesAddedByCommand.push(config.roles.police);
      if (!hadAcademyRole) rolesAddedByCommand.push(config.roles.academy);
      if (rolesAddedByCommand.length) {
        await member.roles.remove(rolesAddedByCommand).catch(() => null);
      }
      await database.clearOnboardingPending(member.id).catch(() => null);
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

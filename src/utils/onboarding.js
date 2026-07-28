const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const config = require('../config');
const database = require('../database');
const { checkBlacklist } = require('./blacklist');
const { sendLog, recruitmentEmbed } = require('./logs');
const { replyEphemeral } = require('./replies');

const BUTTON_PREFIX = 'police_badge_request:';
const MODAL_PREFIX = 'police_badge_modal:';

// Verrou par membre : empêche /pl et guildMemberUpdate d'envoyer le même panneau en parallèle.
const onboardingLocks = new Map();

function onboardingEmbed(member) {
  return new EmbedBuilder()
    .setColor(0x1d4ed8)
    .setAuthor({
      name: `${member.guild.name.toUpperCase()} • POLICE DEPARTMENT`,
      iconURL: member.guild.iconURL({ size: 128 }) || undefined
    })
    .setTitle('🪪 DEMANDE DE BADGE POLICE')
    .setDescription([
      `${member}, tes rôles **Police** et **Academy** sont actifs.`,
      '',
      'Pour recevoir ton badge, clique sur le bouton ci-dessous et renseigne ton **prénom et nom RP complet**.',
      'Ton pseudo Discord sera modifié seulement après validation du formulaire.'
    ].join('\n'))
    .addFields({
      name: '📌 Format attendu',
      value: '`Jean Smith`',
      inline: false
    })
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: 'Seul le membre mentionné peut remplir cette demande.' })
    .setTimestamp();
}

function onboardingButton(memberId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}${memberId}`)
      .setLabel('Demander mon badge')
      .setEmoji('🪪')
      .setStyle(ButtonStyle.Primary)
  );
}

async function getOnboardingPrompts(channel, memberId) {
  if (!channel?.isTextBased()) return [];
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return [];

  const customId = `${BUTTON_PREFIX}${memberId}`;
  return [...messages.values()]
    .filter((message) =>
      message.author.id === channel.client.user.id &&
      message.components.some((row) =>
        row.components.some((component) => component.customId === customId)
      )
    )
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp);
}

async function sendOnboardingPrompt(member) {
  // Toutes les demandes du même membre passent dans une seule file d'attente.
  const previous = onboardingLocks.get(member.id) || Promise.resolve();
  const current = previous
    .catch(() => null)
    .then(async () => {
      const channel = await member.guild.channels.fetch(config.channels.onboarding).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        console.error('ONBOARDING_CHANNEL_ID est introuvable ou ne pointe pas vers un salon texte.');
        return false;
      }

      const permissions = channel.permissionsFor(member.guild.members.me);
      const required = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages
      ];
      if (!required.every((permission) => permissions?.has(permission))) {
        console.error('Permissions insuffisantes dans ONBOARDING_CHANNEL_ID (Voir, Envoyer, Intégrer des liens, Historique et Gérer les messages requis).');
        return false;
      }

      const prompts = await getOnboardingPrompts(channel, member.id);
      const payload = {
        content: `${member}`,
        embeds: [onboardingEmbed(member)],
        components: [onboardingButton(member.id)],
        allowedMentions: { users: [member.id] }
      };

      if (prompts.length > 0) {
        // Conserve un seul panneau, actualise son contenu et supprime tous les doublons.
        const [kept, ...duplicates] = prompts;
        await kept.edit(payload).catch(() => null);
        for (const duplicate of duplicates) {
          await duplicate.delete().catch(() => null);
        }
        console.log(`Information : panneau de badge actualisé pour ${member.user.tag}; ${duplicates.length} doublon(s) supprimé(s).`);
        return true;
      }

      await channel.send(payload);
      return true;
    })
    .finally(() => {
      if (onboardingLocks.get(member.id) === current) onboardingLocks.delete(member.id);
    });

  onboardingLocks.set(member.id, current);
  return current;
}

// Déclenché dès que le rôle Academy est ajouté.
// Un court délai évite les problèmes de cache lorsque /pl ajoute plusieurs rôles en même temps.
async function handleAcceptedRole(oldMember, newMember) {
  if (newMember.user.bot) return;

  const receivedAcademy = !oldMember.roles.cache.has(config.roles.academy) &&
    newMember.roles.cache.has(config.roles.academy);

  if (!receivedAcademy) return;

  // Discord peut émettre guildMemberUpdate avant que son cache soit complètement actualisé.
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const freshMember = await newMember.guild.members
    .fetch(newMember.id, { force: true })
    .catch(() => null);

  if (!freshMember || !freshMember.roles.cache.has(config.roles.academy)) return;
  if (await database.findByUserId(freshMember.id)) return;
  await database.setOnboardingPending(freshMember.id, null);

  const sent = await sendOnboardingPrompt(freshMember).catch((error) => {
    console.error(`Impossible d’envoyer la demande de badge à ${newMember.user.tag} :`, error);
    return false;
  });

  if (!sent) {
    // Deuxième tentative utile après un ajout de rôles simultané par /pl.
    setTimeout(async () => {
      const retryMember = await newMember.guild.members
        .fetch(newMember.id, { force: true })
        .catch(() => null);
      if (!retryMember || !retryMember.roles.cache.has(config.roles.academy)) return;
      if (await database.findByUserId(retryMember.id)) return;
      await database.setOnboardingPending(retryMember.id, null);
      await sendOnboardingPrompt(retryMember).catch((error) => {
        console.error(`Deuxième tentative onboarding échouée pour ${newMember.user.tag} :`, error);
      });
    }, 3000);
  }
}

async function handleOnboardingButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith(BUTTON_PREFIX)) return false;

  const targetId = interaction.customId.slice(BUTTON_PREFIX.length);
  if (interaction.user.id !== targetId) {
    await replyEphemeral(interaction, '❌ Cette demande de badge appartient à un autre membre.', 7000);
    return true;
  }

  const member = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!member || !member.roles.cache.has(config.roles.academy) || !member.roles.cache.has(config.roles.police)) {
    await replyEphemeral(interaction, '❌ Les rôles **Police** et **Academy** sont requis pour demander un badge.', 8000);
    return true;
  }

  const existingOfficer = await database.findByUserId(member.id);
  if (existingOfficer) {
    await replyEphemeral(interaction, `❌ Tu possèdes déjà le badge **${existingOfficer.badge}**.`, 8000);
    return true;
  }

  if (!(await database.isOnboardingPending(member.id))) {
    await replyEphemeral(interaction, '❌ Aucune demande de badge active. Demande au Recruitment de refaire **/pl**.', 9000);
    return true;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${targetId}`)
    .setTitle('Demande de badge Police');

  const fullName = new TextInputBuilder()
    .setCustomId('full_name')
    .setLabel('Prénom et nom RP')
    .setPlaceholder('Exemple : Jean Smith')
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(25)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(fullName));
  await interaction.showModal(modal);
  return true;
}

async function deleteOnboardingPrompts(channel, memberId) {
  if (!channel?.isTextBased()) return;
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return;

  const customId = `${BUTTON_PREFIX}${memberId}`;
  const matches = messages.filter((message) =>
    message.author.id === channel.client.user.id &&
    message.components.some((row) => row.components.some((component) => component.customId === customId))
  );

  for (const message of matches.values()) {
    await message.delete().catch(() => null);
  }
}

async function handleOnboardingModal(interaction) {
  if (!interaction.isModalSubmit() || !interaction.customId.startsWith(MODAL_PREFIX)) return false;

  const targetId = interaction.customId.slice(MODAL_PREFIX.length);
  if (interaction.user.id !== targetId) {
    await replyEphemeral(interaction, '❌ Ce formulaire ne t’appartient pas.', 7000);
    return true;
  }

  await interaction.deferReply({ flags: 64 });

  const member = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!member) {
    await replyEphemeral(interaction, '❌ Ton compte est introuvable sur ce serveur.', 7000);
    return true;
  }

  if (!member.roles.cache.has(config.roles.police) || !member.roles.cache.has(config.roles.academy)) {
    await replyEphemeral(interaction, '❌ Les rôles **Police** et **Academy** sont requis.', 8000);
    return true;
  }

  const existingOfficer = await database.findByUserId(member.id);
  if (existingOfficer) {
    await replyEphemeral(interaction, `❌ Tu possèdes déjà le badge **${existingOfficer.badge}**.`, 8000);
    return true;
  }

  const pendingRequest = await database.getOnboardingPending(member.id);
  if (!pendingRequest) {
    await replyEphemeral(interaction, '❌ Cette demande a expiré ou n’est pas active. Demande au Recruitment de refaire **/pl**.', 9000);
    return true;
  }

  // Le responsable est la personne ayant utilisé /pl, pas le nouvel officier
  // qui remplit ensuite son propre formulaire de badge.
  let recruiter = interaction.user;
  if (pendingRequest.requestedBy) {
    recruiter = await interaction.client.users.fetch(pendingRequest.requestedBy).catch(() => interaction.user);
  }

  const rpName = interaction.fields.getTextInputValue('full_name').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}][\p{L}'’ -]{1,23}[\p{L}]$/u.test(rpName) || !rpName.includes(' ')) {
    await replyEphemeral(interaction, '❌ Entre un prénom et un nom RP valides, par exemple **Jean Smith**.', 9000);
    return true;
  }

  const blacklistResult = await checkBlacklist(interaction.guild, member.id).catch((error) => ({
    ok: false,
    reason: error.message
  }));
  if (!blacklistResult.ok) {
    await replyEphemeral(interaction, '❌ Impossible de vérifier la Blacklist. Contacte le Recruitment.', 9000);
    return true;
  }
  if (blacklistResult.blacklisted) {
    await replyEphemeral(interaction, '⛔ Demande refusée : ton compte figure dans la Blacklist.', 10000);
    return true;
  }

  const botMember = interaction.guild.members.me;
  if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames) || !member.manageable) {
    await replyEphemeral(interaction, '❌ Le bot ne peut pas modifier ton pseudo. Vérifie la hiérarchie des rôles.', 10000);
    return true;
  }

  const badge = await database.getRandomAvailableBadge(config.badge.min, config.badge.max);
  if (badge === null) {
    await replyEphemeral(interaction, '❌ Aucun badge n’est actuellement disponible.', 9000);
    return true;
  }

  const policeNickname = `[${badge}] ${rpName}`;
  if (policeNickname.length > 32) {
    await replyEphemeral(interaction, '❌ Le nom RP est trop long pour le pseudo Discord.', 8000);
    return true;
  }

  const originalNickname = member.nickname;
  let officerCreated = false;
  let nicknameChanged = false;

  try {
    // Aucun rôle n’est changé ici : /pl les a déjà configurés.
    await member.setNickname(policeNickname, 'Badge Police demandé via ONBOARDING_CHANNEL_ID');
    nicknameChanged = true;

    await database.addOfficer({
      userId: member.id,
      badge,
      rpName,
      originalNickname,
      recruitedBy: recruiter.id,
      recruitedAt: new Date().toISOString(),
      admissionMode: 'academy_badge_request'
    });
    officerCreated = true;
    await database.clearOnboardingPending(member.id);

    const logSent = await sendLog(
      interaction.guild,
      config.channels.acceptanceLogs,
      recruitmentEmbed({ member, badge, rpName, recruiter })
    );

    const onboardingChannel = await interaction.guild.channels.fetch(config.channels.onboarding).catch(() => null);
    await deleteOnboardingPrompts(onboardingChannel, member.id);

    await replyEphemeral(
      interaction,
      `✅ Ton badge **${badge}** a été attribué. Ton pseudo est maintenant **${policeNickname}**.` +
      (logSent ? '' : '\n⚠️ Le log d’acceptation n’a pas pu être envoyé.'),
      10000
    );
  } catch (error) {
    console.error('Erreur demande de badge :', error);
    if (officerCreated) await database.removeOfficer(member.id).catch(() => null);
    if (nicknameChanged) await member.setNickname(originalNickname).catch(() => null);
    await replyEphemeral(interaction, `❌ La demande de badge a échoué : ${error.message}`, 10000);
  }

  return true;
}

async function scanAcceptedMembers(guild) {
  const academyRole = await guild.roles.fetch(config.roles.academy).catch(() => null);
  if (!academyRole) {
    console.error('❌ Le rôle Academy est introuvable. Vérifie ACADEMY_ROLE_ID.');
    return { scanned: 0, sent: 0 };
  }

  await guild.members.fetch().catch((error) => {
    console.error('❌ Impossible de charger les membres du serveur :', error.message);
  });

  let scanned = 0;
  let sent = 0;

  for (const member of academyRole.members.values()) {
    if (member.user.bot) continue;
    // Academy suffit pour recevoir le panneau. Le bouton vérifiera Police + Academy
    // avant d'autoriser l'attribution du badge.
    if (await database.findByUserId(member.id)) continue;
    await database.setOnboardingPending(member.id, null);

    scanned += 1;
    const ok = await sendOnboardingPrompt(member).catch((error) => {
      console.error(`Impossible d’envoyer la demande à ${member.user.tag} :`, error.message);
      return false;
    });
    if (ok) sent += 1;
  }

  console.log(`✅ Vérification Academy terminée : ${scanned} membre(s) sans badge, ${sent} panneau(x) disponible(s).`);
  return { scanned, sent };
}

module.exports = {
  scanAcceptedMembers,
  handleAcceptedRole,
  handleOnboardingButton,
  handleOnboardingModal,
  sendOnboardingPrompt
};

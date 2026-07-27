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
const { recruitMember } = require('./roles');
const { sendLog, recruitmentEmbed } = require('./logs');
const { replyEphemeral } = require('./replies');

const BUTTON_PREFIX = 'police_fullname:';
const MODAL_PREFIX = 'police_fullname_modal:';

function onboardingEmbed(member) {
  return new EmbedBuilder()
    .setColor(0x1d4ed8)
    .setAuthor({
      name: `${member.guild.name.toUpperCase()} • POLICE DEPARTMENT`,
      iconURL: member.guild.iconURL({ size: 128 }) || undefined
    })
    .setTitle('🚔 CANDIDATURE POLICE ACCEPTÉE')
    .setDescription([
      `${member}, ta candidature a été acceptée.`,
      '',
      'Clique sur le bouton ci-dessous pour renseigner ton **nom complet RP**.',
      'Un badge disponible entre **100 et 300** te sera attribué automatiquement.'
    ].join('\n'))
    .addFields({
      name: '📌 Format attendu',
      value: '`John Smith`',
      inline: false
    })
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: 'Cette étape doit être remplie uniquement par le candidat concerné.' })
    .setTimestamp();
}

function onboardingButton(memberId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}${memberId}`)
      .setLabel('Définir mon nom RP')
      .setEmoji('🪪')
      .setStyle(ButtonStyle.Primary)
  );
}

async function hasExistingOnboardingPrompt(channel, memberId) {
  if (!channel?.isTextBased()) return false;

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return false;

  const customId = `${BUTTON_PREFIX}${memberId}`;
  return messages.some((message) =>
    message.author.id === channel.client.user.id &&
    message.components.some((row) =>
      row.components.some((component) => component.customId === customId)
    )
  );
}

async function sendOnboardingPrompt(member) {
  const channel = await member.guild.channels.fetch(config.channels.onboarding).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.error('Salon de configuration du nom RP introuvable ou invalide.');
    return false;
  }

  const permissions = channel.permissionsFor(member.guild.members.me);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) ||
      !permissions?.has(PermissionFlagsBits.SendMessages) ||
      !permissions?.has(PermissionFlagsBits.EmbedLinks) ||
      !permissions?.has(PermissionFlagsBits.ReadMessageHistory)) {
    console.error('Permissions insuffisantes dans le salon de configuration du nom RP. Permissions requises : Voir le salon, Envoyer des messages, Intégrer des liens et Voir les anciens messages.');
    return false;
  }

  if (await hasExistingOnboardingPrompt(channel, member.id)) {
    console.log(`Information : un message d’intégration existe déjà pour ${member.user.tag}.`);
    return true;
  }

  await channel.send({
    content: `${member}`,
    embeds: [onboardingEmbed(member)],
    components: [onboardingButton(member.id)],
    allowedMentions: { users: [member.id] }
  });
  return true;
}

async function handleAcceptedRole(oldMember, newMember) {
  const receivedRole = !oldMember.roles.cache.has(config.roles.academy) &&
    newMember.roles.cache.has(config.roles.academy);

  if (!receivedRole || newMember.user.bot) return;

  if (await database.findByUserId(newMember.id)) {
    console.log(`Information : ${newMember.user.tag} est déjà enregistré dans la police.`);
    return;
  }

  await sendOnboardingPrompt(newMember).catch((error) => {
    console.error('Impossible d’envoyer le formulaire de nom RP :', error);
  });
}

async function handleOnboardingButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith(BUTTON_PREFIX)) return false;

  const targetId = interaction.customId.slice(BUTTON_PREFIX.length);
  if (interaction.user.id !== targetId) {
    await replyEphemeral(interaction, '❌ Ce formulaire appartient à un autre candidat.', 7000);
    return true;
  }

  const member = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!member || !member.roles.cache.has(config.roles.academy)) {
    await replyEphemeral(interaction, '❌ Le rôle **Academy** est requis.', 7000);
    return true;
  }

  if (await database.findByUserId(targetId)) {
    await replyEphemeral(interaction, '❌ Tu es déjà enregistré dans la police.', 7000);
    return true;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${targetId}`)
    .setTitle('Nom complet RP');

  const fullName = new TextInputBuilder()
    .setCustomId('full_name')
    .setLabel('Prénom et nom RP')
    .setPlaceholder('Exemple : John Smith')
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

  await interaction.deferReply({ ephemeral: true });

  const member = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!member) {
    await replyEphemeral(interaction, '❌ Ton compte est introuvable sur ce serveur.', 7000);
    return true;
  }

  if (!member.roles.cache.has(config.roles.academy)) {
    await replyEphemeral(interaction, '❌ Le rôle **Academy** est requis.', 7000);
    return true;
  }

  if (await database.findByUserId(member.id)) {
    await replyEphemeral(interaction, '❌ Tu es déjà enregistré dans la police.', 7000);
    return true;
  }

  const rpName = interaction.fields.getTextInputValue('full_name').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}][\p{L}'’ -]{1,23}[\p{L}]$/u.test(rpName) || !rpName.includes(' ')) {
    await replyEphemeral(
      interaction,
      '❌ Entre un prénom et un nom RP valides, par exemple **John Smith**.',
      9000
    );
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
    await replyEphemeral(interaction, '⛔ Admission refusée : ton compte figure dans la Blacklist.', 10000);
    return true;
  }

  const botMember = interaction.guild.members.me;
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles) ||
      !botMember.permissions.has(PermissionFlagsBits.ManageNicknames) ||
      !member.manageable) {
    await replyEphemeral(
      interaction,
      '❌ Le bot ne peut pas gérer tes rôles ou ton pseudo. Contacte un administrateur.',
      10000
    );
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
  let rolesChanged = false;
  let nicknameChanged = false;

  try {
    await recruitMember(member);
    rolesChanged = true;
    await member.setNickname(policeNickname, 'Admission automatique via Academy');
    nicknameChanged = true;

    await database.addOfficer({
      userId: member.id,
      badge,
      rpName,
      originalNickname,
      recruitedBy: member.id,
      recruitedAt: new Date().toISOString(),
      admissionMode: 'academy_self_service'
    });

    const logSent = await sendLog(
      interaction.guild,
      config.channels.acceptanceLogs,
      recruitmentEmbed({ member, badge, rpName, recruiter: member.user })
    );

    const onboardingChannel = await interaction.guild.channels.fetch(config.channels.onboarding).catch(() => null);
    await deleteOnboardingPrompts(onboardingChannel, member.id);

    await replyEphemeral(
      interaction,
      `✅ Admission terminée. Ton badge est **${badge}** et ton pseudo est **${policeNickname}**.` +
      (logSent ? '' : '\n⚠️ Le log d’acceptation n’a pas pu être envoyé.'),
      10000
    );
  } catch (error) {
    console.error('Erreur admission Academy :', error);
    await database.removeOfficer(member.id);
    if (rolesChanged) {
      await member.roles.remove([config.roles.police, config.roles.academy]).catch(() => null);
      await member.roles.add(config.roles.citizen).catch(() => null);
    }
    if (nicknameChanged) {
      await member.setNickname(originalNickname).catch(() => null);
    }
    await replyEphemeral(interaction, `❌ L’admission a échoué : ${error.message}`, 10000);
  }

  return true;
}

async function scanAcceptedMembers(guild) {
  const role = await guild.roles.fetch(config.roles.academy).catch(() => null);
  if (!role) {
    console.error('❌ Le rôle Academy est introuvable. Vérifie ACCEPTED_CV_ROLE_ID.');
    return { scanned: 0, sent: 0 };
  }

  await guild.members.fetch().catch((error) => {
    console.error('❌ Impossible de charger les membres du serveur. Vérifie Server Members Intent :', error.message);
  });

  let scanned = 0;
  let sent = 0;

  for (const member of role.members.values()) {
    if (member.user.bot || await database.findByUserId(member.id)) continue;
    scanned += 1;
    const ok = await sendOnboardingPrompt(member).catch((error) => {
      console.error(`Impossible d’envoyer le formulaire à ${member.user.tag} :`, error.message);
      return false;
    });
    if (ok) sent += 1;
  }

  console.log(`✅ Vérification Academy terminée : ${scanned} candidat(s), ${sent} message(s) disponible(s).`);
  return { scanned, sent };
}

module.exports = {
  scanAcceptedMembers,
  handleAcceptedRole,
  handleOnboardingButton,
  handleOnboardingModal
};

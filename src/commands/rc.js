const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const config = require('../config');
const database = require('../database');
const { canUsePoliceCommands } = require('../utils/permissions');
const { replyEphemeral } = require('../utils/replies');

const FIVE_MINUTES = 5 * 60 * 1000;

function discordDate(value) {
  if (!value) return 'Inconnue';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Inconnue';
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rc')
    .setDescription('Rechercher un policier avec son numéro de badge.')
    .addIntegerOption((option) =>
      option
        .setName('badge')
        .setDescription(`Badge recherché entre ${config.badge.min} et ${config.badge.max}`)
        .setMinValue(config.badge.min)
        .setMaxValue(config.badge.max)
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!canUsePoliceCommands(interaction.member)) {
      return replyEphemeral(interaction, '❌ Accès refusé : le rôle **Recruitment** est obligatoire.', 7000);
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const badge = interaction.options.getInteger('badge', true);
    const officer = await database.findByBadge(badge);

    if (!officer) {
      return replyEphemeral(
        interaction,
        `❌ Aucun policier n’est enregistré avec le badge **${badge}**.`,
        FIVE_MINUTES
      );
    }

    const member = await interaction.guild.members.fetch(officer.userId).catch(() => null);
    const recruiter = officer.recruitedBy ? `<@${officer.recruitedBy}>` : 'Inconnu';
    const active = Boolean(member?.roles.cache.has(config.roles.police));

    const embed = new EmbedBuilder()
      .setColor(active ? 0x1d4ed8 : 0x6b7280)
      .setAuthor({
        name: `${interaction.guild.name.toUpperCase()} • REGISTRE DU PERSONNEL`,
        iconURL: interaction.guild.iconURL({ size: 128 }) || undefined
      })
      .setTitle('🔎 RECHERCHE PAR NUMÉRO DE BADGE')
      .setDescription('Résultat confidentiel visible uniquement par l’utilisateur ayant lancé la commande.')
      .addFields(
        { name: '🎖️ BADGE', value: `\`${officer.badge}\``, inline: true },
        { name: '👤 NOM RP', value: `\`${officer.rpName}\``, inline: true },
        { name: '📌 STATUT', value: active ? '🟢 Actif' : '⚪ Non actif', inline: true },
        { name: '💬 COMPTE DISCORD', value: member ? `${member}\n\`${member.id}\`` : `Membre absent du serveur\n\`${officer.userId}\``, inline: false },
        { name: '👮 RECRUTÉ PAR', value: recruiter, inline: true },
        { name: '📅 DATE DE RECRUTEMENT', value: discordDate(officer.recruitedAt), inline: true }
      )
      .setThumbnail(member?.user.displayAvatarURL({ size: 256 }) || interaction.guild.iconURL({ size: 256 }) || null)
      .setFooter({ text: 'Consultation privée • Suppression automatique dans 5 minutes' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    setTimeout(() => interaction.deleteReply().catch(() => null), FIVE_MINUTES);
  }
};

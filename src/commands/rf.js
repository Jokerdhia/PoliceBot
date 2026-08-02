const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const config = require('../config');
const database = require('../database');
const { canUsePoliceCommands } = require('../utils/permissions');
const { replyEphemeral } = require('../utils/replies');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rf')
    .setDescription('Refuser un CV Police et bloquer toute nouvelle candidature.')
    .addUserOption((option) =>
      option
        .setName('membre')
        .setDescription('Le candidat à refuser')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('raison')
        .setDescription('Raison du refus')
        .setMinLength(3)
        .setMaxLength(500)
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!canUsePoliceCommands(interaction.member)) {
      return replyEphemeral(interaction, '❌ Accès refusé : le rôle **Recruitment** est obligatoire.', 7000);
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = interaction.options.getUser('membre', true);
    const reason = interaction.options.getString('raison', true).trim();

    if (user.id === interaction.user.id) {
      return replyEphemeral(interaction, '❌ Tu ne peux pas refuser ton propre CV.', 7000);
    }
    if (user.bot) {
      return replyEphemeral(interaction, '❌ Cette commande ne peut pas cibler un bot.', 7000);
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return replyEphemeral(interaction, '❌ Ce membre est introuvable sur le serveur.', 7000);
    }

    try {
      await database.refuseCv(member.id, reason, interaction.user.id);

      const refusedChannel = await interaction.guild.channels.fetch(config.channels.refusedCv).catch(() => null);
      if (!refusedChannel || !refusedChannel.isTextBased()) {
        return replyEphemeral(
          interaction,
          '⚠️ Le joueur a bien été enregistré comme **CV refusé**, mais le salon REFUSED CV est introuvable.',
          10000
        );
      }

      const embed = new EmbedBuilder()
        .setColor(0xb91c1c)
        .setAuthor({
          name: `${interaction.guild.name.toUpperCase()} • RECRUITMENT DIVISION`,
          iconURL: interaction.guild.iconURL({ size: 128 }) || undefined
        })
        .setTitle('❌ CV POLICE REFUSÉ')
        .setDescription(`${member} est désormais **bloqué pour toute nouvelle candidature Police**.`)
        .addFields(
          {
            name: '👤 CANDIDAT',
            value: `${member}\n**Discord ID :** \`${member.id}\``,
            inline: true
          },
          {
            name: '👮 RESPONSABLE',
            value: `${interaction.user}\n**Discord ID :** \`${interaction.user.id}\``,
            inline: true
          },
          {
            name: '📋 RAISON DU REFUS',
            value: reason,
            inline: false
          },
          {
            name: '🚫 BLOCAGE',
            value: `Toute nouvelle tentative de CV dans <#${config.channels.cvPolice}> sera automatiquement supprimée.`,
            inline: false
          }
        )
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setTimestamp();

      await refusedChannel.send({ content: `${member}`, embeds: [embed] });

      return replyEphemeral(
        interaction,
        `✅ ${member} a été ajouté aux **CV Police refusés**. Ses futurs CV seront automatiquement supprimés.`,
        9000
      );
    } catch (error) {
      console.error('Erreur /rf :', error);
      return replyEphemeral(interaction, `❌ Impossible d’enregistrer le refus : ${error.message}`, 10000);
    }
  }
};

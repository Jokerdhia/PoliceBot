const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const config = require('../config');
const database = require('../database');
const { canUsePoliceCommands } = require('../utils/permissions');
const { replyEphemeral } = require('../utils/replies');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unrf')
    .setDescription('Retirer un joueur de la liste des CV Police refusés.')
    .addUserOption((option) =>
      option.setName('membre').setDescription('Le candidat à débloquer').setRequired(true)
    ),

  async execute(interaction) {
    if (!canUsePoliceCommands(interaction.member)) {
      return replyEphemeral(interaction, '❌ Accès refusé : le rôle **Recruitment** est obligatoire.', 7000);
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('membre', true);

    try {
      const removed = await database.unrefuseCv(user.id);
      if (!removed) {
        return replyEphemeral(interaction, `⚠️ ${user} n’est pas dans la liste des **CV Police refusés**.`, 8000);
      }

      const refusedChannel = await interaction.guild.channels.fetch(config.channels.refusedCv).catch(() => null);
      if (refusedChannel?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setColor(0x16a34a)
          .setTitle('✅ REFUS CV ANNULÉ')
          .setDescription(`${user} peut désormais déposer un nouveau **CV Police**.`)
          .addFields(
            { name: '👤 CANDIDAT', value: `${user}\n**Discord ID :** \`${user.id}\``, inline: true },
            { name: '👮 RESPONSABLE', value: `${interaction.user}\n**Discord ID :** \`${interaction.user.id}\``, inline: true }
          )
          .setTimestamp();
        await refusedChannel.send({ embeds: [embed] });
      }

      return replyEphemeral(interaction, `✅ ${user} a été retiré des **CV Police refusés** et peut de nouveau envoyer son CV.`, 9000);
    } catch (error) {
      console.error('Erreur /unrf :', error);
      return replyEphemeral(interaction, `❌ Impossible d’annuler le refus : ${error.message}`, 10000);
    }
  }
};

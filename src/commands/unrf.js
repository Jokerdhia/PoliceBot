const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const config = require('../config');
const database = require('../database');
const { canUsePoliceCommands } = require('../utils/permissions');
const { replyEphemeral } = require('../utils/replies');
const { sendLog } = require('../utils/logs');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unrf')
    .setDescription('Annuler un refus de CV Police et autoriser une nouvelle candidature.')
    .addUserOption((option) => option.setName('membre').setDescription('Le candidat à débloquer').setRequired(true)),

  async execute(interaction) {
    if (!canUsePoliceCommands(interaction.member)) {
      return replyEphemeral(interaction, '❌ Accès refusé : le rôle **Recruitment** est obligatoire.', 7000);
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('membre', true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return replyEphemeral(interaction, '❌ Ce membre est introuvable sur le serveur.', 7000);

    const removed = await database.unrejectCv(member.id);
    if (!removed) {
      return replyEphemeral(interaction, `ℹ️ ${member} ne figure pas dans les CV Police refusés.`, 8000);
    }

    // Vérification immédiate : /ac lit exactement cette même table.
    const stillRejected = await database.isCvRejected(member.id);
    if (stillRejected) {
      return replyEphemeral(interaction, '❌ Le déblocage n’a pas été confirmé par la base de données. Réessaie.', 10000);
    }

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('✅ REFUS CV ANNULÉ')
      .setDescription(`${member} peut désormais déposer un nouveau **CV Police**.`)
      .addFields(
        { name: '👤 CANDIDAT', value: `${member}\n**Discord ID :** \`${member.id}\``, inline: true },
        { name: '👮 RESPONSABLE', value: `${interaction.user}\n**Discord ID :** \`${interaction.user.id}\``, inline: true }
      )
      .setTimestamp();

    await sendLog(interaction.guild, config.channels.acceptanceLogs, embed);
    return replyEphemeral(interaction, `✅ Refus annulé : ${member} peut maintenant être accepté avec **/ac**.`, 9000);
  }
};

const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const config = require('../config');
const database = require('../database');
const { canUsePoliceCommands } = require('../utils/permissions');
const { replyEphemeral } = require('../utils/replies');
const { sendLog } = require('../utils/logs');
const { removeAcceptedCvRoles } = require('../utils/roles');
const { blockCvWriting } = require('../utils/cvChannelAccess');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rf')
    .setDescription('Refuser et bloquer une nouvelle candidature Police.')
    .addUserOption((option) => option.setName('membre').setDescription('Le candidat à refuser').setRequired(true))
    .addStringOption((option) => option.setName('raison').setDescription('Raison du refus').setRequired(true).setMaxLength(1000)),

  async execute(interaction) {
    if (!canUsePoliceCommands(interaction.member)) {
      return replyEphemeral(interaction, '❌ Accès refusé : le rôle **Recruitment** est obligatoire.', 7000);
    }

    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('membre', true);
    const reason = interaction.options.getString('raison', true).trim();

    if (user.id === interaction.user.id) {
      return replyEphemeral(interaction, '❌ Tu ne peux pas refuser ta propre candidature.', 7000);
    }
    if (user.bot) {
      return replyEphemeral(interaction, '❌ Un bot ne peut pas déposer de candidature.', 7000);
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return replyEphemeral(interaction, '❌ Ce membre est introuvable sur le serveur.', 7000);

    try {
      // Un candidat refusé après entretien ne doit plus garder le rôle Accepted CV Police.
      await removeAcceptedCvRoles(
        member,
        `CV Police refusé par ${interaction.user.tag} : ${reason}`
      );
    } catch (error) {
      console.error('Erreur retrait rôle Accepted CV sur /rf :', error);
      return replyEphemeral(
        interaction,
        `❌ Le refus n’a pas été enregistré car le rôle **Accepted CV Police** n’a pas pu être retiré : ${error.message}`,
        12000
      );
    }

    await database.rejectCv(member.id, interaction.user.id, reason);

    let accessWarning = null;
    try {
      await blockCvWriting(member, `CV Police refusé par ${interaction.user.tag} : ${reason}`);
    } catch (error) {
      accessWarning = error.message;
      console.error('Erreur blocage écriture salon CV sur /rf :', error);
    }

    const embed = new EmbedBuilder()
      .setColor(0xdc2626)
      .setAuthor({ name: `${interaction.guild.name.toUpperCase()} • RECRUITMENT DIVISION`, iconURL: interaction.guild.iconURL({ size: 128 }) || undefined })
      .setTitle('❌ CV POLICE REFUSÉ')
      .setDescription(`${member} est désormais **bloqué** pour toute nouvelle candidature Police. Le rôle **Accepted CV Police** a été retiré.`)
      .addFields(
        { name: '👤 CANDIDAT', value: `${member}\n**Discord ID :** \`${member.id}\``, inline: true },
        { name: '👮 RESPONSABLE', value: `${interaction.user}\n**Discord ID :** \`${interaction.user.id}\``, inline: true },
        { name: '📋 RAISON DU REFUS', value: reason, inline: false },
        { name: '🚫 BLOCAGE', value: accessWarning
          ? `⚠️ Le refus est enregistré, mais le blocage du salon a échoué : ${accessWarning}`.slice(0, 1024)
          : 'Le joueur ne peut plus écrire ni créer de discussion dans le salon CV Police jusqu’à utilisation de **/unrf**.', inline: false }
      )
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setTimestamp();

    const logResult = await sendLog(interaction.guild, config.channels.refusalLogs, embed, 'REFUSED CV (/rf)');
    const warnings = [];
    if (accessWarning) warnings.push(`blocage du salon CV impossible : ${accessWarning}`);
    if (!logResult.ok) warnings.push(`log refus non envoyé : ${logResult.reason}`);

    return replyEphemeral(
      interaction,
      warnings.length
        ? `⚠️ Le CV de ${member} est bien refusé et son rôle **Accepted CV Police** a été retiré.\nProblème(s) secondaire(s) : ${warnings.join(' • ')}`
        : `✅ Le CV Police de ${member} a été refusé, le rôle **Accepted CV Police** a été retiré, le salon CV a été bloqué et le log a été envoyé.`,
      14000
    );
  }
};

const { MessageFlags } = require('discord.js');
const config = require('../config');

async function replyEphemeral(interaction, response, deleteAfter = 0) {
  const payload = typeof response === 'string' ? { content: response } : { ...response };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }

  // Les réponses éphémères sont déjà privées et expirent côté Discord.
  // Les supprimer automatiquement générait une requête REST supplémentaire par commande.
  if (config.features.deleteEphemeralReplies && deleteAfter > 0) {
    const timer = setTimeout(() => interaction.deleteReply().catch(() => null), deleteAfter);
    timer.unref?.();
  }
}

module.exports = { replyEphemeral };

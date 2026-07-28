const { MessageFlags } = require('discord.js');

const DEFAULT_DELETE_DELAY = 5000;

async function replyEphemeral(interaction, response, deleteAfter = DEFAULT_DELETE_DELAY) {
  const payload = typeof response === 'string'
    ? { content: response }
    : { ...response };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }

  if (deleteAfter > 0) {
    setTimeout(() => {
      interaction.deleteReply().catch(() => null);
    }, deleteAfter);
  }
}

module.exports = {
  replyEphemeral
};

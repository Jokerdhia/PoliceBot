const { MessageFlags } = require('discord.js');

const DEFAULT_DELETE_DELAY = 5000;

async function replyEphemeral(interaction, content, deleteAfter = DEFAULT_DELETE_DELAY) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
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

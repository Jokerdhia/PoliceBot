const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const database = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ready')
    .setDescription('Afficher l’état du bot, de Discord et de la base Neon.'),

  async execute(interaction) {
    const started = Date.now();
    let databaseOk = false;
    let databaseLatencyMs = null;

    try {
      databaseLatencyMs = await database.ping();
      databaseOk = true;
    } catch (error) {
      console.error('❌ /ready : ping Neon impossible :', error?.message || error);
    }

    const clientReady = interaction.client.isReady();
    const wsPing = Number.isFinite(interaction.client.ws.ping) ? Math.round(interaction.client.ws.ping) : null;
    const uptime = Math.max(0, Math.floor(interaction.client.uptime / 1000));
    const overall = clientReady && databaseOk;

    const embed = new EmbedBuilder()
      .setColor(overall ? 0x22c55e : 0xf59e0b)
      .setTitle(overall ? '✅ Police Bot — READY' : '⚠️ Police Bot — ÉTAT PARTIEL')
      .addFields(
        { name: 'Discord Gateway', value: clientReady ? '🟢 Connecté' : '🔴 Non connecté', inline: true },
        { name: 'Neon PostgreSQL', value: databaseOk ? `🟢 Connectée (${databaseLatencyMs} ms)` : '🔴 Indisponible', inline: true },
        { name: 'Ping Discord', value: wsPing === null ? 'N/A' : `${wsPing} ms`, inline: true },
        { name: 'Uptime', value: `${uptime}s`, inline: true },
        { name: 'Temps du test', value: `${Date.now() - started} ms`, inline: true },
        { name: 'Serveur', value: interaction.guild?.name || 'Inconnu', inline: true }
      )
      .setFooter({ text: 'Diagnostic privé • HMPD Police Bot' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};

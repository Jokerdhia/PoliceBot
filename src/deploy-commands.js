const { REST, Routes } = require('discord.js');
const config = require('./config');
const pl = require('./commands/pl');
const kick = require('./commands/kick');
const bg = require('./commands/bg');
const rc = require('./commands/rc');

const commands = [pl, kick, bg, rc].map((command) => command.data.toJSON());
const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    console.log('Déploiement des commandes /pl, /kick, /bg et /rc (badge automatique sur /pl)...');
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log('✅ Commandes déployées avec succès.');
  } catch (error) {
    console.error('❌ Impossible de déployer les commandes :', error);
    process.exitCode = 1;
  }
})();

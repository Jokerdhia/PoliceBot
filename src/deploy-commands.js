const { REST, Routes } = require('discord.js');
const config = require('./config');
const pl = require('./commands/pl');
const kick = require('./commands/kick');
const bg = require('./commands/bg');
const rc = require('./commands/rc');
const ac = require('./commands/ac');
const rf = require('./commands/rf');
const unrf = require('./commands/unrf');

const commands = [pl, kick, bg, rc, ac, rf, unrf].map((command) => command.data.toJSON());
const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    console.log('Déploiement des commandes /ac, /pl, /kick, /bg, /rc, /rf et /unrf (/pl sans nom RP)...');
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log('✅ Commandes déployées avec succès.');
  } catch (error) {
    console.error('❌ Impossible de déployer les commandes :', error);
    process.exitCode = 1;
  }
})();

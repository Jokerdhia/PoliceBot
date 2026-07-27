const config = require('../config');

function canUsePoliceCommands(member) {
  return member.roles.cache.has(config.roles.recruitment);
}

module.exports = {
  canUsePoliceCommands
};

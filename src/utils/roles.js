const config = require('../config');

async function recruitMember(member) {
  await member.roles.add(
    [config.roles.police, config.roles.academy],
    'Recrutement via /pl'
  );

  if (member.roles.cache.has(config.roles.citizen)) {
    await member.roles.remove(config.roles.citizen, 'Recrutement via /pl');
  }
}

async function resetToCitizen(member) {
  const removableRoleIds = member.roles.cache
    .filter((role) => {
      return (
        role.id !== member.guild.id &&
        !role.managed &&
        role.editable &&
        role.id !== config.roles.citizen
      );
    })
    .map((role) => role.id);

  if (removableRoleIds.length > 0) {
    await member.roles.remove(removableRoleIds, 'Retrait police via /kick');
  }

  if (!member.roles.cache.has(config.roles.citizen)) {
    await member.roles.add(config.roles.citizen, 'Retour au rôle Citizen via /kick');
  }
}

module.exports = {
  recruitMember,
  resetToCitizen
};

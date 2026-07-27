const config = require('../config');

const ACCEPTED_ROLE_NAMES = new Set([
  'accepted cv police',
  'accepted cv',
  'cv police accepted',
  'police accepted cv'
]);

async function fetchFreshMember(member) {
  return member.guild.members.fetch(member.id, { force: true });
}

function normalizeRoleName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function getAcceptedCvRoles(member) {
  return member.roles.cache.filter((role) => {
    if (role.id === config.roles.acceptedCv) return true;
    return ACCEPTED_ROLE_NAMES.has(normalizeRoleName(role.name));
  });
}

async function removeAcceptedCvRoles(member, reason) {
  member = await fetchFreshMember(member);
  const roles = getAcceptedCvRoles(member);

  for (const role of roles.values()) {
    if (role.managed) {
      throw new Error(`Le rôle ${role.name} est géré par une intégration Discord et ne peut pas être retiré par le bot.`);
    }

    if (!role.editable) {
      throw new Error(
        `Le rôle ${role.name} (${role.id}) est au-dessus du rôle du bot. ` +
        'Place le rôle du bot au-dessus dans la hiérarchie Discord.'
      );
    }

    await member.roles.remove(role.id, reason);
  }

  member = await fetchFreshMember(member);
  const remaining = getAcceptedCvRoles(member);
  if (remaining.size > 0) {
    const details = remaining.map((role) => `${role.name} (${role.id})`).join(', ');
    throw new Error(`Le rôle Accepted CV est toujours présent : ${details}. Vérifie qu’il n’existe pas en double.`);
  }

  return member;
}

async function recruitMember(member, reason = 'Recrutement Police') {
  member = await fetchFreshMember(member);

  const policeRole = await member.guild.roles.fetch(config.roles.police).catch(() => null);
  const academyRole = await member.guild.roles.fetch(config.roles.academy).catch(() => null);
  const citizenRole = await member.guild.roles.fetch(config.roles.citizen).catch(() => null);

  for (const [label, role] of [['Police', policeRole], ['Academy', academyRole], ['Citizen', citizenRole]]) {
    if (!role) throw new Error(`Le rôle ${label} est introuvable. Vérifie son identifiant dans Render.`);
    if (role.managed) throw new Error(`Le rôle ${label} est géré par une intégration Discord.`);
    if (!role.editable) {
      throw new Error(`Le rôle du bot doit être placé au-dessus du rôle ${label}.`);
    }
  }

  // Ajouter d'abord Police et Academy.
  await member.roles.add([config.roles.police, config.roles.academy], reason);

  // Retirer Citizen.
  await member.roles.remove(config.roles.citizen, reason);

  // Retirer le rôle Accepted CV configuré ainsi que tout doublon portant le même nom.
  member = await removeAcceptedCvRoles(member, reason);

  // Vérification finale directement auprès de Discord.
  member = await fetchFreshMember(member);
  const errors = [];
  if (!member.roles.cache.has(config.roles.police)) errors.push('le rôle Police n’a pas été ajouté');
  if (!member.roles.cache.has(config.roles.academy)) errors.push('le rôle Academy n’a pas été ajouté');
  if (member.roles.cache.has(config.roles.citizen)) errors.push('le rôle Citizen est toujours présent');

  const remainingAcceptedRoles = getAcceptedCvRoles(member);
  if (remainingAcceptedRoles.size > 0) {
    errors.push(
      `le rôle Accepted CV est toujours présent (${remainingAcceptedRoles.map((role) => role.id).join(', ')})`
    );
  }

  if (errors.length > 0) {
    throw new Error(errors.join(' ; '));
  }

  return member;
}

async function resetToCitizen(member, reason = 'Retrait Police') {
  member = await fetchFreshMember(member);

  for (const roleId of [config.roles.police, config.roles.academy]) {
    if (!roleId) continue;
    await member.roles.remove(roleId, reason).catch(() => null);
  }

  await removeAcceptedCvRoles(member, reason).catch((error) => {
    console.error('Impossible de retirer complètement Accepted CV pendant le kick :', error.message);
  });

  await member.roles.add(config.roles.citizen, reason);
  return fetchFreshMember(member);
}

module.exports = {
  recruitMember,
  resetToCitizen,
  removeAcceptedCvRoles,
  getAcceptedCvRoles
};

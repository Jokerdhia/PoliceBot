const config = require('../config');

const ACCEPTED_ROLE_NAMES = new Set([
  'accepted cv police',
  'accepted cv',
  'cv police accepted',
  'police accepted cv'
]);

function normalizeRoleName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function getAcceptedCvRoles(member) {
  return member.roles.cache.filter((role) =>
    role.id === config.roles.acceptedCv || ACCEPTED_ROLE_NAMES.has(normalizeRoleName(role.name))
  );
}

function getConfiguredRole(guild, roleId, label) {
  const role = guild.roles.cache.get(roleId);
  if (!role) throw new Error(`Le rôle ${label} est introuvable. Vérifie son identifiant dans Render.`);
  if (role.managed) throw new Error(`Le rôle ${label} est géré par une intégration Discord.`);
  if (!role.editable) throw new Error(`Le rôle du bot doit être placé au-dessus du rôle ${label}.`);
  return role;
}

async function fetchMemberFresh(member, attempts = 3) {
  let last = member;
  for (let i = 0; i < attempts; i += 1) {
    try {
      // Discord.js v14 attend un objet d'options pour appliquer réellement force=true.
      // fetch(member.id, { force: true }) ignore le second argument et peut donc renvoyer
      // le membre en cache, ce qui créait de faux échecs juste après une modification de rôles.
      last = await member.guild.members.fetch({ user: member.id, force: true, cache: true });
    } catch (_) {
      // On conserve la dernière version connue et on retente brièvement.
    }
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return last;
}

async function verifyMember(member) {
  return fetchMemberFresh(member);
}

async function removeAcceptedCvRoles(member, reason, verify = true) {
  const roles = getAcceptedCvRoles(member);
  for (const role of roles.values()) {
    if (role.managed) throw new Error(`Le rôle ${role.name} est géré par une intégration Discord.`);
    if (!role.editable) {
      throw new Error(`Le rôle ${role.name} (${role.id}) est au-dessus du rôle du bot. Place le rôle du bot au-dessus.`);
    }
  }

  if (roles.size > 0) {
    member = await member.roles.remove([...roles.keys()], reason);
  }

  if (!verify) return member;
  member = await verifyMember(member);
  const remaining = getAcceptedCvRoles(member);
  if (remaining.size > 0) {
    const details = remaining.map((role) => `${role.name} (${role.id})`).join(', ');
    throw new Error(`Le rôle Accepted CV est toujours présent : ${details}. Vérifie les doublons et la hiérarchie.`);
  }
  return member;
}

async function recruitMember(member, reason = 'Recrutement Police') {
  getConfiguredRole(member.guild, config.roles.police, 'Police');
  getConfiguredRole(member.guild, config.roles.academy, 'Academy');
  getConfiguredRole(member.guild, config.roles.citizen, 'Citizen');

  const add = [config.roles.police, config.roles.academy].filter((id) => !member.roles.cache.has(id));
  if (add.length) member = await member.roles.add(add, reason);

  if (member.roles.cache.has(config.roles.citizen)) {
    member = await member.roles.remove(config.roles.citizen, reason);
  }

  member = await removeAcceptedCvRoles(member, reason, false);
  member = await verifyMember(member);

  const errors = [];
  if (!member.roles.cache.has(config.roles.police)) errors.push('le rôle Police n’a pas été ajouté');
  if (!member.roles.cache.has(config.roles.academy)) errors.push('le rôle Academy n’a pas été ajouté');
  if (member.roles.cache.has(config.roles.citizen)) errors.push('le rôle Citizen est toujours présent');
  const remainingAccepted = getAcceptedCvRoles(member);
  if (remainingAccepted.size) errors.push(`le rôle Accepted CV est toujours présent (${[...remainingAccepted.keys()].join(', ')})`);
  if (errors.length) throw new Error(errors.join(' ; '));
  return member;
}

async function resetToCitizen(member, reason = 'Retrait Police') {
  getConfiguredRole(member.guild, config.roles.citizen, 'Citizen');

  const rolesToRemove = member.roles.cache.filter((role) =>
    role.id !== member.guild.id &&
    role.id !== config.roles.citizen &&
    !role.managed &&
    role.editable
  );

  if (rolesToRemove.size) member = await member.roles.remove([...rolesToRemove.keys()], reason);
  if (!member.roles.cache.has(config.roles.citizen)) member = await member.roles.add(config.roles.citizen, reason);

  member = await verifyMember(member);
  const blockedRoles = member.roles.cache.filter((role) =>
    role.id !== member.guild.id && role.id !== config.roles.citizen && !role.managed
  );
  if (blockedRoles.size) {
    const details = blockedRoles.map((role) => `${role.name} (${role.id})`).join(', ');
    throw new Error(`Certains rôles n'ont pas pu être retirés : ${details}. Place le rôle du bot au-dessus.`);
  }
  return member;
}

module.exports = { recruitMember, resetToCitizen, removeAcceptedCvRoles, getAcceptedCvRoles, fetchMemberFresh };

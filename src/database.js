const fs = require('node:fs');
const path = require('node:path');

const dataDirectory = path.join(process.cwd(), 'data');
const databasePath = path.join(dataDirectory, 'officers.json');

function ensureDatabase() {
  fs.mkdirSync(dataDirectory, { recursive: true });

  if (!fs.existsSync(databasePath)) {
    fs.writeFileSync(databasePath, JSON.stringify({ officers: [] }, null, 2), 'utf8');
  }
}

function readDatabase() {
  ensureDatabase();

  try {
    const raw = fs.readFileSync(databasePath, 'utf8');
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed.officers)) {
      throw new Error('Le champ officers est invalide.');
    }

    return parsed;
  } catch (error) {
    throw new Error(`Impossible de lire la base de données : ${error.message}`);
  }
}

function writeDatabase(database) {
  ensureDatabase();

  const temporaryPath = `${databasePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(database, null, 2), 'utf8');
  fs.renameSync(temporaryPath, databasePath);
}

function findByUserId(userId) {
  return readDatabase().officers.find((officer) => officer.userId === userId) ?? null;
}

function findByBadge(badge) {
  return readDatabase().officers.find((officer) => officer.badge === badge) ?? null;
}

function getRandomAvailableBadge(minBadge, maxBadge) {
  const database = readDatabase();
  const usedBadges = new Set(database.officers.map((officer) => officer.badge));
  const availableBadges = [];

  for (let badge = minBadge; badge <= maxBadge; badge += 1) {
    if (!usedBadges.has(badge)) {
      availableBadges.push(badge);
    }
  }

  if (availableBadges.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * availableBadges.length);
  return availableBadges[randomIndex];
}

function addOfficer(officer) {
  const database = readDatabase();

  if (database.officers.some((item) => item.userId === officer.userId)) {
    throw new Error('Ce membre est déjà enregistré dans la police.');
  }

  if (database.officers.some((item) => item.badge === officer.badge)) {
    throw new Error(`Le badge ${officer.badge} est déjà utilisé.`);
  }

  database.officers.push(officer);
  writeDatabase(database);
  return officer;
}

function updateBadge(userId, newBadge, updatedBy) {
  const database = readDatabase();
  const officer = database.officers.find((item) => item.userId === userId);

  if (!officer) {
    throw new Error('Ce membre n’est pas enregistré dans la police.');
  }

  if (database.officers.some((item) => item.badge === newBadge && item.userId !== userId)) {
    throw new Error(`Le badge ${newBadge} est déjà utilisé.`);
  }

  officer.badge = newBadge;
  officer.badgeUpdatedBy = updatedBy;
  officer.badgeUpdatedAt = new Date().toISOString();
  writeDatabase(database);
  return officer;
}

function removeOfficer(userId) {
  const database = readDatabase();
  const index = database.officers.findIndex((officer) => officer.userId === userId);

  if (index === -1) {
    return null;
  }

  const [removed] = database.officers.splice(index, 1);
  writeDatabase(database);
  return removed;
}

module.exports = {
  findByUserId,
  findByBadge,
  getRandomAvailableBadge,
  addOfficer,
  updateBadge,
  removeOfficer
};

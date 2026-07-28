const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const config = require('./config');

const secureDatabaseUrl = config.databaseUrl.replace(/sslmode=require(?=(&|$))/i, 'sslmode=verify-full');

const pool = new Pool({
  connectionString: secureDatabaseUrl,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true
});

pool.on('error', (error) => console.error('❌ Erreur PostgreSQL inattendue :', error.message));

function mapOfficer(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    badge: row.badge,
    rpName: row.rp_name,
    originalNickname: row.original_nickname,
    recruitedBy: row.recruited_by,
    recruitedAt: row.recruited_at?.toISOString?.() ?? row.recruited_at,
    admissionMode: row.admission_mode,
    badgeUpdatedBy: row.badge_updated_by,
    badgeUpdatedAt: row.badge_updated_at?.toISOString?.() ?? row.badge_updated_at
  };
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS officers (
      user_id TEXT PRIMARY KEY,
      badge INTEGER NOT NULL UNIQUE CHECK (badge BETWEEN 100 AND 300),
      rp_name TEXT NOT NULL,
      original_nickname TEXT,
      recruited_by TEXT,
      recruited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      admission_mode TEXT,
      badge_updated_by TEXT,
      badge_updated_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS onboarding_pending (
      user_id TEXT PRIMARY KEY,
      requested_by TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await migrateJsonIfNeeded();
  console.log('✅ Base de données Neon connectée et prête.');
}

async function migrateJsonIfNeeded() {
  const legacyPath = path.join(process.cwd(), 'data', 'officers.json');
  if (!fs.existsSync(legacyPath)) return;
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM officers');
  if (rows[0].count > 0) return;

  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(legacyPath, 'utf8')); }
  catch (error) { console.warn(`⚠️ Migration JSON ignorée : ${error.message}`); return; }
  if (!Array.isArray(parsed.officers) || parsed.officers.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let imported = 0;
    for (const officer of parsed.officers) {
      if (!officer?.userId || !Number.isInteger(Number(officer.badge)) || !officer?.rpName) continue;
      const result = await client.query(
        `INSERT INTO officers (user_id,badge,rp_name,original_nickname,recruited_by,recruited_at,admission_mode,badge_updated_by,badge_updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [officer.userId, Number(officer.badge), officer.rpName, officer.originalNickname ?? null,
         officer.recruitedBy ?? null, officer.recruitedAt ?? new Date().toISOString(),
         officer.admissionMode ?? null, officer.badgeUpdatedBy ?? null, officer.badgeUpdatedAt ?? null]
      );
      imported += result.rowCount;
    }
    await client.query('COMMIT');
    console.log(`✅ Migration Neon terminée : ${imported} policier(s) importé(s).`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration JSON vers Neon impossible :', error.message);
  } finally { client.release(); }
}

async function ping() {
  const started = Date.now();
  await pool.query('SELECT 1');
  return Date.now() - started;
}
async function findByUserId(userId) {
  const result = await pool.query('SELECT * FROM officers WHERE user_id=$1 LIMIT 1', [userId]);
  return mapOfficer(result.rows[0]);
}
async function findByBadge(badge) {
  const result = await pool.query('SELECT * FROM officers WHERE badge=$1 LIMIT 1', [badge]);
  return mapOfficer(result.rows[0]);
}
async function getRandomAvailableBadge(minBadge, maxBadge) {
  const result = await pool.query(
    `SELECT candidate AS badge FROM generate_series($1::int,$2::int) candidate
     LEFT JOIN officers ON officers.badge=candidate WHERE officers.badge IS NULL
     ORDER BY RANDOM() LIMIT 1`, [minBadge, maxBadge]);
  return result.rows[0]?.badge ?? null;
}
async function addOfficer(officer) {
  try {
    const result = await pool.query(
      `INSERT INTO officers (user_id,badge,rp_name,original_nickname,recruited_by,recruited_at,admission_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [officer.userId, officer.badge, officer.rpName, officer.originalNickname ?? null,
       officer.recruitedBy ?? null, officer.recruitedAt ?? new Date().toISOString(), officer.admissionMode ?? null]);
    return mapOfficer(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      if (error.constraint?.includes('badge')) throw new Error(`Le badge ${officer.badge} est déjà utilisé.`);
      throw new Error('Ce membre est déjà enregistré dans la police.');
    }
    throw error;
  }
}
async function updateBadge(userId, newBadge, updatedBy) {
  try {
    const result = await pool.query(
      `UPDATE officers SET badge=$2,badge_updated_by=$3,badge_updated_at=NOW()
       WHERE user_id=$1 RETURNING *`, [userId, newBadge, updatedBy]);
    if (!result.rowCount) throw new Error('Ce membre n’est pas enregistré dans la police.');
    return mapOfficer(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') throw new Error(`Le badge ${newBadge} est déjà utilisé.`);
    throw error;
  }
}
async function updateRpName(userId, rpName) {
  const result = await pool.query(
    `UPDATE officers SET rp_name=$2 WHERE user_id=$1 RETURNING *`,
    [userId, rpName]
  );
  if (!result.rowCount) throw new Error('Ce membre n’est pas enregistré dans la police.');
  return mapOfficer(result.rows[0]);
}

async function removeOfficer(userId) {
  const result = await pool.query('DELETE FROM officers WHERE user_id=$1 RETURNING *', [userId]);
  return mapOfficer(result.rows[0]);
}

async function setOnboardingPending(userId, requestedBy = null) {
  await pool.query(
    `INSERT INTO onboarding_pending (user_id, requested_by, requested_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE
     SET requested_by = EXCLUDED.requested_by, requested_at = NOW()`,
    [userId, requestedBy]
  );
}

async function isOnboardingPending(userId) {
  const result = await pool.query(
    'SELECT 1 FROM onboarding_pending WHERE user_id=$1 LIMIT 1',
    [userId]
  );
  return result.rowCount > 0;
}

async function clearOnboardingPending(userId) {
  await pool.query('DELETE FROM onboarding_pending WHERE user_id=$1', [userId]);
}

async function close() { await pool.end(); }

module.exports = { initializeDatabase, ping, findByUserId, findByBadge, getRandomAvailableBadge, addOfficer, updateBadge, updateRpName, removeOfficer, setOnboardingPending, isOnboardingPending, clearOnboardingPending, close };

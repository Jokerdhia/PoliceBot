require('dotenv').config();

function env(name, fallback = '') {
  const value = process.env[name];
  return value == null ? fallback : String(value).trim();
}

function boolEnv(name, fallback = false) {
  const value = env(name);
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function intEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(env(name), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const required = [
  'DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'DATABASE_URL',
  'CITIZEN_ROLE_ID', 'POLICE_ROLE_ID', 'ACADEMY_ROLE_ID', 'ACCEPTED_CV_ROLE_ID', 'RECRUITMENT_ROLE_ID',
  'BLACKLIST_CHANNEL_ID', 'ACCEPTANCE_LOG_CHANNEL_ID', 'KICK_LOG_CHANNEL_ID', 'ONBOARDING_CHANNEL_ID'
];

const missing = required.filter((name) => !env(name));
if (missing.length) {
  throw new Error(`Variables d'environnement manquantes : ${missing.join(', ')}`);
}

const snowflakePattern = /^\d{17,20}$/;
for (const name of required.filter((name) => name.endsWith('_ID'))) {
  if (!snowflakePattern.test(env(name))) {
    throw new Error(`${name} n'est pas un identifiant Discord valide.`);
  }
}

const roleIds = {
  citizen: env('CITIZEN_ROLE_ID'),
  police: env('POLICE_ROLE_ID'),
  academy: env('ACADEMY_ROLE_ID'),
  acceptedCv: env('ACCEPTED_CV_ROLE_ID'),
  recruitment: env('RECRUITMENT_ROLE_ID')
};
const duplicatedRoleIds = Object.entries(roleIds).filter(([key, value], index, arr) =>
  arr.findIndex(([, other]) => other === value) !== index
);
if (duplicatedRoleIds.length) {
  throw new Error(`Configuration invalide : plusieurs rôles utilisent le même ID (${duplicatedRoleIds.map(([k]) => k).join(', ')}).`);
}

module.exports = Object.freeze({
  token: env('DISCORD_TOKEN'),
  clientId: env('CLIENT_ID'),
  guildId: env('GUILD_ID'),
  databaseUrl: env('DATABASE_URL'),
  port: intEnv('PORT', 10000, 1, 65535),
  roles: Object.freeze(roleIds),
  channels: Object.freeze({
    blacklist: env('BLACKLIST_CHANNEL_ID'),
    cvPolice: env('CV_POLICE_CHANNEL_ID') || null,
    acceptanceLogs: env('ACCEPTANCE_LOG_CHANNEL_ID'),
    refusalLogs: env('REFUSED_CV_CHANNEL_ID') || env('REFUSAL_LOG_CHANNEL_ID') || env('KICK_LOG_CHANNEL_ID'),
    kickLogs: env('KICK_LOG_CHANNEL_ID'),
    onboarding: env('ONBOARDING_CHANNEL_ID')
  }),
  badge: Object.freeze({ min: 100, max: 300, reserved: Object.freeze([106]) }),
  features: Object.freeze({
    syncCommandsOnStart: boolEnv('SYNC_COMMANDS_ON_START', false),
    startupDiagnostics: boolEnv('STARTUP_DIAGNOSTICS', false),
    guildMembersIntent: boolEnv('ENABLE_GUILD_MEMBERS_INTENT', false),
    messageContentIntent: boolEnv('ENABLE_MESSAGE_CONTENT_INTENT', false),
    deleteEphemeralReplies: boolEnv('DELETE_EPHEMERAL_REPLIES', false)
  }),
  limits: Object.freeze({
    blacklistMaxMessages: intEnv('BLACKLIST_MAX_MESSAGES', 5000, 100, 20000),
    blacklistPositiveCacheMs: intEnv('BLACKLIST_POSITIVE_CACHE_MS', 300000, 10000, 3600000),
    blacklistNegativeCacheMs: intEnv('BLACKLIST_NEGATIVE_CACHE_MS', 15000, 0, 300000)
  })
});

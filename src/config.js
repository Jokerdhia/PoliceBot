require('dotenv').config();

const required = [
  'DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'DATABASE_URL',
  'CITIZEN_ROLE_ID', 'POLICE_ROLE_ID', 'ACADEMY_ROLE_ID', 'ACCEPTED_CV_ROLE_ID', 'RECRUITMENT_ROLE_ID',
  'BLACKLIST_CHANNEL_ID', 'ACCEPTANCE_LOG_CHANNEL_ID', 'KICK_LOG_CHANNEL_ID',
  'ONBOARDING_CHANNEL_ID'
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  throw new Error(`Variables d'environnement manquantes : ${missing.join(', ')}`);
}

const snowflakePattern = /^\d{17,20}$/;
for (const name of required.filter((name) => name.endsWith('_ID'))) {
  if (!snowflakePattern.test(process.env[name])) {
    throw new Error(`${name} n'est pas un identifiant Discord valide.`);
  }
}

module.exports = Object.freeze({
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  databaseUrl: process.env.DATABASE_URL,
  port: Number.parseInt(process.env.PORT || '3000', 10),
  roles: Object.freeze({
    citizen: process.env.CITIZEN_ROLE_ID,
    police: process.env.POLICE_ROLE_ID,
    academy: process.env.ACADEMY_ROLE_ID,
    acceptedCv: process.env.ACCEPTED_CV_ROLE_ID,
    recruitment: process.env.RECRUITMENT_ROLE_ID
  }),
  channels: Object.freeze({
    blacklist: process.env.BLACKLIST_CHANNEL_ID,
    acceptanceLogs: process.env.ACCEPTANCE_LOG_CHANNEL_ID,
    kickLogs: process.env.KICK_LOG_CHANNEL_ID,
    onboarding: process.env.ONBOARDING_CHANNEL_ID,
    refusedCv: process.env.REFUSED_CV_CHANNEL_ID || '1533426172803944579',
    cvPolice: process.env.CV_POLICE_CHANNEL_ID || '1528151509412479093'
  }),
  badge: Object.freeze({ min: 100, max: 300, reserved: Object.freeze([106]) })
});

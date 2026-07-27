require('dotenv').config();

const required = [
  'DISCORD_TOKEN',
  'CLIENT_ID',
  'GUILD_ID',
  'CITIZEN_ROLE_ID',
  'POLICE_ROLE_ID',
  'ACADEMY_ROLE_ID',
  'RECRUITMENT_ROLE_ID',
  'BLACKLIST_CHANNEL_ID',
  'ACCEPTANCE_LOG_CHANNEL_ID',
  'KICK_LOG_CHANNEL_ID',
  'ACCEPTED_CV_ROLE_ID',
  'ONBOARDING_CHANNEL_ID'
];

const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  throw new Error(`Variables d'environnement manquantes : ${missing.join(', ')}`);
}

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  roles: {
    citizen: process.env.CITIZEN_ROLE_ID,
    police: process.env.POLICE_ROLE_ID,
    academy: process.env.ACADEMY_ROLE_ID,
    recruitment: process.env.RECRUITMENT_ROLE_ID,
    acceptedCv: process.env.ACCEPTED_CV_ROLE_ID
  },
  channels: {
    blacklist: process.env.BLACKLIST_CHANNEL_ID,
    acceptanceLogs: process.env.ACCEPTANCE_LOG_CHANNEL_ID,
    kickLogs: process.env.KICK_LOG_CHANNEL_ID,
    onboarding: process.env.ONBOARDING_CHANNEL_ID
  },
  badge: {
    min: 100,
    max: 300
  }
};

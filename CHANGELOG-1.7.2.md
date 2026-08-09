# PoliceBot 1.7.2 — Discord Gateway Fix

- Intents privilégiés désactivés par défaut pour éviter les blocages Gateway / code 4014.
- `/pl` fonctionne avec les intents minimaux `Guilds` + `GuildMessages`.
- `GuildMembers` et `MessageContent` deviennent optionnels via variables Render.
- Diagnostics Shard Discord ajoutés (disconnect, reconnect, invalidated, errors).
- Conservation de l’ACK immédiat des slash commands avant tout accès DB/Discord.
- Node.js 22 LTS conservé.

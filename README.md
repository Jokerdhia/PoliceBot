# Police Bot Discord — v1.8.0

Version optimisée pour Render + Neon PostgreSQL.

## Commandes
`/ac` accepte un CV, `/pl` lance la pré-intégration, `/kick` retire un policier, `/bg` change un badge, `/rc` recherche un badge, `/rf` refuse un CV et `/unrf` annule un refus.

## Optimisations importantes
- Le port HTTP démarre immédiatement pour Render (`/health`).
- Connexion Gateway Discord sans pré-test REST inutile.
- Synchronisation des slash commands au démarrage désactivée par défaut pour éviter un `PUT` Discord à chaque restart.
- Diagnostics REST de démarrage désactivés par défaut.
- Réponses éphémères non supprimées automatiquement : économie d'une requête REST par commande.
- Les membres fournis dans le payload des slash commands sont réutilisés avant tout `fetch()` REST.
- Mutations de rôles regroupées et une seule vérification finale du membre.
- Cache de vérification Blacklist : résultats positifs 5 min, négatifs 15 s par défaut.
- Intents privilégiés désactivés par défaut.

## Variables obligatoires
`DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `DATABASE_URL`, `CITIZEN_ROLE_ID`, `POLICE_ROLE_ID`, `ACADEMY_ROLE_ID`, `ACCEPTED_CV_ROLE_ID`, `RECRUITMENT_ROLE_ID`, `BLACKLIST_CHANNEL_ID`, `ACCEPTANCE_LOG_CHANNEL_ID`, `KICK_LOG_CHANNEL_ID`, `ONBOARDING_CHANNEL_ID`.

Variables recommandées : `REFUSED_CV_CHANNEL_ID`, `CV_POLICE_CHANNEL_ID`.

## Options
- `SYNC_COMMANDS_ON_START=false` : laisser `false` en production. Mettre `true` une seule fois si les slash commands ont changé, puis remettre `false`.
- `STARTUP_DIAGNOSTICS=false` : évite les appels REST inutiles au démarrage.
- `ENABLE_GUILD_MEMBERS_INTENT=false` : active l'onboarding automatique sur ajout manuel d'Academy uniquement si l'intent est aussi activé dans Discord Developer Portal.
- `ENABLE_MESSAGE_CONTENT_INTENT=false` : active la protection temps réel du salon CV uniquement si l'intent est aussi activé dans Discord Developer Portal.
- `DELETE_EPHEMERAL_REPLIES=false` : recommandé pour limiter les requêtes REST.
- `BLACKLIST_MAX_MESSAGES=5000`, `BLACKLIST_POSITIVE_CACHE_MS=300000`, `BLACKLIST_NEGATIVE_CACHE_MS=15000`.

## Déploiement des commandes
Le bot ne resynchronise plus les commandes à chaque démarrage. Pour les redéployer ponctuellement :

```bash
npm run deploy
```

ou mettre temporairement `SYNC_COMMANDS_ON_START=true` pour un seul déploiement.

## Render / HTTP 429 Discord
Un HTTP 429 avec un `Retry-After` de plusieurs heures provenant d'une IP Render partagée est un blocage externe Discord/Render. Aucun code ne peut contourner proprement ce rate-limit. Cette version réduit fortement les requêtes Discord afin de ne pas l'aggraver. Éviter les redéploiements répétés pendant le délai.

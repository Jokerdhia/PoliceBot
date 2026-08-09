# PoliceBot 1.7.3

- `DISCORD_TOKEN`, `CLIENT_ID` et `GUILD_ID` sont normalisés avec `trim()` pour éviter les espaces/retours ligne Render.
- Intents réduits à `Guilds` uniquement : aucun intent privilégié requis pour les commandes slash.
- Diagnostic Discord avant le Gateway via HTTPS IPv4 : `/users/@me` vérifie le token et `/gateway/bot` vérifie l'accès Gateway et la limite de sessions.
- Détection explicite d'un `CLIENT_ID` qui ne correspond pas au bot du token.
- Les erreurs sont maintenant séparées entre token invalide, API Discord inaccessible, session limit épuisée et Gateway WebSocket bloqué.
- Render reste sain via `/health` même lorsqu'un diagnostic Discord échoue.

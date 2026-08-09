# 1.7.1

- Corrige Render `Timed Out` pendant la connexion Discord.
- Supprime le `process.exit(1)` après 20 s de Gateway Discord.
- `/health` devient un endpoint de liveness HTTP (200).
- Ajoute `/ready` pour Discord + Neon.
- Priorise IPv4 pour la connexion Discord.
- Fixe Node.js sur 22 LTS.
- Conserve les réponses différées immédiates des slash commands.

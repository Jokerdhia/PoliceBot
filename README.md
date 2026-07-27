# Police Bot Discord — Render + Neon

## Installation locale
1. Copie `.env.example` en `.env` et remplis les secrets.
2. Installe proprement les dépendances :
   ```powershell
   npm ci
   ```
3. Déploie les commandes Discord après toute modification des slash commands :
   ```powershell
   npm run deploy
   ```
4. Démarre :
   ```powershell
   npm start
   ```

## Render
- Type : Web Service
- Plan : Free
- Build Command : `npm ci`
- Start Command : `npm start`
- Health Check Path : `/health`
- Ajoute `DISCORD_TOKEN` et `DATABASE_URL` dans Environment.

## Important
Ne publie jamais `.env`, `DISCORD_TOKEN` ou `DATABASE_URL` sur GitHub.

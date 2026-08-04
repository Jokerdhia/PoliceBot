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


## Correction /ac
`/ac` ajoute uniquement **Accepted CV Police**, conserve **Citizen**, et retire **Police/Academy** s'ils étaient présents par erreur. Vérifiez que `ACCEPTED_CV_ROLE_ID` est l'identifiant du rôle Accepted CV et non celui d'Academy.

## Flux des commandes

- `/ac membre:@Utilisateur` : ajoute uniquement **Accepted CV Police**. Le rôle Citizen reste présent.
- `/pl membre:@Utilisateur` : ajoute **Police** et **Academy**, retire **Citizen** et **Accepted CV Police**, sans modifier le pseudo et sans attribuer de badge.
- Après `/pl`, le bot mentionne le membre dans `ONBOARDING_CHANNEL_ID` avec le bouton **Demander mon badge**.
- Le membre saisit un nom RP complet, par exemple `Jean Smith`.
- Le bot attribue alors un badge libre et modifie le pseudo en `[badge] Jean Smith`.


## Mise à jour 1.5.3
- Panneau et formulaire de demande de badge traduits en arabe.
- Le badge 106 est réservé et ne peut être attribué automatiquement ni via /bg.
- Le fichier .env est exclu du ZIP; utilisez .env.example ou les variables Render.

## Correction CV refusés (v1.6.0)
- `/rf` enregistre le refus dans la table PostgreSQL `rejected_cv`.
- `/unrf` supprime réellement l'enregistrement et vérifie la suppression.
- `/ac` consulte exactement la même table, sans cache local : le déblocage est immédiat.
- Après déploiement, exécuter `npm run deploy` une fois pour publier `/rf` et `/unrf`.


## Logs des refus

Ajoutez `REFUSAL_LOG_CHANNEL_ID` dans Render avec l’identifiant du salon réservé aux refus de CV. Les commandes `/rf` et `/unrf` utilisent ce salon. Si cette variable est absente, elles utilisent `KICK_LOG_CHANNEL_ID` et n’envoient plus rien dans `ACCEPTANCE_LOG_CHANNEL_ID`.


## Correctif 1.6.5
- `/pl` vérifie maintenant la table `rejected_cv`.
- Un joueur refusé ne peut plus recevoir Police/Academy tant que `/unrf` n'a pas été exécuté.
- Flux obligatoire : `/unrf` → `/ac` → `/pl`.


## Protection du salon CV Police — v1.6.7

Ajoutez sur Render :

```env
CV_POLICE_CHANNEL_ID=ID_DU_SALON_CV_POLICE
```

Le bot doit avoir les permissions **Gérer les salons**, **Gérer les messages**, **Voir le salon** et **Voir les anciens messages**.

- `/rf` retire Accepted CV Police et bloque immédiatement l’écriture, les réactions et la création de fils dans le salon CV Police.
- `/unrf` restaure les permissions héritées uniquement si le joueur n’est pas blacklisté.
- Un joueur refusé ou blacklisté qui tente d’écrire voit son message supprimé, reçoit un message privé et reste bloqué.
- Si la blacklist ne peut pas être vérifiée, le bot bloque par sécurité.

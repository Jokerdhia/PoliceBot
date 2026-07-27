# Police Department Bot — v1.1.0

Bot Discord autonome, sans connexion FiveM.

## Fonctions

- `/pl membre nom_rp`
- `/kick membre raison`
- badges uniques de **100 à 300**
- ajout automatique de **Police** et **Academy**
- retrait automatique de **Citizen** lors du recrutement
- retrait des rôles gérables et ajout de **Citizen** lors du `/kick`
- pseudo automatique : `[125] John Smith`
- restauration de l'ancien pseudo lors du retrait
- base de données JSON
- logs professionnels
- commandes réservées au rôle **Recruitment**
- impossible d'utiliser `/pl` ou `/kick` sur soi-même
- réponses privées supprimées automatiquement
- nettoyage automatique d'une ancienne entrée incohérente dans la base

## Lancer le bot sur Windows

```powershell
npm install
npm run deploy
node src/index.js
```

`npm run deploy` est obligatoire après toute modification de la structure des commandes, notamment pour rendre la raison de `/kick` obligatoire.

## Permissions du bot

Dans Discord, le bot doit avoir :

- Voir les salons
- Envoyer des messages
- Intégrer des liens
- Gérer les rôles
- Gérer les pseudos
- Utiliser les commandes d'application

Le rôle du bot doit être placé au-dessus de tous les rôles qu'il doit ajouter ou retirer.

Dans le salon de logs, autorise explicitement :

- Voir le salon
- Envoyer des messages
- Intégrer des liens

Dans le Developer Portal, active **Server Members Intent**.

## Variables `.env`

```env
DISCORD_TOKEN=TON_TOKEN_SECRET
CLIENT_ID=1531351585353891850
GUILD_ID=1528151508346994739
CITIZEN_ROLE_ID=1528151508346994741
POLICE_ROLE_ID=1528151508393398413
ACADEMY_ROLE_ID=1528151508456177753
RECRUITMENT_ROLE_ID=1528151508393398415
LOG_CHANNEL_ID=1531358531318448340
```

Ne publie jamais le fichier `.env` ni ton token Discord.

## Render

Utilise un **Background Worker** :

- Build Command : `npm install`
- Start Command : `npm start`

Ajoute toutes les variables du `.env` dans Render.

La base se trouve dans `data/officers.json`. Pour conserver les badges après les redéploiements Render, utilise un disque persistant monté sur :

```text
/opt/render/project/src/data
```

## Vérification Blacklist et salons séparés

Avant chaque `/pl`, le bot recherche la mention du joueur dans le salon Blacklist. Si la mention est trouvée, le recrutement est refusé et aucun rôle, badge ou pseudo n'est modifié.

Salons configurés :

- Blacklist : `1528151510242824405`
- Logs d'acceptation : `1531358531318448340`
- Logs de retrait `/kick` : `1531362488573235340`

Dans le salon Blacklist, le bot doit avoir :

- Voir le salon
- Voir les anciens messages

Dans les deux salons de logs, le bot doit avoir :

- Voir le salon
- Envoyer des messages
- Intégrer des liens

Dans le Discord Developer Portal, active aussi **Message Content Intent** et **Server Members Intent**.

## Commandes supplémentaires

### `/bg membre badge`
Change uniquement le badge d’un policier enregistré. Le badge doit être compris entre 100 et 300 et ne peut pas être déjà utilisé. Le pseudo Discord est mis à jour automatiquement. L’utilisateur ne peut pas modifier son propre badge.

### `/rc badge`
Recherche un policier avec son numéro de badge. Le résultat est privé, visible uniquement par la personne qui lance la commande, puis supprimé automatiquement après 5 minutes.

Après cette mise à jour, exécute obligatoirement :

```bash
npm run deploy
node src/index.js
```


## Admission automatique via Accepted CV Police

Quand le rôle `Accepted CV Police` (`1528151508346994742`) est ajouté à un membre, le bot publie un bouton dans le salon `1531389020339179621`.

Le candidat clique sur **Définir mon nom RP**, saisit son prénom et son nom, puis le bot :

- vérifie la Blacklist ;
- attribue un badge libre aléatoire entre 100 et 300 ;
- ajoute Police et Academy ;
- retire Citizen ;
- change le pseudo au format `[125] John Smith` ;
- enregistre le dossier ;
- envoie le log dans le salon d’acceptation.

Le bouton ne peut être utilisé que par le candidat concerné.

## Correction du message Accepted CV

Au démarrage, le bot vérifie maintenant tous les membres qui possèdent déjà le rôle **Accepted CV Police** et publie le formulaire s'ils ne sont pas encore enregistrés. Il continue aussi d'écouter les nouveaux ajouts du rôle en temps réel.

Le bot doit avoir dans le salon d'intégration : **Voir le salon**, **Envoyer des messages**, **Intégrer des liens** et **Voir les anciens messages**. Active aussi **Server Members Intent** dans le Discord Developer Portal.


## Render gratuit (Web Service)

Le bot démarre aussi un petit serveur HTTP sur `0.0.0.0` et le port fourni par Render.

Configuration Render :

- Type : Web Service
- Instance : Free
- Build Command : `npm install`
- Start Command : `npm start`
- Health Check Path : `/health`

Le service répond sur `/` et `/health`, ce qui évite l’erreur `No open ports detected`.


## Mise à jour /pl

La commande utilise maintenant uniquement :

```text
/pl membre:@Joueur
```

Le nom RP est pris automatiquement depuis le nom d’affichage Discord du membre. Il doit contenir un prénom et un nom, par exemple `John Smith`.

## Base de données Neon (obligatoire sur Render)

1. Crée un projet gratuit sur Neon.
2. Copie la chaîne de connexion PostgreSQL fournie par Neon.
3. Dans Render, ouvre **Environment** et ajoute :

```env
DATABASE_URL=postgresql://utilisateur:mot_de_passe@hote/neondb?sslmode=require
```

Ne mets jamais cette URL directement dans le code ou sur GitHub.
Au premier démarrage, le bot crée automatiquement la table `officers`.
Si `data/officers.json` contient déjà des policiers et que Neon est vide, ils sont importés automatiquement.

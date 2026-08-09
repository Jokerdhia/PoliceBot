# Police Bot 1.7.0 — stabilité interactions

- Accusé de réception immédiat de toutes les slash commands pour éviter « L’application ne répond plus ».
- Synchronisation automatique des slash commands au démarrage sur le serveur configuré.
- Vérification CLIENT_ID ↔ bot réellement connecté dans les logs Render.
- Timeout explicite de connexion Discord (20 s) avec message d’erreur utile.
- Endpoint /health enrichi (Discord, Neon, latence DB, dernière interaction, uptime).
- Bouton onboarding optimisé : ouverture immédiate du modal, validations lourdes au submit.
- Timeouts PostgreSQL ajoutés pour éviter les commandes bloquées indéfiniment.
- /pl : rollback plus sûr, conservation des rôles Police/Academy préexistants.
- /pl : une panne du salon de logs n’annule plus une intégration réussie.
- Logs d’erreur et diagnostics renforcés.
- Présence Discord explicite « HMPD • Recruitment ».
- Vérification syntaxique étendue à toutes les commandes et utilitaires.
- Archive nettoyée : aucun .env, token, .git, node_modules ou ancien fichier dupliqué.

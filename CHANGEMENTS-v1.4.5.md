# Correction du flux /pl

- `/pl` ajoute uniquement les rôles Police et Academy.
- `/pl` retire Citizen et Accepted CV Police.
- `/pl` ne crée aucune ligne officier dans Neon.
- `/pl` ne change jamais le pseudo Discord.
- Après les changements de rôles, le bot attend puis vérifie qu'aucun ancien mécanisme n'a attribué un badge.
- Si un badge automatique inattendu est détecté, il est supprimé et le pseudo initial est restauré.
- Le membre est ensuite tagué dans `ONBOARDING_CHANNEL_ID`.
- Le badge est créé uniquement après validation du formulaire « Demander mon badge ».

Au démarrage, les logs doivent afficher :
`Flux actif v1.4.5 : /pl ne crée jamais de badge ; seul le formulaire onboarding peut en créer un.`

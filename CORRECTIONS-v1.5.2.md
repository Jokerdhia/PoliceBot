# Corrections v1.5.2

- Empêche l'envoi simultané du panneau de badge par `/pl` et `guildMemberUpdate`.
- Recherche tous les panneaux existants du membre avant chaque envoi.
- Conserve un seul panneau et supprime automatiquement les doublons.
- Actualise l'embed et le bouton du panneau déjà existant.
- Le responsable du recrutement reste celui qui exécute `/pl`.
- `/pl` répond avec un embed privé de confirmation.
- Le retrait Police enlève les rôles gérables prévus et remet Citizen.

Le bot doit disposer de **Gérer les messages** dans le salon d'intégration afin de supprimer les anciens doublons.

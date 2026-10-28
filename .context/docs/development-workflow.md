---
type: doc
name: development-workflow
description: Verified local workflow and phase rules
category: workflow
generated: 2026-10-28
status: filled
scaffoldVersion: "2.0.0"
---

# Development Workflow

Le dossier Omni est un dépôt indépendant sur `main`, avec `origin` GitHub. Le dépôt distant était vide à l’audit et aucun changement distant n’a été intégré.

1. Vérifier `git status --short --branch` et les derniers commits avant de reprendre.
2. Lire `AUDIT.md`, la partie pertinente de `Omni_PRD.md`, puis le code/test concerné.
3. Annoncer une phase avec critères et tests; ne pas commencer la phase suivante avant validation utilisateur.
4. Implémenter une tranche réelle, exécuter ses contrôles et consigner résultats et limites.
5. Mettre à jour `CHANGELOG.md` et la documentation de phase.
6. Créer un commit dédié à la phase uniquement après validation; rapporter son hash.

Commandes existantes : `npm test`, `npm run check`, `npm start`. Aucun script build, lint ou format n’existe pour le moment.

Les clés ne doivent pas être écrites en clair. Les outils sensibles doivent exiger une décision de permission vérifiable. Ne pas répéter une opération non idempotente après interruption ou fallback. `orca/`, `Omni-Controls/`, `OmniRoute-release-v3.8.53/` et `open-fusion/` sont des projets distincts.

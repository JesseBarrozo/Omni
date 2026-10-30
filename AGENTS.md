# Instructions de travail Omni

Omni est le produit autonome de ce dossier. `Omni_PRD.md` décrit la cible; `AUDIT.md` décrit l’état réellement observé. Ne présente pas une capacité du PRD comme terminée sans intégration réelle et validation du parcours concerné.

## Phases

- Respecte les phases validées par l’utilisateur et ne commence pas la suivante avant son autorisation.
- Garde les changements et commits séparés par phase. N’écris jamais de secrets dans le dépôt ou les journaux.
- Vérifie la documentation du SDK officiel avant toute intégration fournisseur/harness.
- Les mocks sont réservés aux tests unitaires; jamais dans le chemin d’exécution produit.
- Préserve tout changement existant dans les projets voisins; ils ne font pas partie de ce dépôt.

## Commandes constatées

- `npm test` — tests unitaires Node intégrés.
- `npm run check` — vérification syntaxique Node.
- `npm start` — interface Agent interactive dans un TTY ; aide hors TTY.
- `omni gui` — GUI web locale sur le runtime partagé.
- `npm run gui:build` — typecheck TypeScript et build Vite de la GUI.
- `npm run build:all` — build du CLI et de la GUI.

Les scripts `build`, `lint`, `format` et `format:check` sont déclarés dans le manifeste actuel. Ne les rapporte comme réussis qu’après les avoir exécutés.

## Organisation

- `src/core.mjs` — classes locales de conversation, événements, routage et permissions; lire l’audit pour leurs limites.
- `src/adapters.mjs` — contrat et adaptateur mock réservé aux tests.
- `bin/omni.mjs` — commandes CLI existantes.
- `src/agent-workspace.mjs` — runtime partagé CLI/GUI, sessions, contexte, approbations et adaptateurs officiels.
- `src/workspace-server.mjs` — API loopback et événements SSE de la GUI.
- `web/` — interface React/Vite, composants shadcn/Radix et réutilisation Orca MIT.
- `test/` — tests de contrats et d’intégration locale ; validations live opt-in documentées dans `WORKSPACE.md` et `VERIFICATION.md`.
- `Omni_PRD.md`, `AUDIT.md`, `CHANGELOG.md` — exigences, état observé et historique des phases.

## Contexte partagé du harness

Ce dépôt est le harness. Le projet cartographié par défaut est le dépôt voisin `second-brain-1.4.0` ; `ATLAS_PROJECT` en change la cible.

- `scripts/atlas.mjs` génère l'atlas du projet (`atlas/` dans ce projet). Chaque fait cite `chemin:ligne`. Lire `atlas/README.md` du projet avant de nommer un fichier, une capacité, une table ou une variable d'environnement, et ouvrir la ligne citée pour confirmer. Régénérer avec `npm run atlas:generate` après un changement de capacités, de schéma, de configuration ou d'hôtes sortants.
- `.context/artifacts/` contient les plans et rapports partagés entre agents. Les ajouter avec `npm run artifacts -- add …` (voir `.context/artifacts/README.md`), jamais en copiant les fichiers à la main.
- `npm run check` vérifie les deux outils : `artifacts:check` et `atlas:check`. `atlas:check` échoue si le dépôt voisin est absent.

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

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
- `npm start` — aide du CLI actuel; pas encore de `chat` ou `run`.

Le manifeste ne déclare ni `build`, ni `lint`, ni `format`. Ne rapporte pas ces commandes comme réussies.

## Organisation

- `src/core.mjs` — classes locales de conversation, événements, routage et permissions; lire l’audit pour leurs limites.
- `src/adapters.mjs` — contrat et adaptateur mock réservé aux tests.
- `bin/omni.mjs` — commandes CLI existantes.
- `test/` — tests unitaires; pas de test d’intégration réel à ce stade.
- `Omni_PRD.md`, `AUDIT.md`, `CHANGELOG.md` — exigences, état observé et historique des phases.

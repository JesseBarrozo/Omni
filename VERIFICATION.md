# Vérification et tests à refaire

## Phase : premier harness Codex

Ce document suit les vérifications du harness `codex` via le Codex app-server officiel. Les résultats sont mis à jour après chaque exécution; les tests conditionnels ne sont pas considérés comme réussis lorsqu’ils sont ignorés.

## Parcours réel requis

- [x] `codex login status` confirme un compte local connecté.
- [x] Le test d’intégration démarre un thread app-server réel sur un dépôt temporaire et demande la création d’un fichier.
- [x] Le sandbox démarre en `read-only`; une demande d’approbation de modification de fichier apparaît avant l’écriture.
- [x] Le test n’accorde l’approbation que pour le chemin exact attendu dans le dépôt temporaire; la demande est liée au tour.
- [x] La réponse du modèle est streamée et l’historique Omni est persisté.
- [x] Le checkpoint est créé après le tour; le contrat empêche le checkpoint pendant un tour actif.
- [x] Après fermeture/réouverture de SQLite, le même thread est repris et le modèle relit le contenu créé.
- [x] Le parcours CLI interactif réel a affiché la demande d’approbation, reçu `y`, écrit le fichier, puis une nouvelle invocation CLI a repris la conversation.
- [x] Le test vérifie l’absence de secret dans l’export et qu’aucun nouveau thread Codex n’est créé lors de la reprise.
- [ ] Exercer un refus explicite dans le parcours CLI réel et vérifier son événement dans l’historique.
- [ ] Exercer en réel `Ctrl-C` pendant un tour et confirmer `turn/interrupt` sans relance automatique.
- [ ] Exercer une demande `item/commandExecution/requestApproval` et `item/permissions/requestApproval` réelle; ces chemins sont gérés, mais non validés par ce parcours.

## Tests à exécuter ou refaire

```sh
npm test
npm run lint
npm run format:check
npm run check
npm run build
OMNI_LIVE_CODEX_HARNESS_TESTS=1 node --test test/codex-harness.test.mjs
```

Le test réel crée un dépôt Git jetable, demande au vrai app-server Codex de créer un seul fichier temporaire, n’accorde la permission que pour le chemin attendu, ferme puis rouvre SQLite et reprend le thread pour relire le fichier. Il exige un compte Codex local connecté.

## Limites à suivre

- Les demandes de permission sont refusées si Omni ne dispose pas d’un TTY interactif.
- Une approbation de `item/permissions/requestApproval` restitue uniquement le profil demandé après confirmation et avec `scope: "turn"`; les élévations permanentes sont volontairement absentes.
- Les requêtes app-server inconnues sont refusées avec une erreur JSON-RPC.
- Le checkpoint Omni conserve la référence du thread Codex; il ne copie pas son état interne.
- Si un test réel échoue ou est ignoré, conserver ce document à jour et relancer les commandes listées avant d’annoncer le parcours validé.

## Résultats de cette phase

- `npm test` : réussi, 28 tests découverts, 23 réussis, 0 échec, 5 ignorés (intégrations réelles conditionnelles).
- `npm run lint` : réussi.
- `npm run format:check` : réussi.
- `npm run check` : réussi.
- `npm run build` : réussi.
- `git diff --check` : réussi.
- `OMNI_LIVE_CODEX_HARNESS_TESTS=1 node --test test/codex-harness.test.mjs` : réussi, 2/2, avec compte Codex authentifié.
- Parcours CLI interactif réel avec approbation, persistance et reprise dans un nouveau processus : réussi sur un projet temporaire.
- Le capteur Dotcontext `tests-passing` a échoué car il injecte des options Jest (`--runInBand --json`) incompatibles avec la suite native Node `node --test`; l’exécution directe `npm test` ci-dessus réussit. Ce capteur doit être corrigé/configuré pour le runner Node avant de pouvoir servir de gate.
- Parcours CLI de refus explicite, interruption réelle pendant un tour, permissions de commande/profil et tests OAuth Claude/OpenAI : non exécutés; voir la checklist ci-dessus et les tests ignorés.

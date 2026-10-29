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
OMNI_LIVE_CLAUDE_TESTS=1 node --test test/claude.test.mjs
OMNI_LIVE_HARNESS_SWAP_TESTS=1 node --test test/harness-swap.test.mjs
```

Le test réel crée un dépôt Git jetable, demande au vrai app-server Codex de créer un seul fichier temporaire, n’accorde la permission que pour le chemin attendu, ferme puis rouvre SQLite et reprend le thread pour relire le fichier. Il exige un compte Codex local connecté.

## Limites à suivre

- Les demandes de permission sont refusées si Omni ne dispose pas d’un TTY interactif.
- Une approbation de `item/permissions/requestApproval` restitue uniquement le profil demandé après confirmation et avec `scope: "turn"`; les élévations permanentes sont volontairement absentes.
- Les requêtes app-server inconnues sont refusées avec une erreur JSON-RPC.
- Le checkpoint Omni conserve la référence du thread Codex; il ne copie pas son état interne.
- Si un test réel échoue ou est ignoré, conserver ce document à jour et relancer les commandes listées avant d’annoncer le parcours validé.

## Deuxième harness : Claude Code

- [x] Connexion au compte Claude via la commande officielle `claude auth login --claudeai`; statut local confirmé `loggedIn: true`.
- [x] `OMNI_LIVE_CLAUDE_TESTS=1 node --test test/claude.test.mjs` : chat SDK streamé puis reprise du même `session_id` après fermeture et réouverture de SQLite.
- [x] Le harness utilise l’outil réel `Write` sur un fichier temporaire uniquement après approbation du callback; les événements `permission.requested` et `permission.granted` sont vérifiés.
- [x] Le test vérifie les deltas streamés, le résultat confirmé par le SDK et l’absence de secret dans l’export Omni.
- [x] `omni swap --conversation ID --harness claude` crée un checkpoint portable; un nouveau processus `omni run --conversation ID --harness claude ...` démarre le thread réel et restitue le contexte du checkpoint.
- [ ] Répéter le parcours CLI dans un TTY et refuser explicitement une permission; vérifier que le fichier n’est pas créé.
- [ ] Interrompre une exécution réelle avec `Ctrl-C`, puis reprendre sans relancer automatiquement l’outil.

## Résultats de cette phase

- `npm test` : réussi, 34 tests découverts, 27 réussis, 0 échec, 7 ignorés (intégrations réelles conditionnelles).
- `npm run lint` : réussi.
- `npm run format:check` : réussi.
- `npm run check` : réussi.
- `npm run build` : réussi.
- `npm run format` : réussi.
- `git diff --check` : réussi.
- `OMNI_LIVE_CODEX_HARNESS_TESTS=1 node --test test/codex-harness.test.mjs` : réussi, 2/2, avec compte Codex authentifié.
- Parcours CLI interactif réel avec approbation, persistance et reprise dans un nouveau processus : réussi sur un projet temporaire.
- Le capteur Dotcontext `tests-passing` a échoué car il injecte des options Jest (`--runInBand --json`) incompatibles avec la suite native Node `node --test`; l’exécution directe `npm test` ci-dessus réussit. Ce capteur doit être corrigé/configuré pour le runner Node avant de pouvoir servir de gate.
- Parcours CLI de refus explicite/interruption réelle, permissions Codex de commande/profil, OAuth OpenAI par clé et tests OAuth Codex chat distincts : non exécutés; voir les checklists ci-dessus et les tests ignorés.
- `OMNI_LIVE_CLAUDE_TESTS=1 node --test test/claude.test.mjs` : réussi, 6/6 après authentification OAuth réelle.
- `OMNI_LIVE_HARNESS_SWAP_TESTS=1 node --test test/harness-swap.test.mjs` : réussi, 6/6. Parcours réel Codex → checkpoint → Claude → lecture après reprise → nouveau thread Codex; le test séparé a exécuté `omni swap` puis `omni run` dans deux processus.
- Refus explicite dans le CLI swap/run, interruption réelle pendant une opération et permissions CLI en TTY : à refaire; les tests actuels couvrent l’approbation réelle via SDK/app-server et la reprise CLI sans TTY.
- Les événements d’outils, commandes et modifications de fichiers sont conservés dans le journal Omni pour alimenter le résumé de swap; les parcours réels Claude/Codex ont vérifié les appels d’outils et le changement de fichier.

## Phase Auto Orchestrator

- [x] `omni run --auto` interroge les vrais comptes OAuth Codex et Claude puis leurs catalogues de modèles officiels; les identifiants du journal proviennent de ces réponses.
- [x] Le routeur exclut fournisseurs/modèles désactivés, modèles non autorisés par `OMNI_AUTO_MODELS`, incompatibilités modèle/harness, capacités d’outils manquantes, confidentialité stricte non approuvée et prix inconnus/supérieurs au plafond configuré.
- [x] Le choix est déterministe et enregistre les candidats évalués, exclusions, critères, ordre, secours et explication. Les issues et latences réelles sont recherchées dans les 200 derniers résultats de toutes les conversations.
- [x] Le test réel `OMNI_LIVE_AUTO_TESTS=1 node --test test/auto-router.test.mjs` a interrogé un compte OAuth, restreint le choix à un modèle concret trouvé dans son catalogue, lancé `omni run --auto`, reçu une réponse modèle, puis vérifié la décision et l’issue `completed` dans SQLite après le sous-processus.
- [x] Les journaux du parcours réel ont été contrôlés pour l’absence de clé API/token Bearer.
- [x] Aucune relance automatique n’a lieu après le démarrage d’une tâche. Le candidat de secours est conservé dans la décision mais n’est pas exécuté après une panne, afin de ne pas rejouer un outil non idempotent.
- [ ] Le fallback après un échec de préflight avant tout effet de bord n’est pas encore implémenté; aucun fallback d’exécution post-démarrage n’est autorisé.

### Limites réelles de routage

- Le catalogue Codex/Claude peut contenir des alias tels que `default`; le routeur les expose comme entrées de catalogue, mais le test d’exécution choisit un identifiant de modèle concret pour exercer l’appel réel.
- Les adaptateurs actuels ne fournissent pas de métadonnées tarifaires vérifiées ni un indicateur d’approbation de confidentialité. `OMNI_AUTO_MAX_INPUT_PER_MILLION` exclut donc les modèles au tarif inconnu et `OMNI_AUTO_PRIVACY=strict` exclut les deux harnesses cloud.
- Capacités d’outils viennent du contrat des deux adaptateurs Omni; la disponibilité est établie par authentification et réponse du catalogue, pas par une mesure synthétique.
- Seuls Codex et Claude Code sont inclus dans le registre runtime actuel. OpenAI direct, Antigravity et Orca ne font pas partie de ce routeur.

### Commandes de validation Auto

```sh
npm test
npm run lint
npm run format:check
npm run check
npm run build
OMNI_LIVE_AUTO_TESTS=1 node --test test/auto-router.test.mjs
```

Résultats du commit Auto : `npm test` : 40 tests, 32 réussis, 0 échec, 8 intégrations conditionnelles ignorées; `npm run lint`, `npm run format:check`, `npm run check`, `npm run build` et `git diff --check` réussis. Avec `OMNI_LIVE_AUTO_TESTS=1`, le test Auto réel passe 6/6, y compris l’appel OAuth et la vérification du journal SQLite après le sous-processus CLI.

## Vérification de compatibilité Orca

- [x] Skill Orca CLI versionnée consultée; runtime local ouvert puis statut `ready`, Orca CLI/runtime 1.4.242.
- [x] `orca agent-context --json`, `orca agent launch --help` et `orca terminal create --help` confirment la distinction entre agent TUI connu et commande shell dans un terminal.
- [x] Lancement réel `orca agent launch --agent omni --worktree path:/Users/barrozo/Github/Omni-Project/Omni ...` refusé avant toute action : `invalid_argument`, `Unknown TUI agent "omni"`.
- [x] `orca worktree current --json` confirme que le dépôt Omni n’est pas enregistré comme espace Orca; aucun espace Orca n’a été créé ni modifié pour contourner cette limite.
- [x] Usage documenté comme commande Omni normale depuis un terminal appartenant déjà à un espace Orca; cela ne crée pas une session d’agent Orca native.
- [ ] Session Omni native dans la liste Agent Sessions Orca : non prise en charge par l’interface exposée; il faut un contrat d’agent externe documenté ou une évolution Orca.
- L’application Orca a été ouverte conformément au guide CLI pour satisfaire le prérequis runtime. Aucun code, réglage, enregistrement d’agent ou donnée utilisateur Orca n’a été modifié.

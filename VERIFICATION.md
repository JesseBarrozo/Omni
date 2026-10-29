# Vérification et tests à refaire

## Provider Manager et Model Registry

- [x] Migration SQLite version 2 conserve les providers, leurs états, les identifiants de modèles et les drapeaux d’activation; les préférences survivent à la réouverture de la base.
- [x] Les catalogues anciens restent présents comme indisponibles après un rafraîchissement qui ne les retourne plus; les préférences ne sont pas réinitialisées.
- [x] `providers refresh --json` dans un répertoire de données isolé a interrogé les vrais comptes OAuth : Codex connecté avec 8 modèles, Claude Code connecté avec 13 modèles; OpenAI a été rapporté déconnecté car aucune `OPENAI_API_KEY` n’était configurée.
- [x] `providers list --json`, `models list --provider codex` et `models disable --provider codex --model MODEL --auto-only` ont été exécutés sur le CLI réel.
- [x] Après désactivation Auto d’un modèle Codex réel et allowlist limitée à ce modèle, `omni run --auto` a échoué avant l’exécution avec `No compatible enabled model/harness candidate`.
- [x] Les tests unitaires couvrent la migration, la conservation des préférences, les modèles disparus et les commandes de gestion locales.
- [ ] OpenAI direct n’a pas été rafraîchi ni testé en réel : clé API absente. Aucun secret provider n’est stocké dans cette phase; les secrets restent dans les CLIs officiels ou l’environnement.
- [ ] Comptes multiples, coffre de secrets système, quotas et métadonnées de prix ne sont pas implémentés.

Validation de phase : `npm test` a découvert 45 tests (35 réussis, 0 échec, 10 intégrations opt-in ignorées); lint, format:check, check, build et diff-check réussis. `OMNI_LIVE_PROVIDER_REGISTRY_TESTS=1 node --test test/cli.test.mjs` : 3/3 réussis, y compris le parcours OAuth réel.

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
- [x] En mode Auto, Omni initialise le harness sélectionné avant d’enregistrer le prompt ou de lancer un tour; si cette initialisation échoue, il tente les candidats classés suivants et consigne `routing.fallback` avec le candidat, l’échec et la raison. Les erreurs après l’entrée dans `run()` ne déclenchent aucun secours.
- [x] Le routeur distingue une demande sans outils, une conversation Codex en sandbox lecture seule et les harnesses à outils; un candidat Claude `tools: false` est préféré à l’accès Codex lecture seule et aux harnesses mutateurs, sauf préférence fournisseur configurée. Les tâches qui requièrent des outils excluent le mode Codex lecture seule.
- [x] Le parcours réel `OMNI_LIVE_AUTO_TESTS=1` a sélectionné un modèle Codex concret, créé une conversation `codex-chat`, passé le modèle choisi à `thread/start`, streamé une vraie réponse OAuth et persisté le résultat. La clé `OPENAI_API_KEY` était absente; cette validation ne couvre pas l’API OpenAI directe.
- [x] Test réel `OMNI_LIVE_AUTO_FALLBACK_TESTS=1 node --test test/auto-router.test.mjs` : le CLI a sélectionné Codex, son exécutable harness configuré comme absent a échoué au préflight, puis Omni a appelé un vrai modèle Claude OAuth et persisté l’événement de secours ainsi qu’un seul résultat terminé; aucun deuxième prompt n’a été créé.
- [x] Exécution combinée après le changement : `OMNI_LIVE_AUTO_TESTS=1 OMNI_LIVE_AUTO_FALLBACK_TESTS=1 node --test test/auto-router.test.mjs` : 8/8 réussis, sans test ignoré; le parcours normal Auto et le fallback réel sont passés.
- [ ] Le parcours réel de fallback de préflight n’a été vérifié qu’avec Claude comme candidat de secours; vérifier Codex comme candidat de secours avec deux comptes connectés.
- Validation finale de cette phase : `npm test` (42 découverts, 33 réussis, 0 échec, 9 tests live ignorés sans opt-in), `npm run lint`, `npm run format:check`, `npm run check`, `npm run build`, `git diff --check` et les deux parcours OAuth Auto combinés (8/8) réussis.

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
OMNI_LIVE_AUTO_FALLBACK_TESTS=1 node --test test/auto-router.test.mjs
```

Résultats du commit Auto : `npm test` : 40 tests, 32 réussis, 0 échec, 8 intégrations conditionnelles ignorées; `npm run lint`, `npm run format:check`, `npm run check`, `npm run build` et `git diff --check` réussis. Avec `OMNI_LIVE_AUTO_TESTS=1`, le test Auto réel passe 6/6, y compris l’appel OAuth et la vérification du journal SQLite après le sous-processus CLI.

Résultats après le fallback de préflight : `npm test` : 41 tests, 32 réussis, 0 échec, 9 intégrations conditionnelles ignorées; lint, format:check, check, build et diff-check réussis. `OMNI_LIVE_AUTO_TESTS=1 OMNI_LIVE_AUTO_FALLBACK_TESTS=1 node --test test/auto-router.test.mjs` : 7/7 réussis, dont une vraie réponse Auto et le parcours réel Codex indisponible → Claude OAuth. Un premier contrôle d’assertion du parcours fallback avait compté un événement `session.started` de statut sans harness; le contrôle a été corrigé pour ne regarder que les événements de session qui nomment le harness, puis le parcours réel a réussi.

## Vérification de compatibilité Orca

- [x] Skill Orca CLI versionnée consultée; runtime local ouvert puis statut `ready`, Orca CLI/runtime 1.4.242.
- [x] `orca agent-context --json`, `orca agent launch --help` et `orca terminal create --help` confirment la distinction entre agent TUI connu et commande shell dans un terminal.
- [x] Lancement réel `orca agent launch --agent omni --worktree path:/Users/barrozo/Github/Omni-Project/Omni ...` refusé avant toute action : `invalid_argument`, `Unknown TUI agent "omni"`.
- [x] `orca worktree current --json` confirme que le dépôt Omni n’est pas enregistré comme espace Orca; aucun espace Orca n’a été créé ni modifié pour contourner cette limite.
- [x] Usage documenté comme commande Omni normale depuis un terminal appartenant déjà à un espace Orca; cela ne crée pas une session d’agent Orca native.
- [ ] Session Omni native dans la liste Agent Sessions Orca : non prise en charge par l’interface exposée; il faut un contrat d’agent externe documenté ou une évolution Orca.
- L’application Orca a été ouverte conformément au guide CLI pour satisfaire le prérequis runtime. Aucun code, réglage, enregistrement d’agent ou donnée utilisateur Orca n’a été modifié.

## Investigation OAuth Antigravity

- [x] Documentation officielle du CLI Antigravity consultée via Context7 : `https://antigravity.google/docs/cli/headless` et `https://antigravity.google/docs/cli/modes`.
- [x] CLI officiel `agy` 1.4.9 installé en cache local pour l’essai, sans exécuter son installateur ni modifier les réglages d’autres outils.
- [x] `agy models` a retourné le catalogue réellement disponible, dont `gemini-4-argon-medium`, les variantes Gemini 3.8 Flash, Claude Opus/Sonnet 5.5 et GPT-OSS 120B.
- [x] Exécution réelle sans variable de clé API/ADC transmise au processus : `agy -p 'Reply with ANTIGRAVITY_OMNI_READONLY_OK only. Do not inspect files.' --mode plan --output-format stream-json --model gemini-4-argon-medium --print-timeout 60s`. Le modèle a renvoyé `ANTIGRAVITY_OMNI_READONLY_OK` avec `status: SUCCESS` via l’authentification locale du CLI; le compte OAuth actif n’a pas été confirmé séparément.
- [x] Le flux `init` réel en `--mode plan` a annoncé `permission_mode: request-review` et des outils mutateurs/externes, dont `write_to_file`, `run_command`, outils navigateur, MCP et `send_message`.
- [x] La documentation officielle indique qu’en mode headless il n’existe pas de prompt interactif : les demandes de permission non accordées sont refusées en douceur, mais les lectures et écritures dans l’espace de travail actif sont autorisées par défaut. Aucune API documentée ne permet à Omni d’intercepter les demandes et de rendre une approbation ponctuelle.
- [ ] Intégration Omni Antigravity OAuth/chat/harness : non implémentée. La CLI possède une vraie authentification OAuth et le modèle répond, mais son interface headless ne permet pas à Omni de respecter son contrat d’approbation et pourrait modifier le projet sans demander l’autorisation Omni. Le mode `plan` n’a pas été considéré comme barrière de sécurité, car le flux réel déclare quand même les outils mutateurs et externes.
- [ ] Ne pas annoncer Antigravity comme fournisseur ou harness Omni utilisable tant qu’une interface officielle sans outils mutateurs ou avec callback de permission externe n’est pas disponible.

Commandes/résultats de cette investigation : `agy --help` (CLI présent), `agy models` (catalogue réel), puis appel OAuth modèle ci-dessus (réussi). Aucun secret ni contenu de credential n’a été lu ou ajouté aux logs Omni. Les docs officielles distinguent le CLI OAuth du SDK Python, dont les méthodes d’authentification documentées ne fournissent pas la connexion OAuth personnelle recherchée.

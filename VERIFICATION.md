# Vérification et tests à refaire

## OAuth OpenAI ChatGPT plan

- [x] Intégration OAuth officielle pour app open source : autorisation PKCE, callback loopback `127.0.0.1`, validation `state`, signature/issuer/audience/nonce/expiration OIDC, exigence du scope `chatgpt.tokens.use.direct`.
- [x] Tests unitaires : audience OIDC tableau, réutilisation du `client_id` et du host ID, rotation du refresh token, verrou de renouvellement concurrent, refus d’état invalide, catalogue et requête `store:false`.
- [x] L’ID token est vérifié puis abandonné; les jetons d’accès/renouvellement requis sont seuls conservés au trousseau système.
- [x] Trousseau système réel : `OMNI_LIVE_KEYRING_TESTS=1 node --test test/openai-auth.test.mjs` a écrit, relu puis supprimé un secret aléatoire; aucun secret n’a été imprimé.
- [x] Parcours CLI réel : `omni auth login openai` a terminé le flux OpenAI; `auth status --json` indique `chatgpt-oauth` sans révéler de jeton.
- [x] `providers refresh --provider openai --json` a interrogé le vrai compte et listé 8 modèles OAuth (`gpt-5.6-luna` à `gpt-6.1-terra`).
- [x] `omni run --project /tmp/omni-openai-oauth.TwV3uu --model gpt-6.1-sol` a reçu « Omni OAuth réel validé. »; une seconde invocation avec `--conversation b3f06b28-7f23-4469-b636-968e00134b42` a repris la conversation après redémarrage et a répété la réponse précédente.
- [x] `npm test` (60 tests découverts : 47 réussis, 0 échec, 13 opt-in ignorés), `npm run lint`, `npm run format:check`, `npm run check`, `npm run build`, `git diff --check` et `npm audit --omit=dev` (0 vulnérabilité) réussis.
- [ ] Limitation actuelle : un seul profil OpenAI OAuth; sur Linux, le backend est strictement Secret Service et échoue fermé s’il est absent. Le parcours de chat avec clé API reste une voie de facturation distincte et n’a pas été exécuté dans cette phase.

## Recherche Universal Chat

- [x] La recherche SQLite retrouve titres et messages persistés après redémarrage et peut limiter les résultats à un projet.
- [x] Les caractères `%` et `_` sont traités littéralement, sans wildcard SQL.
- [x] `omni conversation search --query TEXT [--project ID_OR_PATH] [--json]` a un parcours CLI couvert; les résultats donnent le type de correspondance et un extrait.
- Validation : `npm test` (52 découverts, 41 réussis, 0 échec, 11 tests live opt-in ignorés); lint, format:check, check, build et diff-check réussis.

## Consultation des outils et permissions

- [x] `ChatStore.executionEvents()` lit uniquement les types canoniques tool/permission et filtre par conversation ou projet; un couple conversation/projet incohérent est refusé.
- [x] `omni tools list` et `omni permissions list` affichent des résumés JSON/humains sans inclure les paramètres, contenus d’écriture ou chemins bruts.
- [x] Le test réel Codex app-server a effectué une écriture temporaire après approbation, repris le thread, puis interrogé les deux commandes CLI sur le journal SQLite réel; les événements d’outil et de permission accordée sont présents et le chemin du fichier n’apparaît pas dans l’affichage.
- [ ] Les tests réels d’interruption/refus CLI restent à refaire; les commandes de consultation ne modifient pas ces décisions.
- Validation de phase : `npm test` (50 tests découverts, 39 réussis, 0 échec, 11 opt-in ignorés), lint, format:check, check, build et diff-check réussis. `OMNI_LIVE_CODEX_HARNESS_TESTS=1 node --test test/codex-harness.test.mjs` : 2/2 réussis avec le compte OAuth connecté.

- [x] Ordre des migrations vérifié sur une base neuve : versions SQLite `[1, 2, 3]`.

## Harness Registry

- [x] Le registre SQLite version 3 conserve les capacités de l’adaptateur, son statut, sa disponibilité et son activation après redémarrage.
- [x] Les harnesses désactivés sont refusés par `omni run` et `omni swap`; Auto filtre le harness persistent désactivé avant toute exécution.
- [x] `OMNI_LIVE_HARNESS_REGISTRY_TESTS=1 node --test test/cli.test.mjs` : les vrais Codex app-server et Claude Agent SDK sont initialisés avec OAuth, signalés connectés/disponibles et aucune tâche n’est démarrée; le modèle Codex limité à ce harness est ensuite rejeté par Auto après sa désactivation (4 tests réussis, 1 autre intégration opt-in ignorée).
- Les capacités affichées proviennent des adapters Omni et ne garantissent pas l’accès aux permissions ou à l’état privé du harness. Aucun harness de démonstration n’est enregistré dans la CLI runtime.
- Validation globale de la phase : `npm test` (48 tests découverts, 37 réussis, 0 échec, 11 opt-in ignorés), `npm run lint`, `npm run format:check`, `npm run check`, `npm run build`, `git diff --check` réussis.

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

## CLI JSONL pour terminal d’agent (Orca niveau 1)

- [x] `omni run --json` produit un JSONL versionné (`version: 1`) sur stdout; aucune sortie humaine ne se mélange au flux.
- [x] Événements couverts : décision et fallback Auto, démarrage, deltas streamés, outils (nom seulement), permission demandée/accordée/refusée (portée ponctuelle), checkpoint, fin, interruption et erreur.
- [x] Les invites d’autorisation interactives sont dirigées vers stderr; sans TTY, les outils mutateurs restent refusés. Aucun prompt utilisateur ou contenu brut d’outil n’est sérialisé.
- [x] Les erreurs de validation sortent comme un unique événement `run.failed` et gardent le code de sortie 1; une interruption terminée normalement conserve le code 130.
- [x] Tests unitaires de l’enveloppe JSONL, CLI et sortie d’erreur structurée réussis.
- [x] `OMNI_LIVE_CLI_JSON_TESTS=1 node --test test/cli.test.mjs` : 7 réussis, 0 échec, 2 autres opt-in ignorés; un vrai tour OAuth Codex a streamé les événements JSONL, terminé, puis son historique a été relu depuis SQLite.
- [x] `OMNI_LIVE_CLI_JSON_TESTS=1 node --test --test-name-pattern="preserves partial output" test/cli.test.mjs` : 1/1 réussi; SIGINT après le premier delta, code 130, événement final `run.interrupted` et réponse partielle conservée avec statut SQLite `interrupted`.
- [ ] L’intégration CLI réelle de permission a été tentée avec Codex, mais n’a émis aucun événement `permission.requested`; l’assertion a échoué avant les contrôles de refus/fichier. Le répertoire temporaire a été supprimé. Le fixture a été corrigé pour créer le répertoire projet, mais le parcours n’a pas été relancé pour éviter de répéter automatiquement une génération pouvant demander une écriture.
- [ ] L’intégration native `orca agent launch --agent omni` reste impossible avec le contrat Orca installé : Orca rejette l’ID et ne documente pas d’enregistrement de processus externe. Le flux fonctionne comme processus CLI dans un terminal ordinaire; le test depuis un terminal géré par Orca n’a pas été exécuté.
- [ ] Le test OpenAI par clé API n’a pas été lancé; ce parcours n’est pas requis pour cette phase.
- Validation locale finale : `npm test` (67 découverts, 51 réussis, 0 échec, 16 opt-in ignorés), lint, `format:check`, `check`, build (146,5 kB), `git diff --check` et `npm audit --omit=dev` (0 vulnérabilité) réussis.

## Phase Auto Orchestrator

### Re-exécution des intégrations opt-in (2026-10-29)

- [x] `OMNI_LIVE_CODEX_TESTS=1 node --test test/codex.test.mjs` : 2/2 réussis, streaming OAuth et reprise du même thread après réouverture SQLite.
- [x] `OMNI_LIVE_CODEX_HARNESS_TESTS=1 node --test test/codex-harness.test.mjs` : 2/2 réussis, écriture temporaire après permission et reprise réelle.
- [x] `OMNI_LIVE_CLAUDE_TESTS=1 node --test test/claude.test.mjs` : 6/6 réussis, streaming/reprise et écriture temporaire autorisée.
- [x] `OMNI_LIVE_HARNESS_SWAP_TESTS=1 node --test test/harness-swap.test.mjs` : 6/6 réussis, dont Codex → Claude → Codex sur dépôt Git temporaire et CLI swap/reprise séparés.
- [x] `OMNI_LIVE_PROVIDER_REGISTRY_TESTS=1 node --test test/cli.test.mjs` et `OMNI_LIVE_HARNESS_REGISTRY_TESTS=1 node --test test/cli.test.mjs` : chaque exécution 6 réussis, 0 échec, 1 autre opt-in ignoré; catalogues providers réels et initialisation harness réelle validés.
- [x] Les tests Auto réels ont d’abord révélé une collision : Codex et OpenAI présentent les mêmes 8 identifiants et le registre indexé par ID seul écrasait le fournisseur précédent. Après correction composite fournisseur/ID : `OMNI_LIVE_AUTO_TESTS=1 node --test test/auto-router.test.mjs` et `OMNI_LIVE_AUTO_FALLBACK_TESTS=1 node --test test/auto-router.test.mjs` : chacun 8 réussis, 0 échec, 1 autre opt-in ignoré. Le premier a obtenu une vraie réponse Codex; le second a basculé après échec de préflight vers une vraie réponse Claude.
- [x] `OMNI_LIVE_KEYRING_TESTS=1 node --test test/openai-auth.test.mjs` : 7/7 réussis. `OMNI_LIVE_OPENAI_OAUTH_TESTS=1 node --test test/openai-oauth-live.test.mjs` : 1/1 réussi avec le compte ChatGPT OAuth réel.
- [ ] OpenAI API key : non exécuté, car `OPENAI_API_KEY` n’est pas configurée. Il s’agit d’une authentification distincte de ChatGPT OAuth.
- [x] `ModelRegistry` conserve deux modèles homonymes de fournisseurs différents, trie/rend les deux candidats et refuse l’activation par ID seul si cet ID est ambigu.

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
- Cette investigation initiale n'avait pas trouvé de frontière sûre pour le dossier utilisateur. La solution implémentée ci-dessous utilise le CLI uniquement dans un workspace privé Omni, sans copie ni application de fichiers au projet, et le refuse si des règles globales `allow` contournent le refus headless.

Commandes/résultats de cette investigation : `agy --help` (CLI présent), `agy models` (catalogue réel), puis appel OAuth modèle ci-dessus (réussi). Aucun secret ni contenu de credential n’a été lu ou ajouté aux logs Omni. Les docs officielles distinguent le CLI OAuth du SDK Python, dont les méthodes d’authentification documentées ne fournissent pas la connexion OAuth personnelle recherchée.

## Provider Antigravity Omni — implémenté localement, non validé par appel live

- [x] Contrat officiel confirmé : Google Antigravity CLI headless prend en charge `--input-format stream-json`, `--output-format stream-json`, `--model`, `--conversation`, `--sandbox` et expose `init`, `step_update`, `result`; docs : [headless CLI](https://antigravity.google/docs/cli/headless/) et [permissions](https://antigravity.google/docs/permissions?tab=cli).
- [x] `omni auth login antigravity` ouvre le CLI officiel en mode interactif; `omni auth status` indique uniquement si le CLI est présent. Il ne prétend pas confirmer l'état OAuth. `omni providers refresh --provider antigravity` interroge le vrai catalogue `agy models`; `omni chat --model antigravity:MODEL` utilise un modèle du catalogue Omni.
- [x] Chaque conversation tourne dans `OMNI_DATA_DIR/antigravity-workspaces/<conversation-id>` (par défaut `~/.omni/...`), dossier privé mode `0700`; le chemin du projet n'est ni fourni comme `cwd`, ni copié. Le workspace sert à confiner les éventuels outils d'édition du CLI et n'est jamais synchronisé vers le projet.
- [x] Invocation en mode `plan`, terminal sandboxé, permissions `request-review`; le flux de démarrage doit confirmer le `cwd` isolé et le mode de permission avant d'accepter la réponse. Les règles Antigravity globales `allow`, un `toolPermission` autre que `request-review`, des hooks globaux contenant des commandes, une configuration illisible, un événement inattendu ou un répertoire inattendu font échouer la demande. La vérification locale a détecté des hooks actifs dans `~/.gemini/config/hooks.json`; Antigravity chat est donc refusé sur cette machine tant qu'ils y restent.
- [x] Le prompt passe par stdin JSONL, jamais en argument de processus. Les variables d'environnement d'API key/token usuelles sont retirées; erreurs Antigravity redacted avant affichage. Une demande modèle n'est jamais répétée automatiquement.
- [x] ID de conversation Antigravity écrit dans le journal SQLite Omni au premier événement `init`, puis transmis avec `--conversation` après redémarrage; deltas et checkpoint sont persistés. SIGINT arrête le processus enfant et conserve les deltas déjà écrits par le chat runner.
- [x] Les appels d'outils sont consignés avec nom/statut seulement. Antigravity ne fournit pas de callback de permission consommable par Omni : aucun registre Harness, `omni run`, Auto, Harness Swap, ni application de ses changements au projet.
- [x] `node --test test/antigravity-cli.test.mjs` : 3 tests locaux réussis (parse catalogue, politique fail-closed, processus CLI JSONL de test pour streaming/reprise/interruption). Le processus de test est un fixture uniquement; ce résultat ne valide pas l'authentification ou le service Antigravity.
- [x] `npm test` : 72 tests découverts, 55 réussis, 0 échec, 17 intégrations live conditionnelles ignorées. `npm run lint`, `npm run format:check`, `npm run check`, `npm run build` (160,3 kB), `git diff --check` et `npm audit --omit=dev` (0 vulnérabilité) réussis.
- [x] Smoke CLI réel sans génération ni requête de catalogue : `omni auth status --json` avec un `OMNI_DATA_DIR` temporaire retourne pour Antigravity `cliInstalled: true`, `authenticated: null`.
- [ ] Appel de modèle live depuis le nouvel adaptateur Omni et reprise live après fermeture/réouverture SQLite : non exécutés conformément à la demande de ne pas tester l'API. La commande opt-in est `OMNI_LIVE_ANTIGRAVITY_TESTS=1 node --test test/antigravity-cli.test.mjs`; elle fait une première génération et une seconde demande de reprise.
- [ ] Antigravity comme harness Omni, changement Harness Swap, permissions ponctuelles d'outils Antigravity et intégration Auto : non pris en charge; absence documentée d'un callback externe d'approbation. Le provider de chat reste expérimental jusqu'au test live.

## SecretStore commun

- [x] Audit du code existant : `OpenAIAuth` utilisait `Entry` directement sous l'identité keyring `Omni OpenAI ChatGPT OAuth` / `default`; Codex, Claude Code et Antigravity délèguent leurs tokens à leurs CLIs officiels.
- [x] `src/secret-store.mjs` centralise get/set/delete via `@napi-rs/keyring` 2.1.2, valide les noms service/compte, refuse les secrets vides et remplace les erreurs natives par un message fixe sans `cause`.
- [x] Linux force `secret-service`, qui échoue si absent, plutôt que le fallback automatique keyutils non persistant décrit par le README du package. Le wrapper est MIT; les notices de composants embarqués Linux restent à vérifier avant redistribution.
- [x] `OpenAIAuth` utilise le nouveau store et garde exactement son service/compte historique; tests PKCE, refresh, réauthentification et suppression de l'ancien ID token passent avec ce contrat.
- [x] Test réel du trousseau système : `OMNI_LIVE_KEYRING_TESTS=1 node --test test/secret-store.test.mjs` — 3/3 réussis; secret aléatoire ajouté, relu et supprimé, puis absence confirmée. Aucun secret affiché.
- [x] `npm test` : 75 tests découverts, 57 réussis, 0 échec, 18 intégrations live ignorées; `npm run lint`, `npm run format:check`, `npm run check`, `npm run build` (162,0 kB), `npm audit --omit=dev` (0 vulnérabilité) et `git diff --check` réussis.
- [ ] Le trousseau a été validé sur l'OS courant seulement; macOS, Windows et Linux Secret Service doivent être exercés sur leurs runners respectifs.

## Clé API OpenAI dans le trousseau

- [x] `omni auth key set openai --stdin` lit une seule ligne bornée à 16 KiB, ne prend pas de clé en argument et n'affiche jamais sa valeur. La clé est stockée sous l'identité `Omni OpenAI API Key`, séparée des credentials OAuth.
- [x] Sélection vérifiée dans le code: OAuth ChatGPT, puis `OPENAI_API_KEY`, puis clé du trousseau. `auth status --json` ne rapporte que l'état et la source; la suppression interactive exige confirmation et le mode non interactif exige `--yes`.
- [x] Tests locaux: gestion injectée de la clé, passage au client OpenAI officiel, absence de fuite dans le statut CLI et refus des entrées malformées/arguments. Ces tests n'envoient aucune requête réseau.
- [x] `OMNI_LIVE_KEYRING_TESTS=1 node --test test/secret-store.test.mjs` : 3/3 tests réussis; écriture, lecture et suppression d'un secret temporaire avec un compte isolé du compte API par défaut.
- [x] Parcours CLI réel avec une valeur temporaire non envoyée à OpenAI : `auth key set --stdin`, `auth status --json`, puis `auth key remove --yes`; valeur absente des sorties et supprimée du trousseau à la fin.
- [ ] Aucun test d'appel modèle/catalogue ou d'authentification OpenAI API-key n'a été effectué dans cette phase. Le comportement réseau avec une clé stockée reste à valider avec un compte de test dédié.
- [ ] Les vérifications présentes ne prouvent pas encore la sélection runtime par un appel API réel; la clé API de l'utilisateur n'a pas été lue, remplacée ni supprimée pendant les tests.

## Profils OpenAI nommés

- [x] Chaque nom de profil pointe vers un credential distinct dans le trousseau; l’index persistant contient uniquement les identifiants et le nom actif.
- [x] Le profil historique `default` reste détectable avant création de l’index; OAuth et `OPENAI_API_KEY` gardent la priorité sur le profil actif.
- [x] Les commandes CLI `auth key set|list|use|remove` gèrent les profils; les sorties ne révèlent que les noms et l’état, jamais la valeur des clés.
- [x] `OMNI_LIVE_KEYRING_TESTS=1 node --test test/openai-auth.test.mjs test/cli.test.mjs test/secret-store.test.mjs` : 23 réussis, 0 échec, 5 intégrations non liées ignorées. Le test réel a créé deux profils temporaires, basculé le profil actif, listé les noms puis supprimé les deux profils.
- [x] Le parcours CLI set/list/use/status/remove a utilisé le trousseau réel avec des valeurs temporaires. Aucune requête réseau OpenAI n’a été envoyée.
- [ ] Aucun catalogue, modèle ou endpoint OpenAI n’a été appelé; les profils sont validés localement seulement.
- [x] `npm test` : 82 découverts, 62 réussis, 0 échec, 20 opt-in ignorés; lint, format, syntaxe, build, audit dépendances (0 vulnérabilité) et diff-check réussis.
## Registre d’outils MCP stdio

- [x] Dépendance `@modelcontextprotocol/sdk` 1.32.2 (MIT) vérifiée avec documentation Context7; transport utilisé : SDK TypeScript officiel `StdioClientTransport` / `Client`.
- [x] Migration SQLite v4 stocke la commande et arguments sans valeurs de secrets, le dossier, les noms de variables autorisées et les schémas découverts.
- [x] CLI `mcp add|list|tools|call|remove`; commandes de découverte et d’appel requièrent un TTY et un identifiant de conversation, demandent une approbation ponctuelle avant lancement, et refusent en mode non interactif avant démarrage du serveur.
- [x] Test d’intégration local démarre un vrai serveur fixture via le SDK officiel, découvre son outil, confirme qu’aucun démarrage n’a lieu sans callback d’approbation, puis exécute une mutation réelle après approbation. Un second test vérifie le refus CLI non interactif en découverte et appel, l’absence d’exécution et l’absence des valeurs sensibles dans le journal SQLite.
- [x] `node --test test/mcp.test.mjs`: 2/2 réussis. `npm test`: 84 découverts, 64 réussis, 0 échec, 20 opt-in ignorés. `npm run lint`, `npm run format:check`, `npm run check`, `npm run build` et `npm audit --omit=dev` (0 vulnérabilité) réussis; aucun accès modèle/OpenAI effectué.
- [ ] Parcours TTY interactif accepté et refusé non exécuté dans cette phase; refus non interactif et callback d’approbation dans le test SDK vérifiés.
- [x] `ClaudeCodeHarness` transmet les configurations stdio persistées au SDK Agent officiel, demande un accord avant chaque démarrage puis chaque appel. Les événements de permission et d’outil n’enregistrent pas les arguments/résultats MCP. Refus fail-closed des `cwd` différents du projet, car cette propriété n’existe pas dans le contrat SDK installé.
- [x] Parcours réel : `OMNI_LIVE_CLAUDE_MCP_TESTS=1 node --test --test-name-pattern='real Claude OAuth harness starts an approved MCP server and executes its tool once' test/claude.test.mjs` — Claude OAuth a demandé puis exécuté le vrai outil du serveur MCP fixture SDK et créé le marqueur une seule fois. Aucune clé API OpenAI utilisée.
- [x] `CodexHarness` transmet les serveurs stdio via la configuration native `mcp_servers` de l’app-server officiel. Il exige un accord avant le démarrage, configure `default_tools_approval_mode="prompt"`, puis relaie chaque demande native `mcpServer/elicitation/request` à Omni. Refus des placeholders de secret dans les arguments de processus; seules les variables explicitement inscrites à `--env-names` sont données au serveur. Les variables d’environnement sensibles de l’environnement Omni sont filtrées du processus app-server lorsque MCP est activé.
- [x] Test de protocole local : `node --test test/codex-harness.test.mjs test/mcp.test.mjs` couvre la réponse d’approbation Codex, la suppression des arguments MCP des événements et la configuration sans valeurs secrètes.
- [x] Parcours réel OAuth Codex : `OMNI_LIVE_CODEX_MCP_TESTS=1 node --test --test-name-pattern='real Codex OAuth app-server approves and executes a registered MCP tool once' test/codex-harness.test.mjs` — app-server Codex installé, serveur SDK MCP officiel réel, accord au démarrage et à l’appel, marqueur écrit une seule fois et aucune configuration du serveur ou argument MCP dans le journal d’événements. Aucune clé API OpenAI utilisée.
- [ ] Limite observée sur la version Codex testée : la requête d’approbation annonce `codex_approval_kind=mcp_tool_call` et le serveur, mais pas de nom d’outil accessible comme champ structuré; l’invite Omni demande donc un accord ponctuel générique pour un appel de ce serveur. Aucun appel n’est autorisé automatiquement.
- [ ] Auto n’inclut pas encore le filtre de capacité MCP dans son routage. Le parcours de Harness Swap combinant checkpoint, changement de harness et exécution d’un outil MCP n’a pas été effectué en live. Transport MCP distant non implémenté; seuls les serveurs locaux stdio sont pris en charge.

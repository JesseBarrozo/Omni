# Audit initial d’Omni

Date : 28 octobre 2026
Périmètre produit : `Omni/`
Dépôt distant : `https://github.com/JesseBarrozo/Omni` (vide au moment de l’audit)

## Conclusion

Le dossier Omni contient un petit prototype JavaScript sans dépendance, sans interface graphique et sans intégration réelle de fournisseur ou de harness. Les tests existants valident des classes locales avec `MockHarnessAdapter`; ils ne valident ni une réponse de modèle réel, ni un outil réel, ni une reprise de session après redémarrage. Le README décrit certaines classes comme des fonctions produit achevées alors que le CLI ne les utilise pas.

Le dossier initial `Omni/` avait dix fichiers. Ils ont tous été lus, y compris les points d’entrée, les tests, le manifeste, le README, le PRD et l’asset. Les répertoires voisins ont été inventoriés et leurs manifestes, licences, documentations et points d’entrée pertinents ont été examinés. Orca, OmniRoute, Open Fusion et Omni Controls sont des projets distincts, pas des modules du dépôt Omni.

## Architecture, build et entrées

| Élément | Constat |
|---|---|
| Runtime | JavaScript ESM, Node `>=20`; l’environnement d’audit utilise Node 24.14.1. |
| Dépendances Omni | Aucune dépendance runtime ou de développement dans `package.json`; aucun lockfile Omni. |
| Persistance | Fichiers JSON (`conversations.json`, `events.json`) dans `~/.omni` ou `OMNI_DATA_DIR`; pas de SQLite, migrations, stockage atomique ou chiffrement. |
| Entrée CLI | [`bin/omni.mjs`](bin/omni.mjs) : `help`, `init`, `status`, `conversation create`, `events export`. Le processus affiche l’aide et termine si aucune commande n’est donnée. |
| Exports | [`src/index.mjs`](src/index.mjs) réexporte `core.mjs` et `adapters.mjs`. |
| Tests | `node:test` dans [`test/core.test.mjs`](test/core.test.mjs), six tests unitaires. |
| Scripts | `npm test`, `npm start`, `npm run check`. Aucun script `build`, `lint` ou `format`. |
| Interface | Pas de serveur, application web, React ou Tauri dans `Omni/`. |

## Fonctions présentes et état réel

| Fonction du PRD | État observé |
|---|---|
| Projets et conversations | `ConversationManager` crée ces objets en mémoire; le CLI ne propose pas de commande projet. Les conversations sont sérialisées en JSON. |
| Universal Chat | Absent. Aucun écran, boucle de saisie, commande `chat`/`run`, ni connexion de modèle. |
| Provider Manager / comptes / secrets | Absents. Pas d’adaptateur fournisseur, d’authentification, de coffre système ou de gestion de comptes. |
| Model Registry | `ModelRegistry` conserve des objets en mémoire. Il ne découvre aucun modèle et ne vérifie aucune disponibilité. |
| Harness Registry | Le même registre contient une map de harnesses en mémoire; aucun harness réel n’est implémenté. |
| Exécution / streaming | `ExecutionCoordinator` consomme un contrat d’adaptateur. Le seul adaptateur présent est `MockHarnessAdapter`; le CLI ne crée ni n’appelle de coordinateur. |
| Outils / permissions | `PermissionManager` journalise des décisions en mémoire, mais aucun outil ne lui est relié et le coordinateur ne vérifie pas ces décisions avant l’exécution. |
| Checkpoint / reprise | Le swap crée un événement de checkpoint de démonstration. Aucun état de processus, fichier, Git ou session externe n’est capturé/restauré. La reprise après redémarrage n’est pas implémentée. |
| Harness Swap | Contrôle uniquement le statut générique `running`, puis peut créer une session cible. Il ne vérifie pas les opérations en cours, ne capture pas Git et ne reprend pas une session réelle. |
| Auto Orchestrator | Classe des objets enregistrés localement selon des valeurs statiques/heuristiques. Pas de disponibilité réseau, compte, latence observée, budget effectif ou historique de réussite. |
| Sécurité des secrets | `redactSecrets` est une fonction isolée, non branchée aux logs ou aux événements; aucun secret store n’existe. |
| Compatibilité Orca | Pas de protocole CLI Omni/agent dans le produit autonome. Les APIs Omni présentes dans Orca sont des APIs hôte, donc ne rendent pas Omni autonome. |

### Code simulé

`MockHarnessAdapter` produit le texte `Mock response for: ...` et fragmente cette chaîne en deltas. Il s’agit d’un faux moteur explicitement utilisé par les tests, pas d’une intégration. Les tests de permissions, routage et swap utilisent également des données construites en mémoire. Aucun appel réseau vers un fournisseur n’a été effectué.

## Vérifications réellement exécutées

Dans `Omni/` :

| Commande | Résultat |
|---|---|
| `npm test` | Réussite : 6 tests, 0 échec. Couverture unitaire locale uniquement. |
| `npm run check` | Réussite : contrôles syntaxiques Node sur les trois modules exécutables. |
| `node ./bin/omni.mjs init` avec `OMNI_DATA_DIR=/tmp/omni-phase1-audit-20261028` | Réussite : crée les deux fichiers JSON du dépôt local. |
| `node ./bin/omni.mjs conversation create --title 'Audit smoke'` | Réussite : crée une conversation persistée avec le projet `default`. |
| `node ./bin/omni.mjs status --json` | Réussite : retrouve une conversation après un nouveau processus. |

Ce smoke test confirme uniquement la persistance d’une métadonnée de conversation entre deux processus. Il ne teste pas un historique de chat, un fournisseur, un harness ou une reprise d’exécution.

`npm run build` ne peut pas être exécuté : aucun script `build` n’est déclaré. Les scripts `lint` et `format` sont également absents. Aucun test d’intégration réel n’existe.

## Dépôt et arborescence du workspace

À l’ouverture de l’audit, ni `/Users/barrozo/Github/Omni-Project` ni `Omni/` n’étaient un dépôt Git. Le dossier `Omni/` est maintenant initialisé sur `main` et son remote `origin` pointe vers le dépôt GitHub indiqué par l’utilisateur. La vérification Git distante n’a montré aucune référence; l’API GitHub indique un dépôt public de taille zéro, branche par défaut `main`, sans contenu à récupérer.

Dotcontext n’était pas exposé dans la session initiale et son entrée dans `~/.codex/config.toml` pointait vers `mpx`, absent du PATH, avec les arguments fusionnés. Le paquet MCP `@dotcontext/mcp` a été lancé et son handshake MCP ainsi que la liste des outils ont été vérifiés. La configuration a été corrigée vers `npx -y @dotcontext/mcp@latest`; le scaffold `.context/` a été initialisé et ses documents spécifiques au dépôt ont été remplis. `listToFill` retourne zéro fichier restant. L’état runtime et le workflow PREVC restent locaux; aucun workflow de développement n’a été démarré pendant l’audit.

Le workspace contient aussi :

| Chemin | Fichiers inventoriés (hors `node_modules` et `.git`) | Nature / licence observée | Pertinence pour Omni |
|---|---:|---|---|
| `Omni-Controls/` | 6 | Plugin Orca sans dépendances; pas de fichier de licence repéré. Dépôt Git distinct. | Panneau HTML de paramètres dépendant des APIs hôte Orca `omni.models.*`, `omni.settings.*`; ce n’est pas le chat Omni autonome. |
| `orca/` | 86 853 | Application Electron/Vite, TypeScript/React, pnpm, licence MIT. Dépôt Git distinct. | Orca contient un hôte/plugin Omni et utilise notamment `@anthropic-ai/claude-agent-sdk` (0.3.284). Son code ne doit pas être modifié ni importé comme dépendance implicite d’Omni. |
| `OmniRoute-release-v3.8.53/` | 26 633 | Projet séparé OmniRoute, Next.js/Node, pnpm, licence MIT, lockfiles et large suite de tests. | Passerelle multi-fournisseur distincte, pas un SDK ni une dépendance Omni. Toute réutilisation doit être évaluée explicitement. |
| `open-fusion/` | 171 | Projet NestJS/TypeScript, `package-lock.json`; aucune licence trouvée au niveau inspecté. | Gateway distincte utilisant Vercel AI SDK et `@openrouter/ai-sdk-provider`; contient aussi `stub-llm-generation.port.ts`. Ne pas confondre sa présence avec une intégration du produit Omni. |
| `omni-orca-plugin-v0.2.0.zip` | 9 entrées | Archive de plugin distincte. | Artéfact précompilé/snapshot; non utilisé par le CLI Omni. |

Le workspace parent est un agrégat de dossiers, pas un dépôt racine cohérent. Les seules modifications préexistantes constatées sont dans `orca/src/renderer/src/components/status-bar/icons.tsx` (ajout de `object-contain`); elles ont été préservées.

## Licences et dépendances

- Le manifeste Omni indique `UNLICENSED`; aucun fichier `LICENSE` n’existait dans le dossier audité.
- Omni Controls ne déclare pas de licence dans son manifeste et aucun fichier de licence n’a été trouvé dans son dossier.
- Orca et OmniRoute ont un fichier MIT; Open Fusion n’a pas de licence trouvée à sa racine.
- Les modules voisins ne sont pas copiés dans Omni. La compatibilité de licence et les notices doivent être résolues avant toute réutilisation de code.
- Le dépôt GitHub Omni est vide; il n’y a pas d’historique distant à fusionner. Aucun commit ou push n’a été fait pendant l’audit.

## Blocages pour une tranche verticale réelle

1. Aucun choix/intégration de fournisseur n’est présent dans Omni.
2. Aucun credential de fournisseur n’a été configuré ou vérifié dans le cadre de cet audit.
3. Aucun SDK d’API de modèle n’est installé dans Omni.
4. Aucun harness réel n’est installé ou invoqué par Omni.
5. Le CLI ne possède pas les commandes `chat`, `run`, `resume` et `status --json` ne donne que des compteurs.
6. L’interruption n’est pas connectée au processus du CLI; la reprise durable de session n’existe pas.

La phase suivante doit construire uniquement la tranche verticale Universal Chat avec un fournisseur et une persistance contrôlée, après vérification de son SDK officiel. Elle ne doit annoncer aucun parcours réel avant un appel de modèle observé avec credentials de test et test d’intégration correspondant.

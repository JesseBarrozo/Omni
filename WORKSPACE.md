# Omni Workspace

## Lancer

```sh
cd /Users/barrozo/Github/Omni-Project/Omni
npm install
npm run gui:install
npm run gui:build
npm link
omni
omni gui
```

`omni` démarre désormais le terminal en mode **Agent Codex**, pas un chat OpenAI sans outils. `omni --harness claude` choisit le SDK Claude ; `omni --harness opencode --model opencode:provider/model` choisit OpenCode. `omni agent --conversation ID` reprend une session. Le chat fournisseur reste disponible explicitement avec `omni chat --project PATH --model MODEL` ou `omni --chat`.

`omni gui` démarre le serveur local et ouvre le navigateur. Options : `--project PATH`, `--port 4318`, `--no-open`. L’application écoute uniquement sur `127.0.0.1`. C’est une GUI web locale ; cette livraison n’inclut pas d’installeur desktop natif. Les données et credentials utilisent les mêmes emplacements que la CLI (`OMNI_DATA_DIR`, SQLite, profils OAuth et credential store).

## Runtime partagé

- `AgentWorkspace` réutilise directement `CodexHarness`, `ClaudeCodeHarness`, `OpenCodeHarness` et `EveHarness`.
- Le contexte inclut les AGENTS.md du projet et de ses parents, CLAUDE.md et les entrées de documentation/workflow `.context`. Le contenu est borné, expurgé et relu à chaque tour.
- Le serveur MCP dotcontext est enregistré avec `npx -y @dotcontext/mcp@latest`. Son lancement via Codex/Claude demande une approbation, comme les autres serveurs configurés. Les demandes d’outils utilisent les callbacks natifs du Harness ; aucune permission globale n’est accordée par la GUI.
- Les demandes d’approbation ont un ID unique, une expiration et un run propriétaire. Une réponse est utilisable une seule fois. Annuler un tour refuse ses demandes encore en attente.
- Les messages, événements, IDs de session et checkpoints restent dans SQLite. Le flux SSE est une vue du runtime, pas la source de vérité.
- Les sessions ne sont pas rejouées automatiquement après une panne. Une conversation abandonnée en cours peut être récupérée explicitement depuis la GUI, ou avec `omni agent --conversation ID`.
- OpenCode conserve son intégration actuelle et ne relaie pas le registre MCP Omni. Eve exige un endpoint réel configuré. La GUI expose ces limites.

## Interface

La GUI comprend projets et conversations, recherche/commandes (⌘K ou Ctrl+K), rendu Markdown/code, moteur/modèle, streaming, arrêt, approbations, instructions de projet, configuration MCP, lecture des fichiers et diff Git. Les fichiers sont lus dans le projet enregistré, avec contrôle des liens symboliques ; les fichiers d’environnement/credentials et les dossiers de dépendances sont exclus du navigateur. Le diff compare le worktree à HEAD ; les fichiers nouveaux apparaissent dans le statut et le navigateur mais pas dans ce diff Git.

L’onglet **Fichiers** ouvre un éditeur Monaco local pour les fichiers texte UTF-8 de moins de 512 Ko. Enregistrez avec le bouton ou ⌘S/Ctrl+S ; si le fichier a changé depuis son ouverture, la sauvegarde est refusée pour préserver les deux versions. Les fichiers dont le contenu est masqué restent en lecture seule. L’onglet **Git**, séparé de l’explorateur de fichiers, permet de sélectionner ou créer une branche, indexer un fichier, créer un commit des changements indexés et consulter l’historique. Il affiche le dépôt GitHub du remote `origin` et peut charger les pull requests ouvertes avec GitHub CLI (`gh auth login`). Aucun push ou publication ne se fait automatiquement. Le changement de branche vérifie les agents actifs dans le serveur GUI ; les sessions actives dans d’autres processus ne sont pas détectées.

La navigation **Tâches** présente les tickets et pull requests ouverts, avec filtres par projet, auteur ou demande de relecture et recherche locale parmi les 50 premiers résultats par projet. « Confier à Omni » prépare une nouvelle demande sans la lancer. Les **Paramètres** regroupent l’agent par défaut (préférence du navigateur), les fournisseurs et profils de clés API du trousseau, les harnesses et serveurs MCP. Les connexions OAuth restent à effectuer dans le terminal ; Omni n’a pas encore de gestionnaire de plugins. Le serveur dotcontext est réenregistré au lancement s’il a été supprimé.

Réutilisation : composants shadcn/Radix installés depuis le registre officiel ; scroller officiel `@shadcn/react` ; bouton et utilitaire `cn` adaptés d’Orca MIT ; react-markdown/remark-gfm pour le Markdown ; SDK officiels déjà intégrés au backend. Voir `THIRD_PARTY_NOTICES.md`.

## Vérification

```sh
npm test
npm run check
npm run lint
npm run build:all
# Pendant que le serveur GUI tourne :
npm run gui:verify
# Opt-in : appels réels au modèle et MCP dans un dossier temporaire isolé
OMNI_LIVE_WORKSPACE_TESTS=1 node scripts/verify-agent-live.mjs
OMNI_LIVE_WORKSPACE_TESTS=1 node scripts/verify-gui-live.mjs
```

Le 30 octobre 2026, le runtime Codex a effectué des appels réels au MCP dotcontext et terminé sa réponse. Le parcours GUI a également exécuté un appel MCP réel après deux approbations cliquées dans le navigateur ; le streaming et la réponse persistée ont été vérifiés. Les captures se trouvent dans `.context/previews/omni-workspace-*.png`. Les parcours Claude/OpenCode/Eve dans la nouvelle GUI ne sont pas présentés comme validés en génération réelle.

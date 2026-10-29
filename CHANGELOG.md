# Changelog

## Unreleased

- Phase 1 : ajout de l’audit initial du dépôt, de l’inventaire des projets voisins et des résultats de vérification du prototype existant.
- Connexion du dossier autonome `Omni/` au dépôt GitHub `JesseBarrozo/Omni` sur la branche locale `main`.
- Initialisation de dotcontext pour `Omni/` et correction de sa commande MCP dans la configuration Codex locale.
- Phase 2 commitée (`93677d7`) : migrations SQLite versionnées, journal canonique append-only, redaction des motifs de secrets, export/import JSON et reprise après redémarrage. Le test d’appel direct OpenAI reste non exécuté faute de clé API.
- Phase OAuth Codex : intégration du Codex app-server officiel au chat Omni, streaming, conservation du thread et reprise après redémarrage validés en réel. L’authentification OAuth reste gérée par Codex; Omni n’extrait pas son jeton. Bac à sable en lecture seule.
- Phase Claude Code : ajout du SDK Agent officiel, du statut/login CLI natif, du chat streamé, du registre de modèles par session et du harness avec approbations ponctuelles, interruption et reprise par session. Validation réelle effectuée après connexion OAuth Claude : chat streamé, reprise après redémarrage SQLite et écriture d’un fichier temporaire après approbation; résultats dans `VERIFICATION.md`.
- Phase harness Codex : intégration réelle du Codex app-server officiel comme harness Omni, approbations JSON-RPC interactives (refus par défaut sans TTY), sandbox initiale lecture seule, streaming, interruption, checkpoints et reprise du thread. Test d’intégration réel et parcours CLI interactif passés; validations et limites détaillées dans `VERIFICATION.md`.
- Phase Harness Swap : `omni swap --conversation ID --harness codex|claude` crée un checkpoint persistant, inclut l’historique et l’état Git dans le contexte de reprise, bloque les tours/outils/permissions actifs et crée une session via l’adaptateur réel. Le parcours réel Codex → Claude → Codex est passé sur un projet Git temporaire; détail dans `VERIFICATION.md`.

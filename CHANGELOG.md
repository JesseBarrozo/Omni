# Changelog

## Unreleased

- Phase 1 : ajout de l’audit initial du dépôt, de l’inventaire des projets voisins et des résultats de vérification du prototype existant.
- Connexion du dossier autonome `Omni/` au dépôt GitHub `JesseBarrozo/Omni` sur la branche locale `main`.
- Initialisation de dotcontext pour `Omni/` et correction de sa commande MCP dans la configuration Codex locale.
- Phase 2 commitée (`93677d7`) : migrations SQLite versionnées, journal canonique append-only, redaction des motifs de secrets, export/import JSON et reprise après redémarrage. Le test d’appel direct OpenAI reste non exécuté faute de clé API.
- Phase OAuth Codex : intégration du Codex app-server officiel au chat Omni, streaming, conservation du thread et reprise après redémarrage validés en réel. L’authentification OAuth reste gérée par Codex; Omni n’extrait pas son jeton. Bac à sable en lecture seule.

---
type: doc
name: tooling
description: Runtime and repository commands actually available
category: tooling
generated: 2026-10-28
status: filled
scaffoldVersion: "2.0.0"
---

# Tooling

`package.json` exige Node >=20. L’audit a utilisé Node 24.14.1 et npm 11.11.0. Omni n’a aucune dépendance déclarée et aucun lockfile propre.

| Commande | Usage observé |
|---|---|
| `npm test` | Suite Node intégrée. |
| `npm run check` | Vérification syntaxique des fichiers CLI/core/adapters. |
| `npm start -- status --json` | Statut local, données dans `~/.omni` par défaut. |
| `OMNI_DATA_DIR=/tmp/omni-dev node ./bin/omni.mjs init` | Données isolées pour un smoke test local. |

Aucun build, serveur de développement, lint, format ou interface graphique n’est déclaré. Le CLI actuel accepte `init`, `status`, `conversation create` et `events export`.

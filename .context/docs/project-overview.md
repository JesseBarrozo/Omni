---
type: doc
name: project-overview
description: Product goal and audited implementation state
category: overview
generated: 2026-10-28
status: filled
scaffoldVersion: "2.0.0"
---

# Project Overview

Omni vise à fournir une conversation persistante qui peut utiliser plusieurs modèles et harnesses avec continuité, permissions et routage explicable. L’audit de départ constate un prototype Node.js sans appel fournisseur ni harness réel.

## Codebase Reference

> Source de vérité : [`../../AUDIT.md`](../../AUDIT.md) pour l’état observé et [`../../Omni_PRD.md`](../../Omni_PRD.md) pour les exigences cible.

## Quick Facts

- Racine : `Omni/`
- Runtime : Node.js >=20; version d’audit : 24.14.1
- Langage : JavaScript ESM; aucune dépendance déclarée
- CLI : [`../../bin/omni.mjs`](../../bin/omni.mjs)
- Exports : [`../../src/index.mjs`](../../src/index.mjs)
- Tests : `node:test`, [`../../test/core.test.mjs`](../../test/core.test.mjs)
- Scripts : `npm test`, `npm run check`, `npm start`

## Entry Points and Exports

Le CLI fournit `help`, `init`, `status`, `conversation create` et `events export`. `src/index.mjs` réexporte `core.mjs` et `adapters.mjs`. Les classes incluent EventStore, ConversationManager, PermissionManager, ModelRegistry, AutoRouter, SwapCoordinator, ExecutionCoordinator et MockHarnessAdapter.

## Structure and Stack

- `src/` — logique locale et contrats; aucune intégration fournisseur/harness.
- `bin/` — CLI Node.
- `test/` — tests unitaires synthétiques.
- `assets/` — logo SVG.
- `Omni_PRD.md` — exigences produit; `AUDIT.md` — limites et résultats mesurés.

Le runtime utilise les modules intégrés de Node. Il n’existe pas de build front-end, serveur ou interface graphique. Exécuter `npm test` puis `npm run check` pour reproduire les validations unitaires/syntaxiques actuelles.

---
type: doc
name: testing-strategy
description: Current test coverage and evidence required for real integrations
category: testing
generated: 2026-10-28
status: filled
scaffoldVersion: "2.0.0"
---

# Testing Strategy

`npm test` lance Node `node:test`; la suite actuelle comprend six tests unitaires dans `test/core.test.mjs`. `npm run check` exécute `node --check` sur les modules CLI/core/adapters. Aucun framework de lint/format, build ou test d’intégration n’est défini.

Les tests existants utilisent des objets en mémoire et MockHarnessAdapter. Ils vérifient une partie des contrats locaux; ils ne prouvent pas qu’un fournisseur, outil ou harness réel fonctionne.

Pour une intégration réelle, conserver des tests unitaires de normalisation/erreurs et ajouter un test d’intégration opt-in utilisant le SDK officiel avec des credentials à l’exécution. Vérifier un vrai événement/résultat, masquer les secrets, puis documenter les limites réseau/coût. Les tests de swap doivent vérifier checkpoint, fichiers, état Git, reprise et absence de répétition des actions non idempotentes.

# Omni — points à vérifier ou à reprendre

Mis à jour le 29 octobre 2026. Ce relevé complète [`VERIFICATION.md`](VERIFICATION.md), qui contient les détails et preuves historiques.

## Validations locales récentes

- Dernière suite locale : `npm test` — 130 tests découverts, 103 réussis, aucun échec, 27 scénarios opt-in ignorés.
- `npm run lint`, `npm run format:check`, `npm run check`, `npm run build`, Prettier sur la documentation et `git diff --check` réussis.
- Aucun appel de génération à un fournisseur ni test de clé API pendant ces deux phases.
- Dernier commit avant la phase en cours : `cfca4f9` (test du budget mensuel Auto contre le catalogue OpenCode).

## À reprendre seulement avec accès ou environnement approprié

### Fournisseurs et modèles

- [ ] Ne pas tester de clés API, conformément à la consigne. Les voies OpenAI API key, Anthropic API, Gemini Developer API et OpenRouter n’ont pas été validées avec un compte distant; les tests SDK locaux ne valident ni les autorisations du compte ni une réponse hébergée.
- [ ] OpenCode : valider une génération streamée, un appel d’outil, une permission déclenchée par le modèle, l’événement réel d’usage et un fallback Auto live. Les tests actuels couvrent le serveur local, le catalogue, les contrats SDK, le swap et le routage sans génération.
- [ ] Antigravity : la CLI installée ne permet pas d’isoler officiellement HOME/settings/hooks tout en réutilisant son OAuth. Sous HOME isolé, l’authentification échoue; Omni échoue fermé lorsque les hooks globaux empêchent de vérifier les permissions. Reprendre si Google documente un override sûr ou une interface d’approbation externe. Ne pas copier les credentials ou éditer la configuration utilisateur.

### Permissions, interruption et reprise

- [ ] Refaire le parcours CLI Codex avec refus interactif et vérifier l’événement `permission.denied` et l’absence de mutation.
- [ ] Refaire un `Ctrl-C` pendant une tâche Codex réelle et vérifier l’interruption sans relance.
- [ ] La requête Codex `item/permissions/requestApproval` n’a pas encore été observée dans les scénarios essayés; ne pas la simuler. Vérifier lorsqu’une tâche sûre la déclenchera.
- [ ] Le parcours CLI JSONL qui devait provoquer une demande d’outil Codex n’a pas émis `permission.requested`; le test a été laissé en attente afin de ne pas relancer aveuglément une génération. Reprendre avec un scénario modèle déterministe et contrôlé.
- [ ] Claude Code : confirmer le refus interactif et l’interruption réelle; l’écriture temporaire après approbation et la reprise sont déjà validées selon les preuves détaillées dans `VERIFICATION.md`.

### Budgets et coûts

- [ ] Le budget mensuel `OMNI_AUTO_MONTHLY_BUDGET_USD` bloque Auto lorsque les coûts USD persistés du projet atteignent le plafond. Quand il est actif, les candidats sans voie de rapport de coût ou sans prix d’entrée/sortie catalogue sont exclus, avec une erreur explicite si aucun candidat ne remplit ces conditions. Un événement de coût peut toutefois manquer au runtime et des tours déjà démarrés ou concurrents peuvent dépasser le plafond; ce n’est pas une limite de facturation garantie.
- [x] Le parcours `auto plan` avec le serveur OpenCode local réel et un budget mensuel actif a validé les prix de catalogue et l’exclusion de prix incomplets, sans générer de réponse ni appeler un fournisseur.
- [ ] Les plafonds `OMNI_AUTO_MAX_INPUT_PER_MILLION` et `OMNI_AUTO_MAX_OUTPUT_PER_MILLION` filtrent les tarifs du catalogue OpenCode. Ils ne prédisent pas le coût d’un prompt et ne constituent pas un plafond de facture.
- [ ] Les fournisseurs OAuth Codex/Claude et les APIs OpenAI/Anthropic/Gemini ne rapportent pas actuellement de coût USD dans les événements Omni; seuls les compteurs réellement présents sont conservés. Ne pas inventer les tarifs ou estimer une dépense.

### Orca, packaging et comptes

- [ ] `orca agent launch --agent omni` reste rejeté par la CLI Orca installée, qui ne documente pas l’enregistrement d’un agent tiers. Omni fonctionne comme commande CLI ordinaire; refaire le test depuis un terminal Orca géré si cet environnement est disponible. Ne pas modifier Orca.
- [x] Profils de clés API nommés disponibles pour OpenAI, OpenRouter, Anthropic API et Gemini, avec l’entrée `default` historique conservée. Les comptes OAuth multiples et le partage d’un registre unique entre OAuth et clés API restent à concevoir.
- [ ] Avant redistribution, vérifier les notices des composants natifs embarqués par `@napi-rs/keyring` sur Linux et les conditions de licence du SDK Claude Agent; voir les détails dans `AUDIT.md` et `VERIFICATION.md`.

## Commandes locales de reprise

```sh
npm test
npm run lint
npm run format:check
npm run check
npm run build
npx prettier --check Omni_PRD.md README.md CHANGELOG.md VERIFICATION.md POINTS_A_VERIFIER.md
git diff --check
```

Les parcours marqués opt-in dans les tests sont exécutés explicitement seulement quand leur compte OAuth et leur environnement sont disponibles. Aucun test de clé API n’est requis pour les contrôles locaux ci-dessus.

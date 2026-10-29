# Omni — Universal AI Harness

## Product Requirements Document (PRD)

**Version:** 1.0<br>
**Date:** 28 octobre 2026<br>
**Statut:** Document de cadrage produit et technique<br>
**Nom du produit:** Omni
**Positionnement:** Universal AI Harness

---

## État d’implémentation vérifié — 29 octobre 2026

- OpenRouter direct, Anthropic Messages API et Google Gemini Developer API disposent de providers CLI avec les SDK officiels, catalogues paginés, streaming et identifiants isolés dans le trousseau; leurs contrats ont été testés avec les SDK contre des serveurs HTTP loopback. Aucun appel live avec clé API n’a été lancé. Anthropic API est distinct de Claude Code OAuth; Gemini API est distinct d’Antigravity.
- Le faux `MockHarnessAdapter` est isolé sous `test-fixtures/` et absent des exports de production; les parcours fonctionnels réels reposent sur les harnesses Codex, Claude Code et OpenCode; la génération OpenCode reste non validée.
- Le socle chat SQLite de la phase 2 est commité (`93677d7`). Le test direct OpenAI par clé API n’a pas été exécuté.
- Le parcours Codex OAuth via l’app-server officiel a répondu en réel, streamé les deltas et repris le même thread après redémarrage de la base Omni. L’authentification reste gérée par le CLI Codex; Omni n’importe ni n’extrait son jeton. Cette intégration est en lecture seule.
- L’intégration Claude Code utilise le SDK Agent officiel, le login CLI et les callbacks de permission Omni. Après connexion OAuth Claude, les tests réels de streaming, reprise de session après redémarrage SQLite et écriture temporaire avec permission explicite ont réussi. Le test CLI interactif de refus et l’interruption réelle restent à vérifier; voir `VERIFICATION.md`.
- Le premier harness Codex app-server est intégré via l’interface JSON-RPC officielle : sandbox initiale lecture seule, streaming, interruption, checkpoint/reprise et approbations interactives. Le test réel d’écriture approuvée puis reprise après redémarrage et le parcours CLI interactif ont réussi. Les refus explicites CLI, les demandes d’approbation de commande/profil et l’interruption réelle pendant un tour restent à vérifier; voir `VERIFICATION.md`.
- Harness Swap est disponible par CLI entre Codex et Claude : checkpoint avec résumé portable/historique/Git, garde de frontière sûre et création de session par le SDK réel. Le test Codex → Claude → Codex a réussi sur un dépôt Git temporaire. `omni run --auto` route de façon déterministe parmi les candidats compatibles Codex, Claude et OpenCode à partir de leurs catalogues réels et conserve décisions/résultats. Les profils confidentialité, local-first et prix d’entrée OpenCode sont appliqués; les générations OpenCode restent non validées. La CLI Orca permet de lancer Omni comme commande ordinaire dans un terminal d’espace de travail existant, mais ne reconnaît pas Omni comme agent TUI et n’expose aucun contrat public d’enregistrement d’un agent externe dans la version vérifiée (`ORCA_COMPATIBILITY.md`). Antigravity reste un provider de chat expérimental, non un harness. Le CLI n’expose pas d’override documenté du HOME/settings/hooks : son catalogue fonctionne sous le HOME connecté (13 modèles) mais échoue sous un HOME temporaire isolé, sans authentification et sans clé API transmise; lier temporairement les seuls fichiers de session OAuth connus ne rétablit pas l’authentification. Omni refuse donc l’exécution quand les hooks globaux ne peuvent pas être neutralisés sans modifier/copier la configuration ou les credentials de l’utilisateur; aucun modèle n’a été appelé. Le gestionnaire général de secrets n'est pas validé.
- `SecretStore` encapsule le trousseau système. OpenAI OAuth conserve son entrée historique; les clés API ont des profils nommés, un profil actif persistant et un profil `default` rétrocompatible. Les profils nommés de clés API sont disponibles pour OpenAI, OpenRouter, Anthropic et Gemini avec compatibilité `default`; aucun appel OpenAI par clé API n’a été lancé lors de ces phases. Les profils OAuth multi-comptes génériques restent à concevoir. Les tokens des CLIs tiers ne sont pas importés. Auto peut bloquer un nouveau tour lorsque les coûts USD rapportés du projet atteignent le budget du mois UTC; les coûts inconnus et dépassements d’un tour déjà actif ne peuvent pas être prévenus.
- MCP local stdio : registre persistant, découverte via SDK TypeScript officiel, exécution manuelle et approbation interactive ponctuelle du démarrage serveur et des appels outils; tests réels du protocole stdio avec serveur fixture SDK et refus non interactif. La passerelle est connectée aux harnesses réels Claude Code et Codex; `omni run --auto --require-mcp SERVER[,SERVER]` filtre les candidats déterministement et arrête le run si le démarrage requis est refusé, mais conserve le fallback déterministe après une panne technique pré-tâche; les parcours CLI PTY OAuth ont confirmé l’exécution approuvée, le refus sans fallback et le fallback Codex indisponible → Claude. Le parcours live Harness Swap Codex → Claude → Codex avec serveur MCP stdio, consentements, checkpoints et marqueur non répété est validé; MCP Streamable HTTP est aussi implémenté sous HTTPS et testé contre des serveurs SDK loopback; aucun serveur public distant n’a été utilisé.
- Harness Claude MCP : les serveurs du registre local sont transmis au SDK Agent officiel après accord de lancement; chaque appel outil traverse le callback de permission et les événements n’enregistrent ni arguments ni résultats. Le tour Claude OAuth réel a démarré un serveur MCP local et écrit un fichier temporaire exactement une fois. L’API SDK ne permet pas un `cwd` distinct par serveur; ces configurations sont refusées. Intégration Codex et filtrage Auto par serveurs requis disponibles; le test live Swap Codex → Claude → Codex avec MCP est passé. Les MCP distants Streamable HTTP sont pris en charge dans les deux harnesses et validés par des parcours OAuth réels contre un serveur SDK loopback; aucun serveur MCP public distant n’a été utilisé dans ce test.

---

## 1. Résumé exécutif

Omni est une plateforme autonome d’orchestration d’agents IA. Elle fournit une conversation universelle persistante dans laquelle l’utilisateur peut choisir, remplacer ou laisser sélectionner automatiquement :

- le modèle IA utilisé ;
- le fournisseur et le compte associé ;
- le harness agentique exécutant la tâche ;
- les outils, permissions et environnements de travail disponibles.

Omni ne cherche pas à remplacer Claude Code, Codex, OpenCode ou Orca. Il les connecte, les orchestre ou les héberge lorsqu’une interface publique le permet. Son rôle est de devenir la couche indépendante qui possède la conversation, le contexte du projet, les checkpoints, les décisions de routage et l’historique d’exécution.

Les deux fonctions différenciantes sont :

1. **Harness Swap** — changer de moteur agentique dans une même conversation.
2. **Auto Orchestrator** — sélectionner automatiquement la meilleure combinaison modèle–fournisseur–harness selon la tâche, les capacités, le coût, la latence, la disponibilité et les règles de l’utilisateur.

---

## 2. Vision produit

> **One conversation. Any model. Any compatible harness.**

Omni doit permettre à un utilisateur de commencer une tâche avec Claude Code, de la poursuivre avec Codex ou OpenCode, puis de revenir au premier harness, sans perdre :

- l’objectif de la tâche ;
- les messages et décisions ;
- les fichiers modifiés ;
- les appels d’outils ;
- l’état Git ;
- les permissions accordées ou refusées ;
- les résultats et erreurs ;
- les informations nécessaires à la reprise.

L’état interne propre à chaque harness ne sera pas artificiellement fusionné. Omni conservera un journal canonique et préparera un contexte de reprise explicite pour chaque moteur.

---

## 3. Problème à résoudre

Les utilisateurs avancés de l’IA doivent aujourd’hui :

- ouvrir plusieurs applications ou terminaux ;
- gérer séparément les comptes Claude, OpenAI, Google, OpenRouter et locaux ;
- perdre du contexte lorsqu’ils changent de modèle ou d’agent ;
- choisir manuellement un modèle sans connaître ses capacités réelles ;
- dépendre de l’interface d’un fournisseur ;
- dupliquer les configurations, permissions, MCP et projets ;
- ne pas savoir précisément quels coûts et quotas sont mesurés ou estimés.

Les outils existants proposent souvent un chat multi-modèles ou un gestionnaire d’agents, mais rarement une séparation complète entre conversation, modèle, fournisseur et harness.

---

## 4. Objectifs et non-objectifs

### 4.1 Objectifs

- Créer une application autonome, indépendante d’Orca.
- Centraliser les conversations, projets, fichiers, événements et checkpoints.
- Détecter et gérer plusieurs fournisseurs, comptes et modèles.
- Intégrer les harnesses au moyen de SDK ou interfaces publiques.
- Permettre le Harness Swap aux frontières sûres d’exécution.
- Implémenter un Auto Orchestrator explicable et configurable.
- Proposer une compatibilité avec Orca comme environnement externe ou hôte.
- Conserver une architecture extensible pour les IDE, la CLI et une future version web.
- Protéger les secrets avec le trousseau système ou un coffre sécurisé.

### 4.2 Non-objectifs du MVP

- Modifier le code source de Claude Code, Codex, OpenCode ou Orca.
- Reproduire intégralement l’interface ou toutes les fonctions d’Orca.
- Garantir qu’un compte d’abonnement autorise l’usage programmatique si le fournisseur ne le documente pas.
- Fusionner l’état interne de deux harnesses incompatibles.
- Rejouer automatiquement une commande non idempotente après un échec.
- Fournir par défaut un mode dangereux sans confirmation utilisateur.
- Construire immédiatement un modèle IA propriétaire.

---

## 5. Utilisateurs cibles

### Utilisateur principal

Développeur, fondateur ou utilisateur technique qui travaille avec plusieurs agents IA et souhaite conserver une continuité de projet.

### Utilisateurs secondaires

- Équipe produit utilisant plusieurs fournisseurs IA.
- Entreprise souhaitant appliquer des règles de confidentialité et de coût.
- Utilisateur d’Orca souhaitant ajouter Omni comme agent universel.
- Utilisateur local souhaitant privilégier des modèles installés sur sa machine.

---

## 6. Principes directeurs

1. **Omni possède la conversation.** Les fournisseurs et harnesses ne sont pas propriétaires de l’historique principal.
2. **Les responsabilités sont séparées.** Compte, fournisseur, modèle, harness, session et conversation sont des entités distinctes.
3. **Les moteurs restent originaux.** Omni les intègre via leurs interfaces publiques et ne modifie pas leur code.
4. **Tout changement est explicable.** Le système indique pourquoi un modèle ou un harness a été choisi.
5. **La sécurité est explicite.** Les permissions sont accordées par projet, outil, action et durée.
6. **L’état est événementiel.** Les actions importantes produisent des événements immuables et traçables.
7. **La compatibilité est déclarée.** Directe, adaptée, expérimentale ou indisponible.

---

## 7. Périmètre fonctionnel

### 7.1 Universal Chat

Le chat est l’interface principale d’Omni.

Fonctions requises :

- conversations persistantes ;
- conversations organisées par projet ;
- recherche dans l’historique ;
- affichage du harness et du modèle actifs ;
- sélection manuelle du harness ;
- sélection manuelle du modèle et du compte ;
- mode Auto ;
- affichage des appels d’outils et de leur résultat ;
- affichage des permissions demandées ;
- interruption et reprise d’une exécution ;
- export Markdown ou JSON ;
- résumé de contexte pour la reprise par un autre harness.

### 7.2 Harness Swap

Le Harness Swap permet de changer de moteur agentique dans une conversation existante.

Modes :

- changement avant l’exécution ;
- changement après une réponse terminée ;
- changement après un checkpoint ;
- reprise d’une session précédente ;
- transfert vers un harness différent avec résumé automatique.

Le changement est bloqué ou différé lorsqu’une opération est en cours, notamment :

- écriture de fichier non terminée ;
- commande système active ;
- migration de données ;
- transaction externe non confirmée ;
- outil non idempotent.

### 7.3 Model Swap

Le Model Swap permet de changer de modèle sans changer de harness lorsque la compatibilité est disponible.

Le système doit distinguer :

- modèle natif du harness ;
- modèle accessible via adaptateur de protocole ;
- modèle compatible uniquement avec une API directe ;
- modèle indisponible pour le harness choisi.

### 7.4 Auto Orchestrator

Le mode Auto sélectionne une combinaison autorisée selon :

- type de tâche ;
- complexité estimée ;
- besoin d’outils ;
- langage ou environnement du projet ;
- capacités déclarées ;
- disponibilité du compte ;
- coût et budget ;
- latence observée ;
- historique de réussite ;
- confidentialité ;
- préférence utilisateur.

Profils initiaux :

| Profil       | Priorité                           |
| ------------ | ---------------------------------- |
| Efficiency   | coût et rapidité                   |
| Balance      | compromis qualité/coût/latence     |
| Intelligence | qualité et capacité maximale       |
| Local First  | modèles locaux avant le cloud      |
| Privacy      | exclusion de certains fournisseurs |
| Custom       | règles avancées de l’utilisateur   |

Le système affiche une explication courte : modèle choisi, harness choisi, contraintes appliquées et éventuel fallback prévu.

### 7.5 Smart Fallback

Le fallback fonctionne uniquement à une frontière sûre : fin de réponse, checkpoint ou erreur récupérable.

Cas couverts :

- quota atteint ;
- fournisseur indisponible ;
- timeout ;
- erreur de capacité ;
- modèle incompatible avec l’outil requis ;
- dépassement de contexte.

Le fallback doit conserver le journal Omni et produire un événement `routing.fallback`.

### 7.6 Provider Manager

Le gestionnaire de fournisseurs centralise :

- comptes multiples ;
- comptes par défaut ;
- clés API ;
- OAuth officiellement supporté ;
- modèles associés ;
- statut de connexion ;
- disponibilité ;
- quotas mesurés ou estimés ;
- préférences d’utilisation.

Fournisseurs initiaux à prévoir :

- Anthropic ;
- OpenAI ;
- Google ;
- OpenRouter ;
- modèles locaux compatibles ;
- fournisseurs additionnels via plugins.

### 7.7 Model Registry

Le registre conserve pour chaque modèle :

- identifiant canonique ;
- fournisseur ;
- comptes autorisés ;
- fenêtre de contexte ;
- modalités de raisonnement ;
- entrée texte, image, audio ou fichier ;
- appels d’outils ;
- streaming ;
- coût connu ou estimé ;
- disponibilité ;
- activation globale ;
- activation pour le mode Auto.

L’utilisateur peut désactiver un modèle ou un fournisseur sans supprimer ses identifiants.

### 7.8 Harness Registry

Le registre des harnesses décrit :

- nom et version ;
- méthode d’intégration ;
- SDK utilisé ;
- capacités ;
- modèles compatibles ;
- outils exposés ;
- permissions ;
- sessions persistantes ;
- reprise ;
- statut local ;
- niveau de compatibilité.

Intégrations prévues :

1. OpenCode ;
2. Codex ;
3. Claude Code / Claude Agent SDK ;
4. Omni comme agent CLI dans Orca ;
5. autres moteurs via adaptateurs.

### 7.9 Agent Registry et compatibilité Orca

Omni doit pouvoir fonctionner :

- en application autonome ;
- comme agent CLI lancé par Orca ;
- via un protocole structuré dans une future intégration native Orca.

La compatibilité Orca doit d’abord reposer sur un contrat stable, indépendant de l’interface d’Orca : événements, entrées, sorties, permissions, métriques et checkpoints.

Les fonctionnalités d’Orca pourront être reprises seulement lorsqu’elles sont légalement et techniquement extractibles : Git, worktrees, statistiques, intégrations GitHub/GitLab, terminal, MCP et gestion des agents.

---

## 8. Architecture fonctionnelle

```text
Interface Omni Desktop / CLI / Orca
              |
        Universal Chat
              |
      Omni Orchestration Core
  Session Manager · Auto Router
  Harness Swap · Smart Fallback
              |
       Adapter Runtime Layer
  Harness Adapters · Model Adapters
  Provider Adapters · MCP Bridge
              |
      Harnesses et fournisseurs
 OpenCode · Codex · Claude Code
 OpenAI · Anthropic · Google · Local
```

### Composants principaux

#### `ConversationManager`

Possède l’historique canonique, les projets, les messages, les événements et les résumés.

#### `SessionManager`

Associe une conversation Omni à une ou plusieurs sessions propres aux harnesses.

#### `HarnessAdapter`

Interface commune pour créer, reprendre, exécuter, interrompre et inspecter une session.

#### `ModelAdapter`

Décrit les capacités d’un modèle et normalise son streaming, ses erreurs et ses métadonnées.

#### `ProviderAccountManager`

Gère les connexions, secrets, comptes, statuts et limites connues.

#### `AutoRouter`

Filtre, classe et sélectionne les combinaisons compatibles.

#### `PermissionManager`

Contrôle les actions sensibles et conserve les décisions.

#### `EventStore`

Enregistre le journal d’événements canonique et les checkpoints.

#### `UsageCollector`

Collecte tokens, durée, coûts et erreurs en séparant les mesures vérifiées des estimations.

---

## 9. Contrats techniques initiaux

```ts
interface HarnessAdapter {
  id: string;
  version?: string;
  capabilities(): Promise<HarnessCapabilities>;
  initialize(): Promise<void>;
  createSession(input: CreateSessionInput): Promise<HarnessSessionRef>;
  resumeSession(ref: HarnessSessionRef): Promise<void>;
  run(input: HarnessRunInput): AsyncIterable<OmniEvent>;
  interrupt(sessionId: string): Promise<void>;
  checkpoint(sessionId: string): Promise<Checkpoint>;
  dispose(): Promise<void>;
}

interface ModelDescriptor {
  id: string;
  providerId: string;
  contextWindow?: number;
  capabilities: ModelCapabilities;
  pricing?: PricingDescriptor;
  enabled: boolean;
  enabledForAuto: boolean;
}

interface AutoRouter {
  analyze(input: RoutingInput): Promise<TaskProfile>;
  candidates(input: RoutingInput): Promise<RoutingCandidate[]>;
  select(input: RoutingInput): Promise<RoutingDecision>;
}
```

### Événements obligatoires

- `message.created`
- `message.delta`
- `message.completed`
- `tool.started`
- `tool.completed`
- `tool.failed`
- `permission.requested`
- `permission.granted`
- `permission.denied`
- `model.changed`
- `harness.changed`
- `routing.decision`
- `routing.fallback`
- `usage.updated`
- `file.changed`
- `command.started`
- `command.completed`
- `session.checkpointed`
- `session.interrupted`
- `session.completed`
- `session.failed`

---

## 10. Modèle de données

Entités principales :

- `Project`
- `Conversation`
- `ConversationEvent`
- `Message`
- `Provider`
- `ProviderAccount`
- `Model`
- `Harness`
- `HarnessSession`
- `Compatibility`
- `RoutingPolicy`
- `RoutingDecision`
- `Tool`
- `PermissionDecision`
- `Checkpoint`
- `UsageRecord`
- `Workspace`
- `GitState`

Relations essentielles :

- une conversation appartient à un projet ;
- une conversation contient plusieurs événements ;
- une conversation peut avoir plusieurs `HarnessSession` ;
- un compte appartient à un fournisseur ;
- un modèle peut être accessible par plusieurs comptes ;
- un modèle peut être compatible avec plusieurs harnesses ;
- chaque décision de routage référence les candidats évalués ;
- chaque opération sensible référence une permission et un checkpoint.

SQLite est recommandé pour le MVP local, avec une couche d’accès permettant une migration ultérieure vers PostgreSQL ou Supabase.

---

## 11. Flux principaux

### 11.1 Nouvelle conversation

1. L’utilisateur sélectionne un projet.
2. Omni charge les fournisseurs, comptes, modèles et harnesses disponibles.
3. L’utilisateur choisit un harness, un modèle ou Auto.
4. Omni crée la conversation et le premier checkpoint.
5. Le moteur exécute la demande.
6. Les événements sont enregistrés en temps réel.

### 11.2 Harness Swap

1. L’utilisateur demande un changement.
2. Omni vérifie qu’aucune opération dangereuse n’est active.
3. Omni crée un checkpoint.
4. Omni génère un résumé de reprise.
5. Le nouvel harness est initialisé.
6. Le contexte, l’état Git et les tâches restantes sont transmis.
7. Le nouvel événement `harness.changed` est enregistré.

### 11.3 Mode Auto

1. Omni analyse la demande.
2. Il élimine les modèles désactivés ou incompatibles.
3. Il applique les règles de confidentialité et de budget.
4. Il classe les candidats.
5. Il sélectionne une combinaison.
6. Il explique la décision.
7. Il mesure le résultat pour améliorer les décisions futures.

---

## 12. Sécurité et confidentialité

- Stockage des secrets dans le trousseau macOS ou un coffre sécurisé.
- Aucun secret transmis à un harness ou à Orca sans nécessité.
- Permissions par projet et par outil.
- Confirmation pour exécution de commandes, écritures sensibles, suppression et réseau.
- Journal des décisions de permission.
- Mode Privacy permettant d’exclure certains fournisseurs.
- Masquage des secrets dans les logs.
- Chiffrement des données locales sensibles.
- Expiration configurable des autorisations.
- Aucune récupération non autorisée de cookies ou de sessions navigateur.

Les accès à des abonnements, OAuth ou APIs devront respecter les conditions officielles de chaque fournisseur.

---

## 13. Interface utilisateur

### Chat

- barre de conversation ;
- sélecteur Harness ;
- sélecteur Modèle ;
- sélecteur Compte ;
- mode Auto ;
- indicateur de routage ;
- panneau d’événements et d’outils ;
- bouton interruption ;
- bouton checkpoint ;
- panneau de reprise.

### Paramètres — Modèles disponibles et Auto

La section doit permettre :

- d’activer ou désactiver un modèle ;
- d’autoriser ou exclure un modèle du mode Auto ;
- d’activer ou désactiver un fournisseur ;
- de choisir un compte par défaut ;
- de consulter la compatibilité avec chaque harness ;
- de voir les quotas et limites connues ;
- de définir les préférences de routage.

### Routage explicable

Chaque réponse Auto peut afficher :

```text
Mode Auto
Harness : OpenCode
Modèle : Gemini X
Raison : tâche de débogage, outils requis, coût acceptable
Fallback : GPT Y si quota ou timeout
```

---

## 14. Stack technique recommandée

- **Application desktop :** Tauri + React + TypeScript.
- **Cœur :** TypeScript.
- **Persistance MVP :** SQLite.
- **Validation :** tests unitaires, intégration et scénarios d’exécution réels.
- **Communication interne :** événements typés et JSON versionné.
- **CLI :** interface `omni` partageant le même cœur.
- **Plugins :** adaptateurs isolés pour fournisseurs et harnesses.
- **MCP :** registre d’outils commun avec filtrage par projet.
- **Git :** inspection de l’état, checkpoints et worktrees en phase ultérieure.

Le runtime doit rester découplé de l’interface afin de permettre une version web ou distante ultérieure.

---

## 15. Roadmap

### Phase 0 — Audit et extraction

- auditer le fork Orca ;
- identifier les composants réutilisables ;
- vérifier les licences et dépendances ;
- isoler la découverte des fournisseurs, modèles et agents ;
- définir les contrats Omni.

### MVP 1 — Omni Core

- application autonome ;
- Universal Chat ;
- projets et conversations ;
- SQLite ;
- registre des modèles ;
- sélection manuelle d’un fournisseur et d’un modèle ;
- journal d’événements ;
- permissions de base.

### MVP 2 — Première intégration harness

- OpenCode ou autre moteur offrant une intégration embarquable ;
- streaming ;
- appels d’outils ;
- sessions ;
- checkpoints ;
- reprise.

### V1 — Harness Swap

- deuxième harness ;
- résumé de transfert ;
- compatibilité déclarée ;
- reprise contrôlée ;
- tests de non-répétition des outils.

### V1.5 — Auto Orchestrator

- mode Auto ;
- profils Efficiency, Balance et Intelligence ;
- activation/désactivation des modèles ;
- sélection de compte ;
- explication du routage ;
- Smart Fallback.

### V2 — Compatibilité Orca et fonctionnalités avancées

- agent CLI Omni dans Orca ;
- événements structurés ;
- GitHub/GitLab ;
- worktrees ;
- statistiques d’usage ;
- MCP et skills ;
- terminal intégré.

### V3 — Orchestration avancée

- sous-agents ;
- exécution multi-harness ;
- évaluations automatiques ;
- optimisation fondée sur les résultats ;
- version web ou accès distant ;
- plugins communautaires.

---

## 16. Critères d’acceptation du MVP

Le MVP est accepté si :

1. Omni fonctionne sans Orca installé.
2. Un utilisateur peut créer un projet et une conversation persistante.
3. Les modèles et comptes activés apparaissent dans le chat.
4. Un modèle peut être désactivé globalement ou pour Auto.
5. Un fournisseur peut être désactivé.
6. Un harness réel peut exécuter une tâche avec streaming.
7. Les appels d’outils sont visibles et journalisés.
8. Les permissions sensibles nécessitent une confirmation.
9. La conversation peut être interrompue et reprise.
10. Les événements peuvent être exportés.
11. Aucun secret n’apparaît dans les logs.
12. Les coûts mesurés sont distingués des estimations.

## 17. Critères d’acceptation du Harness Swap

- la conversation Omni reste inchangée ;
- un checkpoint est créé avant le changement ;
- les fichiers modifiés sont détectés ;
- l’état Git est capturé ;
- le nouvel harness reçoit un résumé exploitable ;
- une opération active ne peut pas être rejouée par erreur ;
- l’utilisateur peut revenir à la session précédente ;
- le système expose les limites du transfert.

## 18. Risques et réponses

| Risque                              | Réponse                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- |
| SDK non réellement embarquable      | isoler l’adaptateur et documenter le mode d’exécution                   |
| incompatibilité de protocole        | utiliser un adaptateur officiel ou déclarer la combinaison indisponible |
| quotas d’abonnement non vérifiables | distinguer mesure, estimation et inconnue                               |
| perte de contexte au swap           | journal canonique, résumé et checkpoints                                |
| répétition d’actions                | événements idempotents et frontières sûres                              |
| dépendance à Orca                   | contrat CLI/protocole indépendant                                       |
| évolution des APIs                  | versions d’adaptateurs et tests de compatibilité                        |
| fuite de secrets                    | trousseau système, logs filtrés et permissions minimales                |
| complexité excessive du routeur     | règles déterministes d’abord, apprentissage ensuite                     |

---

## 19. Indicateurs de succès

### Produit

- temps nécessaire pour changer de harness ;
- taux de reprise réussie ;
- conversations terminées sans perte de contexte ;
- nombre de fournisseurs et modèles connectés ;
- fréquence d’utilisation du mode Auto.

### Technique

- taux d’erreur par adaptateur ;
- latence jusqu’au premier token ;
- taux de succès des outils ;
- taux de fallback réussi ;
- nombre d’actions rejouées par erreur ; objectif : zéro ;
- couverture des tests de contrat.

### Économie

- coût moyen par tâche ;
- précision des estimations de coût ;
- économies réalisées par le routage ;
- respect des budgets utilisateur.

---

## 20. Décisions à prendre avant le développement

1. Confirmer le premier harness intégré : OpenCode, Codex ou Claude Agent SDK.
2. Choisir le périmètre exact de réutilisation du fork Orca.
3. Définir la première plateforme cible : macOS uniquement ou macOS/Linux.
4. Déterminer si Omni doit stocker les projets localement uniquement au MVP.
5. Définir la politique de compatibilité des comptes d’abonnement.
6. Choisir le format public du protocole Omni Agent Protocol.
7. Déterminer si la compatibilité Orca CLI entre dans le MVP ou la V2.

---

## 21. Conclusion

Omni doit être conçu comme un **Universal AI Harness**, et non comme un fork d’Orca ou un simple client multi-LLM.

Son avantage stratégique repose sur une séparation nette :

- Omni possède la conversation, le contexte et l’orchestration ;
- les fournisseurs possèdent les modèles et les comptes ;
- les harnesses fournissent les boucles agentiques et les outils ;
- Orca devient un environnement compatible, mais non obligatoire.

Le premier objectif concret est de prouver qu’une conversation Omni peut être exécutée par un harness, checkpointée, reprise par un autre moteur, puis restaurée sans perte d’historique ni répétition dangereuse d’actions. Une fois ce socle validé, Harness Swap et Auto Orchestrator pourront devenir les fonctions centrales différenciantes du produit.

---

## 22. Plan d’implémentation complet

### 22.1 Stratégie générale

Le développement doit suivre une progression verticale : chaque phase doit produire une capacité utilisable et testable, plutôt que construire d’abord une infrastructure abstraite trop large.

L’ordre recommandé est :

1. sécuriser le périmètre et auditer Orca ;
2. créer Omni Core indépendant ;
3. créer le modèle de données et le journal d’événements ;
4. intégrer un premier fournisseur et un premier harness ;
5. rendre Universal Chat utilisable ;
6. ajouter les comptes et la découverte des modèles ;
7. implémenter Harness Swap ;
8. ajouter Auto Orchestrator et Smart Fallback ;
9. intégrer Omni dans Orca via la CLI ;
10. ajouter les fonctions P1 et l’intégration structurée.

Chaque adaptateur doit être développé derrière un contrat stable afin qu’un changement de fournisseur ne modifie pas le cœur du produit.

### 22.2 Phase 0 — Cadrage, audit et dépôt autonome

**Objectif :** établir une base juridique, technique et organisationnelle indépendante d’Orca.

#### Travaux

- créer le dépôt `Omni` ;
- choisir la licence du projet ;
- documenter les licences d’Orca et de ses dépendances ;
- créer un dossier `third-party-notices` ;
- récupérer uniquement les modules dont la licence et l’architecture permettent la réutilisation ;
- auditer le fork Orca ;
- classer chaque module : `reuse`, `extract`, `integrate`, `replace`, `defer` ;
- identifier les dépendances à l’interface, à la base de données et aux services d’Orca ;
- définir les conventions de code, branches, commits et revue ;
- mettre en place CI, lint, formatage et tests.

#### Livrables

- dépôt Omni initial ;
- matrice d’audit Orca ;
- inventaire des licences ;
- architecture cible ;
- ADR-001 : indépendance d’Orca ;
- ADR-002 : journal canonique d’événements ;
- ADR-003 : stratégie Tauri, React et TypeScript.

#### Critères de sortie

- Omni peut être installé et lancé sans Orca ;
- aucune importation directe de module interne Orca n’existe dans Omni Core ;
- les composants réutilisés sont identifiés et accompagnés de leurs notices ;
- le pipeline CI exécute les tests de base.

### 22.3 Phase 1 — Fondation du monorepo

**Objectif :** préparer une structure permettant de partager le cœur entre Desktop, CLI et intégration Orca.

#### Structure proposée

```text
omni/
├── apps/
│   ├── desktop/
│   └── cli/
├── packages/
│   ├── core/
│   ├── contracts/
│   ├── database/
│   ├── events/
│   ├── permissions/
│   ├── routing/
│   ├── providers/
│   ├── models/
│   ├── harnesses/
│   ├── workspace/
│   └── ui/
├── adapters/
│   ├── providers/
│   └── harnesses/
├── integrations/
│   └── orca/
├── docs/
└── third-party-notices/
```

#### Travaux

- initialiser TypeScript strict ;
- définir les alias de packages ;
- ajouter validation de schémas avec Zod ou équivalent ;
- définir les erreurs typées ;
- définir la sérialisation JSON versionnée ;
- ajouter les logs structurés ;
- préparer l’exécution locale et les tests d’intégration.

#### Critères de sortie

- `npm run test`, `npm run lint` et `npm run build` fonctionnent ;
- Desktop et CLI utilisent le même package `core` ;
- aucun secret n’est écrit dans le dépôt.

### 22.4 Phase 2 — Persistance et journal canonique

**Objectif :** faire d’Omni le propriétaire de l’état de conversation.

#### Travaux

- créer le schéma SQLite ;
- créer les migrations ;
- implémenter `ProjectRepository` ;
- implémenter `ConversationRepository` ;
- implémenter `EventRepository` ;
- implémenter `CheckpointRepository` ;
- ajouter index et recherche dans l’historique ;
- définir l’identifiant de corrélation pour chaque exécution ;
- rendre les événements append-only ;
- ajouter export/import JSON ;
- définir la politique de rétention et d’archivage.

#### Schéma minimum

```text
projects
conversations
conversation_events
messages
harnesses
harness_sessions
providers
provider_accounts
models
compatibilities
routing_decisions
checkpoints
permission_decisions
usage_records
workspace_snapshots
```

#### Critères de sortie

- une conversation survit au redémarrage d’Omni ;
- chaque message, outil, permission et changement de modèle est persisté ;
- un checkpoint peut être créé et restauré ;
- l’export JSON permet de reconstruire une conversation.

### 22.5 Phase 3 — Gestion des secrets et permissions

**Objectif :** sécuriser les comptes et les opérations locales avant l’intégration de vrais harnesses.

#### Travaux

- intégrer le trousseau macOS ;
- prévoir une abstraction pour Linux et Windows ;
- créer `SecretStore` ;
- créer `PermissionManager` ;
- définir les niveaux `read`, `write`, `execute`, `network`, `destructive` ;
- demander confirmation pour les actions sensibles ;
- enregistrer les décisions ;
- ajouter expiration et révocation ;
- filtrer les secrets dans les logs et les événements exportés.

#### Règle de sécurité

Les options équivalentes à `--dangerously-skip-permissions` ou `--yolo` ne doivent jamais être le comportement par défaut. Un mode avancé peut exister, mais doit être explicitement activé par projet et clairement signalé.

#### Critères de sortie

- un secret n’apparaît jamais en clair dans SQLite ou les logs ;
- une commande sensible est bloquée sans permission ;
- une permission révoquée est immédiatement respectée ;
- les tests couvrent les tentatives de contournement basiques.

### 22.6 Phase 4 — Provider Manager et Model Registry

**Objectif :** reproduire les fonctions utiles d’Orca de découverte et de gestion des modèles, sans coupler les comptes aux harnesses.

#### Travaux

- définir `ProviderAdapter` ;
- implémenter le registre des fournisseurs ;
- implémenter les comptes multiples ;
- ajouter statut connecté, expiré, indisponible ou inconnu ;
- créer la découverte des modèles ;
- normaliser les identifiants de modèles ;
- gérer activation globale et activation pour Auto ;
- ajouter la matrice de capacités ;
- distinguer accès détecté, abonnement actif et accès programmatique autorisé ;
- collecter les limites connues ;
- ajouter les comptes locaux ou API compatibles.

#### Premier périmètre conseillé

1. OpenAI ;
2. Anthropic ;
3. Google ;
4. OpenRouter ;
5. un fournisseur local compatible.

#### Critères de sortie

- l’utilisateur voit les comptes et modèles disponibles ;
- il peut désactiver un fournisseur ou modèle ;
- un modèle désactivé ne peut pas être sélectionné par Auto ;
- les comptes sont utilisables indépendamment du harness.

### 22.7 Phase 5 — Harness Registry et premier adaptateur

**Objectif :** exécuter une vraie tâche via un moteur agentique tout en conservant le contrôle d’Omni.

#### Sélection du premier harness

Le choix final doit être confirmé après audit des SDK. Le premier harness doit être celui qui offre le meilleur compromis entre :

- intégration publique ;
- streaming ;
- outils ;
- sessions ;
- permissions ;
- exécution locale ;
- tests reproductibles.

OpenCode est un candidat prioritaire pour valider une intégration embarquée. Codex et Claude Agent SDK viennent ensuite selon les contraintes de leur mode d’exécution.

#### Travaux

- définir `HarnessAdapter` ;
- créer le registre des harnesses ;
- implémenter `initialize`, `createSession`, `run`, `interrupt` et `checkpoint` ;
- normaliser les événements ;
- relier les outils du harness au `PermissionManager` ;
- journaliser les tokens, durées et erreurs ;
- tester interruption et reprise ;
- documenter les limites propres au moteur.

#### Critères de sortie

- Omni lance une tâche réelle ;
- les tokens apparaissent en streaming ;
- les outils et permissions sont visibles ;
- l’utilisateur peut interrompre puis reprendre ;
- le harness n’écrit pas directement dans l’historique canonique sans passer par Omni.

### 22.8 Phase 6 — Universal Chat et interface desktop

**Objectif :** rendre le socle utilisable quotidiennement.

#### Écrans

- liste des projets ;
- liste des conversations ;
- Universal Chat ;
- panneau d’événements ;
- paramètres des fournisseurs ;
- section « Modèles disponibles et Auto » ;
- registre des harnesses ;
- usage et coûts ;
- permissions et sécurité.

#### Travaux

- intégrer les sélecteurs Harness, Modèle et Compte ;
- intégrer le mode Auto même avant son routage avancé ;
- afficher le statut de connexion ;
- afficher le streaming ;
- afficher les outils ;
- afficher les demandes de permission ;
- ajouter recherche et navigation historique ;
- ajouter interruption, reprise et export.

#### Critères de sortie

- une conversation complète est utilisable sans terminal ;
- l’utilisateur comprend quel harness et quel modèle sont actifs ;
- les erreurs d’authentification sont compréhensibles ;
- un modèle désactivé disparaît des sélections concernées.

### 22.9 Phase 7 — Harness Swap

**Objectif :** valider la fonction centrale d’Omni.

#### Travaux

- implémenter `SwapCoordinator` ;
- définir les frontières sûres ;
- détecter les opérations en cours ;
- créer automatiquement un checkpoint ;
- capturer les fichiers modifiés ;
- capturer l’état Git ;
- générer un résumé de reprise ;
- ouvrir la session du nouvel harness ;
- transmettre objectif, décisions, fichiers, erreurs et tâches restantes ;
- conserver la session précédente ;
- permettre le retour au harness antérieur ;
- afficher les limites du transfert.

#### Format du résumé de reprise

```text
Objectif
État actuel
Décisions prises
Fichiers modifiés
Tests exécutés
Commandes exécutées
Erreurs connues
Tâches restantes
Permissions actives
Dernier checkpoint
```

#### Critères de sortie

- OpenCode → Codex ou Claude → Codex fonctionne sur un projet de test ;
- aucune action terminée n’est rejouée automatiquement ;
- le nouvel harness comprend l’état du projet ;
- le retour au premier harness est possible ;
- les événements de swap sont exportables.

### 22.10 Phase 8 — Auto Orchestrator

**Objectif :** automatiser la sélection sans introduire immédiatement un routeur opaque fondé sur un LLM.

#### Version 1 du routeur

Le routeur doit être déterministe et basé sur des règles :

1. analyser le type de tâche ;
2. identifier les capacités requises ;
3. filtrer les modèles et comptes autorisés ;
4. filtrer les harnesses compatibles ;
5. appliquer confidentialité et budget ;
6. classer coût, latence et qualité observée ;
7. choisir le meilleur candidat ;
8. expliquer la décision.

#### Travaux

- créer `TaskAnalyzer` ;
- créer `CapabilityMatcher` ;
- créer `RoutingPolicy` ;
- créer `CandidateScorer` ;
- créer `RoutingDecision` ;
- implémenter profils Efficiency, Balance et Intelligence ;
- implémenter activation/désactivation Auto ;
- ajouter budget mensuel ;
- ajouter Privacy Mode ;
- ajouter Provider Priority ;
- ajouter Explain Routing.

#### Critères de sortie

- Auto ne sélectionne jamais un compte désactivé ;
- Auto respecte la confidentialité et le budget ;
- chaque décision est explicable ;
- le mode manuel reste toujours disponible ;
- un fallback peut être défini avant l’exécution.

### 22.11 Phase 9 — Smart Fallback et observabilité

**Objectif :** maintenir la continuité en cas de quota, erreur ou indisponibilité.

#### Travaux

- classifier les erreurs récupérables ;
- définir les frontières de fallback ;
- interdire le fallback pendant une action non idempotente ;
- créer la chaîne de candidats ;
- conserver la décision initiale et le motif du fallback ;
- mesurer le résultat après basculement ;
- distinguer usage réel et usage estimé ;
- créer tableau tokens, durée, coûts et cache ;
- ajouter télémétrie locale désactivable.

#### Critères de sortie

- un quota atteint peut déclencher un autre candidat ;
- une tâche échoue proprement si aucun candidat sûr n’existe ;
- aucune commande dangereuse n’est relancée automatiquement ;
- les statistiques indiquent leur niveau de fiabilité.

### 22.12 Phase 10 — Intégration Orca niveau 1

**Objectif :** rendre Omni utilisable comme agent CLI dans Orca sans rendre Omni dépendant d’Orca.

#### Interface CLI proposée

```bash
omni init
omni providers list
omni models list
omni harnesses list
omni chat
omni run --project ./mon-projet
omni resume <session-id>
omni status --json
```

#### Travaux

- créer le binaire `omni` ;
- accepter un prompt et un chemin de projet ;
- proposer sortie humaine et sortie JSON ;
- définir code de sortie stable ;
- supporter interruption ;
- permettre reprise par identifiant ;
- documenter la configuration d’un agent personnalisé dans Orca ;
- tester Omni lancé depuis Orca et depuis un terminal indépendant.

#### Critères de sortie

- Orca peut lancer Omni comme agent ;
- Omni peut sélectionner son harness et son modèle ;
- la session Omni reste persistante après fermeture d’Orca ;
- aucune dépendance à l’interface graphique d’Orca n’est requise.

### 22.13 Phase 11 — Intégration Orca niveau 2

**Objectif :** permettre à Orca d’afficher les événements structurés d’Omni.

#### Travaux

- stabiliser Omni Agent Protocol ;
- exposer événements JSON ou JSON-RPC ;
- définir handshake, version et capacités ;
- ajouter événements outils, permissions, usage et checkpoints ;
- créer un adaptateur dans le fork Orca ;
- mapper worktrees, terminal, fichiers et Git ;
- gérer reconnexion et reprise ;
- tester compatibilité ascendante.

#### Critères de sortie

- Orca affiche le streaming Omni ;
- les permissions sont demandées dans l’interface hôte ;
- les statistiques et checkpoints sont visibles ;
- une version incompatible est refusée proprement.

### 22.14 Phase 12 — Fonctionnalités P1

Après validation du socle, ajouter par ordre de valeur :

1. Git et GitHub ;
2. GitLab ;
3. worktrees parallèles ;
4. MCP et skills ;
5. terminal et éditeur ;
6. pull requests ;
7. tableaux d’usage détaillés ;
8. activité multi-agents ;
9. Computer Use macOS ;
10. voix ;
11. accès distant et mobile.

Chaque module doit être optionnel et ne pas imposer Orca à Omni Core.

---

## 23. Backlog initial structuré

### Epic A — Fondation

- `OMNI-001` Initialiser le dépôt et la CI.
- `OMNI-002` Mettre en place le monorepo TypeScript.
- `OMNI-003` Définir les conventions et ADR.
- `OMNI-004` Auditer les licences Orca.
- `OMNI-005` Produire la matrice de réutilisation.

### Epic B — Core et persistance

- `OMNI-010` Créer le schéma SQLite.
- `OMNI-011` Ajouter les migrations.
- `OMNI-012` Implémenter les repositories.
- `OMNI-013` Implémenter EventStore.
- `OMNI-014` Implémenter les checkpoints.
- `OMNI-015` Ajouter export/import.

### Epic C — Sécurité

- `OMNI-020` Créer SecretStore.
- `OMNI-021` Intégrer le trousseau macOS.
- `OMNI-022` Implémenter PermissionManager.
- `OMNI-023` Ajouter confirmation des commandes.
- `OMNI-024` Filtrer les logs.

### Epic D — Fournisseurs et modèles

- `OMNI-030` Créer ProviderAdapter.
- `OMNI-031` Intégrer OpenAI.
- `OMNI-032` Intégrer Anthropic.
- `OMNI-033` Intégrer Google.
- `OMNI-034` Intégrer OpenRouter.
- `OMNI-035` Créer Model Registry.
- `OMNI-036` Ajouter activation/désactivation.

### Epic E — Harnesses

- `OMNI-040` Créer HarnessAdapter.
- `OMNI-041` Intégrer le premier harness.
- `OMNI-042` Ajouter streaming et événements.
- `OMNI-043` Ajouter outils et permissions.
- `OMNI-044` Intégrer le deuxième harness.
- `OMNI-045` Ajouter Harness Swap.

### Epic F — Routage

- `OMNI-050` Créer TaskAnalyzer.
- `OMNI-051` Créer CapabilityMatcher.
- `OMNI-052` Créer CandidateScorer.
- `OMNI-053` Ajouter profils Auto.
- `OMNI-054` Ajouter Smart Fallback.
- `OMNI-055` Ajouter budget et Privacy Mode.

### Epic G — Orca

- `OMNI-060` Créer CLI Omni.
- `OMNI-061` Ajouter sortie JSON.
- `OMNI-062` Tester lancement depuis Orca.
- `OMNI-063` Stabiliser Omni Agent Protocol.
- `OMNI-064` Créer adaptateur Orca structuré.

---

## 24. Stratégie de tests

### Tests unitaires

- routage ;
- scoring ;
- compatibilité ;
- permissions ;
- sérialisation des événements ;
- migrations ;
- résumés de reprise.

### Tests d’intégration

- connexion fournisseur ;
- découverte de modèles ;
- création de session ;
- streaming ;
- appels d’outils ;
- interruption ;
- reprise ;
- Harness Swap ;
- fallback ;
- CLI dans Orca.

### Tests de contrat

Chaque adaptateur doit passer une suite commune :

- initialisation ;
- capacités ;
- session ;
- événement de réponse ;
- outil ;
- permission ;
- erreur ;
- interruption ;
- checkpoint ;
- libération des ressources.

### Tests de sécurité

- secret dans les logs ;
- permission refusée ;
- commande destructive ;
- tentative de contournement ;
- changement de projet ;
- export contenant des identifiants ;
- reprise après crash.

### Scénario de validation de référence

```text
Créer projet
→ lancer tâche avec Harness A
→ modifier un fichier
→ exécuter un test
→ créer checkpoint
→ basculer vers Harness B
→ transmettre le résumé
→ poursuivre la tâche
→ revenir à Harness A
→ vérifier historique, fichiers, Git et absence de répétition
```

---

## 25. Définition de terminé

Une fonctionnalité est considérée comme terminée uniquement si :

- son contrat TypeScript est documenté ;
- son état est persisté si nécessaire ;
- ses permissions sont définies ;
- ses erreurs sont typées ;
- ses événements sont journalisés ;
- ses tests unitaires et d’intégration sont présents ;
- son comportement hors ligne ou indisponible est défini ;
- elle ne crée pas de dépendance implicite à Orca ;
- elle est documentée dans le guide utilisateur et le guide développeur.

---

## 26. Premier sprint recommandé

Le premier sprint doit rester volontairement limité :

1. créer le dépôt autonome ;
2. installer le monorepo ;
3. écrire les ADR ;
4. auditer le fork Orca ;
5. créer le schéma SQLite ;
6. implémenter `Project`, `Conversation` et `ConversationEvent` ;
7. créer `HarnessAdapter` et `ProviderAdapter` ;
8. construire une CLI qui crée une conversation locale ;
9. ajouter un faux harness pour tester le journal ;
10. produire un premier scénario de checkpoint et reprise.

Le premier sprint ne doit pas encore chercher à intégrer tous les fournisseurs, tous les harnesses ou toutes les fonctions d’Orca. La priorité est de prouver que l’architecture d’Omni est indépendante, testable et capable de conserver un état canonique.

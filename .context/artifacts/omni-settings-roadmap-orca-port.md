# Roadmap paramètres Omni — port d'Orca

> Mapping complet des sections de paramètres d'Orca vers Omni.  
> Omni est un CLI Node.js + serveur HTTP loopback + GUI React/Vite (pas Electron).  
> Référence Orca : `/Users/barrozo/Github/Omni-Project/orca`.

---

## Légende

| Statut | Signification |
|--------|---------------|
| ✅ Fait | Implémenté et commité |
| 🔜 Prévu | À implémenter dans une prochaine phase |
| ❌ Exclu | Hors périmètre (décision explicite) |
| 🚫 N/A | Architecturalement non applicable à Omni (non-Electron) |

---

## Sections implémentées ✅

### Agents
- Harness par défaut d'Omni (pills codex / claude-code / opencode / Auto)
- Permissions (Select : demander / tout autoriser / tout refuser)
- Liste "Installés" avec détection live + badge compteur + bouton Actualiser
- AgentCatalogRow : icône, nom, sous-ligne, segmented Activé/Désactivé, "Par défaut"
- Modèles disponibles pour Auto et Omni Chat : groupés par fournisseur, Switch par modèle, collapsible, segmented Activé/Désactivé par groupe

### Comptes fournisseurs
- Détection ambiante : Claude (keychain / ~/.claude/.credentials.json → plan/tier), OpenAI (~/.codex/auth.json → email + plan), Gemini (~/.gemini/oauth_creds.json → email)
- Ligne de compte détecté : email/name + badge "Cet appareil" + badge "Actif" + détail plan
- Badge statut par fournisseur : Connecté (OAuth) / Clé API configurée / Non configuré
- Bouton "+ Ajouter un compte" → POST /api/accounts/login → spawn `omni auth login` (ouvre navigateur)
- Profils de clé API : liste, set/use/remove, formulaire nom + clé

### MCP
*(Présent dans la nav — intégré dans la version précédente)*

### Général
- Langue (fr / en / es)
*(Section existante — étendue à venir)*

### Connecteurs (Intégrations)
*(Section présente)*

### Plugins
*(Section présente)*

---

## Sections à implémenter 🔜

### Apparence
- Thème : Clair / Sombre / Système
- Implémentation : CSS var + `data-theme` sur `<html>` + `localStorage.omni.theme`
- Valeur : élevée (Omni n'a pas de sélecteur de thème)

### Chat & Saisie
- Comportement de la touche Entrée (envoyer vs nouvelle ligne)
- Suggestions de commandes
- Historique (longueur conservée)
- Police du chat

### Raccourcis clavier
- Tableau des raccourcis + édition

### Artefacts
- Dossier de sortie des artefacts
- Comportement d'ouverture automatique

### Notifications
- Web Notifications API : activer/désactiver par événement (tâche terminée, erreur, etc.)

### Statistiques & usage
- Tokens consommés par session / par fournisseur
- Durée des sessions

### Terminal
- Police, taille, couleurs du terminal intégré

### Git
- Nom + email d'auteur par défaut
- Branche par défaut

### Confidentialité
- Données locales uniquement — pas de télémétrie
- Effacer l'historique local

### Orchestration
- Comportement de l'orchestrateur Auto
- Priorité des fournisseurs

### Voix
*(Si une API de synthèse vocale est intégrée)*

---

## Sections exclues ❌

| Section Orca | Raison d'exclusion |
|---|---|
| **Hôtes distants** (SSH hosts, Serveurs Orca distants) | Non nécessaire pour Omni (décision explicite) |
| **Avancé** | Non nécessaire (décision explicite) |
| **Expérimental** | Non nécessaire (décision explicite) |
| **Compte Orca** | Non applicable — Omni n'a pas de compte Orca (décision explicite) |
| **Mobile** | Hors périmètre pour l'instant (décision explicite) |

---

## Sections non applicables à Omni 🚫

| Section Orca | Pourquoi N/A |
|---|---|
| **Computer Use** | Nécessite Electron + accès desktop natif |
| **Autorisations macOS** | Electron uniquement (permissions Accessibility/Screen Recording) |
| **Workspace flottant** | Fonctionnalité Electron (window management) |
| **Mises à jour automatiques** | Electron uniquement (auto-updater) |
| **Intégration OS** | Menu bar, dock, raccourcis globaux — Electron uniquement |

---

## Commits de référence

| Commit | Contenu |
|--------|---------|
| `c8059b7` | Settings UI : double sidebar, section Agents (harness pills, permissions, installed rows, models), retrait Eve |
| `ef4deed` | Comptes fournisseurs : détection ambiante, OAuth button, profiles clé API |

---

*Généré le 2026-10-31 — à mettre à jour au fil des phases.*

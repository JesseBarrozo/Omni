# Port du système de gestion de comptes d'Orca vers Omni

Écrit pour : l'équipe Omni. Plan de port, par phases, avec les décisions à trancher.

## État actuel (vérifié)

**Omni a déjà :**
- Le stockage des comptes : `src/oauth-profiles.mjs`, `src/api-key-profiles.mjs`,
  `src/openai-auth.mjs`, `src/secret-store.mjs` (trousseau via `@napi-rs/keyring`).
- Un panneau Comptes : `web/src/components/account-profiles.tsx` (profils de clés API).
- Les harnesses : Claude, Codex (OpenAI), Gemini, OpenCode, Eve, OpenRouter, Antigravity.
- Depuis cette session : une fondation i18n (`web/src/i18n/`), prérequis des composants d'Orca.

**Omni n'a pas :**
- La couche d'usage / limites de débit (aucun récupérateur).
- Le segment d'usage du pied de page (la capture du besoin).
- Les menus de changement de compte dans le pied de page.

## Ce qu'est le système d'Orca (vérifié)

- `src/main/rate-limits/` : 63 fichiers hors tests, ~13 fournisseurs (claude, codex,
  cursor, gemini, antigravity, grok, kimi, minimax, opencode, zcode). Chaque
  fournisseur a son flux de credentials, son récupérateur d'usage, ses sondes et sa
  classification d'erreurs.
- `src/renderer/src/components/status-bar/` : 40+ fichiers, 7 000+ lignes.
- `src/shared/rate-limit-types.ts` : types riches (fenêtres, buckets, soldes
  d'usage supplémentaire, types d'échec, métadonnées).
- Couplage Electron : store de persistance, client RPC runtime, sondage CLI de
  Codex, portes WSL, trousseau. Ce couplage ne se copie pas tel quel.

## Mapping Electron → HTTP loopback d'Omni

| Orca (Electron) | Omni (serveur loopback) |
| --- | --- |
| `window.api` / RPC runtime | Routes `GET/POST /api/usage*` dans `workspace-server.mjs` |
| `Store` de persistance | Fichiers de credentials + trousseau déjà utilisés par Omni |
| Composants liés au store Zustand | Composants React alimentés par un snapshot d'usage |
| `translate()` | `useTranslation()` d'Omni (fondation posée) |

## Principe directeur (règles AGENTS.md d'Omni)

- Vérifier la doc du SDK de chaque fournisseur avant son intégration.
- Jamais de chiffres inventés dans le chemin produit. Un usage non récupéré
  s'affiche « non disponible », pas un faux pourcentage.
- Réutiliser la logique réelle d'Orca (endpoints, parsing, erreurs) plutôt que
  la réécrire. C'est du port, pas de l'invention.
- Une phase à la fois, validée avant la suivante.

## Phases

### Phase A — Fondation d'usage (sans réseau, testable)
- Porter `src/shared/rate-limit-types.ts` d'Orca vers Omni (types partagés).
- Porter les helpers purs : format du reset, label de pourcentage, label de pool.
- Segment de pied de page `UsageFooter` consommant un snapshot d'usage, aligné
  sur la structure d'Orca (pastilles par fournisseur, %, reset, bouton refresh).
- Route serveur `/api/usage` renvoyant, par compte configuré, la présence réelle
  des credentials et un état (`non configuré` / `non disponible`). Aucun chiffre
  inventé.
- Tests : types, helpers, route.

### Phase B — Récupérateurs réels par fournisseur (réseau, doc SDK)
Un sous-lot par fournisseur, chacun porté de `src/main/rate-limits/` d'Orca et
vérifié contre la doc officielle :
1. Claude (endpoint d'usage OAuth Anthropic).
2. Codex / OpenAI (usage backend).
3. Gemini.
Puis, si demandé : Cursor, Antigravity, Grok, OpenCode.

### Phase C — Changement de compte dans le pied de page
- Menus Claude et Codex (switcher), portés de `ClaudeSwitcherMenu` / `CodexSwitcherMenu`.
- Branchés sur les profils OAuth / clés API existants d'Omni.

### Phase D — i18n complet
- Migrer l'UI existante (français en dur) vers `useTranslation()`.
- Remplir en.ts et es.ts pour toutes les clés.

## Décisions à trancher

1. **Fournisseurs de la phase B, et ordre.** Recommandation : Claude, OpenAI/Codex,
   Gemini d'abord (ceux qu'Omni authentifie déjà).
2. **Locales i18n.** Posé : fr (référence), en, es. À confirmer.
3. **Phase A seule d'abord, ou A+B d'un fournisseur en une fois ?** Recommandation :
   A d'abord (visible, sans risque), puis B fournisseur par fournisseur.

## Fait dans cette session

- Fondation i18n réelle et testée (`web/src/i18n/`), pied de page migré, sélecteur
  de langue dans les Paramètres. Bascule live vérifiée, persistée au rechargement.

# Refonte de la gestion des repositories — Design

**Date** : 2026-07-19
**Branche** : `ticket/9f2303-refonte-de-la-config-et-visualisation-de`
**Références design** : `../../../../refonte/` (README.md = handoff, `Fleex Repos Prototype.dc.html` = prototype interactif source de vérité, `screenshots/` = 5 états clés)

## Objectif

Supprimer l'écran Settings → Repositories (TagInput de patterns) et intégrer la gestion des repos directement dans la vue Repos, avec une refonte complète de l'interface : sidebar homogène avec le catalogue agentique, dashboard « Overview » par repo (coûts, tickets & worktrees avec verdicts, aperçus PRs/issues), onglets PRs/Issues réorganisés, modal d'ajout alimentée par les orgs GitHub.

## Décisions actées

| Décision                             | Choix                                                                                                                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stockage config repos                | **Liste explicite** de `owner/repo`. Les patterns `org/*` disparaissent du stockage ; « Select all · org/* » dans la modal = ajout en masse (snapshot). On perd le suivi automatique des nouveaux repos d'une org (assumé). |
| Couleurs                             | **Système de thème Fleex** (`--theme-*` + `lib/tints.ts`). Structure/espacements/hiérarchie fidèles aux maquettes, hex exacts non repris. Pas d'exemption au lint `check-raw-palette.mjs`.                                  |
| Config par repo (hook post-checkout) | **Onglet « Config » conservé** dans le dashboard repo (`RepoConfigPanel` restylé).                                                                                                                                          |
| Langue UI                            | **Anglais** (Overview, Created by me, Clean up, already tracked…).                                                                                                                                                          |
| Approche                             | **Refonte en place, incrémentale** : transformation des composants existants, app fonctionnelle à chaque étape.                                                                                                             |

## 1. Données & serveur

### 1.1 Migration config : patterns → liste explicite

- Au démarrage du serveur (ou premier `GET /api/config`) : si `settings.repositories` contient un pattern `*`, résolution unique via `RepositoryResolver` existant, persistance de la liste explicite à la place.
- Idempotent. Si `gh` échoue pendant la résolution d'un pattern : le pattern est conservé intact, nouvel essai au prochain démarrage. Aucune perte de config possible.
- `resolvedRepositories` devient un miroir de `repositories` (conservé pour compat : summaries, allow-list de clones, refresh scheduler — `getConfiguredRepos()` inchangé).
- Le `RepositoryResolver` reste utilisé par la modal (expansion `org/*` à la volée).

### 1.2 Nouveaux endpoints / extensions

1. **`GET /api/github/discovery`** — pour la modal d'ajout : orgs accessibles + repos par org (`nameWithOwner`, `visibility`, `updatedAt`). Implémentation via `gh` (orgs de l'utilisateur + `gh repo list <org> --json …`), cache ~5 min dans `repositoryCache`. Le flag « déjà suivi » est calculé côté client par diff avec `settings.repositories`.
2. **Vérification saisie libre** — endpoint de validation d'un `owner/repo` hors orgs (via `gh repo view`), utilisé par « Verify & add ».
3. **Issues étendues** — la route issues passe de « open assignées à @me » à : toutes les issues **open + closed (fenêtre 30 j)** avec `labels` (nom + couleur), `author`, `commentsCount`, `state`. Extension du type `GitHubIssue` (`packages/shared/src/types/repository.ts`) et du cache existant.
4. **`GET /api/repositories/:org/:name/stats?days=30`** — carte Coût : coût total 30 j, coût moyen par ticket, tendance vs période précédente, buckets journaliers pour la sparkline. Agrégé depuis les tickets liés au repo (liens `type: 'repository'`) et les coûts de leurs sessions (même source que l'infra statistics). Les compteurs tickets (doing / done / sessions actives) sont dérivés côté client des stores existants.

### 1.3 Actions

- **Suppression de repo** (poubelle sidebar) : `PUT /api/config` avec la liste amputée → pipeline existant (`bareCloneManager.syncWithConfig()`) nettoie le clone bare. Confirmation UI obligatoire.
- **Suppression de worktree** (panel Tickets & worktrees, orphelins, « Clean up » PRs merged) : endpoint existant `DELETE /api/repositories/:org/:name/worktrees` (émet `worktree.deleted`). Confirmation UI obligatoire.

### 1.4 Verdicts worktrees

Pure dérivation client dans `packages/web/src/lib/worktreeVerdict.ts` (nouveau, testé), depuis `DiffStats` (ahead/behind), `mergedAt` des PRs et le statut du ticket lié :

| Verdict            | Condition                                               | Teinte |
| ------------------ | ------------------------------------------------------- | ------ |
| Ready to push      | ahead > 0, behind = 0, non mergé                        | purple |
| Needs rebase       | behind > 0, non mergé                                   | yellow |
| Up to date         | ahead = 0, behind = 0, non mergé                        | gray   |
| Merged · removable | PR liée mergée                                          | green  |
| Stale · removable  | ticket lié en statut `done`/`cancelled`, ou introuvable | red    |

Aucun nouveau champ serveur.

## 2. Interface

### 2.1 Sidebar Repositories

Refonte de `sidebar/RepositoriesContent.tsx`, `OrgGroup.tsx`, `RepoItem.tsx`, `RepositoriesSidebarHeader.tsx` :

- Header « REPOSITORIES » + compteur + bouton `+` (26×26, accent) → ouvre la modal.
- Recherche « Search repos… » (filtre live, insensible à la casse).
- Chips de filtre `All n / Active n / <org> n` (exclusives).
- Section **ACTIVE** : repos avec ≥1 worktree ou session en cours — dérivé de `repositoryStore.worktreesByRepo` + sessions, sans nouveau champ. Visible uniquement sans recherche/filtre.
- Groupes par org repliables (`▾ ORG` + compteur, org du repo sélectionné accentuée).
- Item repo 2 lignes : icône branche SVG, nom semibold, `org/name` mono dim, badge `n wt` (si n > 0), poubelle rouge au hover (opacity .25 → 1) → confirmation → retrait de la config. Les 5 badges de compteurs actuels de `RepoItem` sont remplacés par le badge worktrees.
- Sélection : fond accent alpha + bordure gauche 2px.
- État vide (0 repo) : icône `+` pointillés, texte d'aide, CTA « + Add repositories » (le renvoi « Configure repositories in Settings » disparaît).

### 2.2 Dashboard — onglets

`RepositoryDashboard.tsx` : onglets `pulls/issues/merged/settings` → **`overview` (défaut) / `pulls` / `issues` / `config`**. L'onglet Merged est absorbé par le segment Merged de l'onglet PRs. Header conservé : `org/name`, badge « cloned · n worktrees », lien GitHub, `RefreshControl`.

### 2.3 Onglet Overview (nouveau)

Layout vertical (padding 24-28, gaps 20) :

1. **4 cartes KPI** (grid `1.4fr 1fr 1fr 1fr`) :
   - **Fleex cost · 30 d** : total, sparkline SVG (teinte yellow), coût/ticket, tendance — depuis l'endpoint stats.
   - **Tickets** : doing / done / sessions actives — depuis les stores tickets/sessions.
   - **GitHub** : PRs ouvertes / issues / mergées — depuis le dashboard store.
   - **Worktrees** : total + « n stale » (rouge, bordure carte alerte) + lien « Clean up now → » si stale > 0.
2. **Panel « Tickets & worktrees »** pleine largeur — une entrée par ticket actif ayant un worktree :
   - Ligne ticket : `#id` mono · chip type (Fix/Build/Ops/Task) · titre · chip statut · chip coût (`cumulativeCostUsd`) · chip PR liée si existe.
   - Ligne worktree : `└ branche` mono · `↑n` vert `↓n` rouge · badge verdict · poubelle (DELETE worktree, avec confirmation).
   - Sous-section **ORPHANED WORKTREES** (label rouge) : worktrees dont le ticket est clos ou supprimé, avec âge, `↓n`, bouton « Remove » rouge.
3. **Demi-panneaux Pull requests | Issues** (grid `1fr 1fr`) : aperçus 2 lignes, lien `n →` vers l'onglet complet.

Chip ticket cliquable partout → ouvre le ticket dans le Kanban (navigation `uiStore` existante).

### 2.4 Onglet Pull Requests

`PullRequestsSection.tsx` refondu (absorbe `MergedPRsSection.tsx`) :

- **Barre de contrôle** : segmented control exclusif **All / Open / Merged** + séparateur + toggles combinables **Created by me / Assigned to me** (ET logique ; remplacent les chips All/Mine/Assigned).
- Ligne de résultat : « Open · created by me — n pull requests ».
- **Row PR** en carte 2 lignes (plus de `DataTable`) : `#num` mono + titre semibold ; branche mono + auteur/âge ; diff `+n −n` ; chip ticket lié (accent plein, sous-badge statut) si importée ; `SmartSessionButton` / `ImportTaskButton` existants réutilisés tels quels.
- **Segment Merged** : meta « merged X ago · worktree cleaned » ; si worktree encore présent → bordure alerte, mention « worktree still present », bouton **Clean up** rouge (DELETE worktree).

### 2.5 Onglet Issues

Même grammaire : segments **All / Open / Closed**, labels GitHub en chips colorées (couleur du label GitHub), row 2 lignes (titre + auteur/âge/« n comments », pas d'emoji). Issue importée → chip ticket + `SmartSessionButton` ; sinon `ImportTaskButton`.

### 2.6 Modal d'ajout de repositories (nouveau composant)

Base `ui/Modal.tsx`, carte ~860px :

- **Header** : titre + sous-titre « Organizations detected via `gh` — n orgs, m accessible repos ».
- **Recherche** live + compteur de résultats.
- **Groupes par org** : header « n / m tracked » + lien « Select all · `org/*` » (n'ajoute que les manquants).
- **Row repo** : nom mono, meta (visibilité + dernière maj), badge « already tracked » (toggle désactivé), toggle accent ON / neutre OFF. Row sélectionnée : fond/bordure accent alpha.
- **Saisie libre** (footer) : input `owner/repo` validé par regex `^[\w.-]+\/[\w.-]+$` puis par l'endpoint de vérification, bouton « Verify & add » actif seulement si valide. Repo déjà suivi → feedback « already tracked », pas de doublon.
- **Footer** : récap « n repos to add · noms » + Cancel + CTA « Add n repos » (désactivé si 0).
- À la validation : merge dans `settings.repositories` (tri alphabétique) + `PUT /api/config` → le pipeline serveur clone et rafraîchit ; modal fermée, sélections réinitialisées.

### 2.7 Suppression Settings → Repositories

- `SettingsNav.tsx` : retrait de l'entrée `repositories` (ligne 68) + icône.
- `SettingsPanel.tsx` : retrait du render `RepositoriesTab` (lignes 273-299) + label map.
- `RouterSync.tsx` : retrait de `'repositories'` de `VALID_SETTINGS_TABS` ; `/settings/repositories` redirige vers `/repositories`.
- `ui/TagInput.tsx` : supprimé uniquement s'il n'a plus aucun consommateur.

### 2.8 Style

- Couleurs : mapping sur `--theme-*` et `tints.ts` — violet prototype → accent/purple, ambre → yellow, vert → green, rouge → red, cyan → teal, indigo → indigo, rose coût → pink/red alpha.
- Typo/espacements fidèles aux maquettes : titres row 14px/600, corps 12-13.5px, metas 11-11.5px, labels sections bold letter-spacing, mono pour repos/branches/ids/coûts, radius 8-12, padding cartes 16-20.
- Interactions : changements d'état instantanés (pas de transition sauf toggles .15s), hover rows, poubelles opacity .25 → 1.
- **Pas d'emoji.** Icônes SVG inline fines (branche, loupe, poubelle), traits 1.2-1.5px.

## 3. Erreurs, edge cases, tests

### 3.1 Erreurs & états dégradés

- `gh` indisponible/non authentifié : modal en état d'erreur explicite ; sidebar et Overview continuent sur les données en cache.
- Stats vides (repo sans ticket) : carte Coût affiche `$0` sans sparkline.
- Suppressions (repo, worktree) : confirmation systématique ; en cas d'échec, toast d'erreur et état client inchangé (pas d'optimistic delete).
- Repo suivi mais clone bare absent / réseau coupé : badge d'état header (comportement actuel conservé).

### 3.2 Edge cases

- Repo devenu inaccessible (droits révoqués) : reste listé, erreurs GitHub silencieuses (soft), supprimable normalement.
- Worktree orphelin dont le ticket a été **supprimé** (pas seulement clos) : section ORPHANED avec âge et `↓n`.
- « Select all org/* » sur une org partiellement suivie : n'ajoute que les manquants.
- Saisie libre d'un repo déjà suivi : feedback, pas de doublon.

### 3.3 Tests (Vitest)

- `lib/worktreeVerdict.test.ts` : matrice complète des verdicts.
- Service d'agrégation coût par repo : fenêtre 30 j, buckets, repo sans données.
- Migration config : résolution unique, idempotence, échec `gh` non destructif.
- `RouterSync.test.ts` : retrait de `settings/repositories`, redirection.
- Modal : sélection, saisie libre, désactivation « already tracked ».
- PRs : combinaison segments × toggles (ET logique).
- `RepositoryDashboard` : test de base des onglets (aucun test n'existe aujourd'hui).

## Hors scope

- Toute modification du data model tickets/sessions/worktrees côté serveur (hors extensions listées en 1.2).
- i18n : pas de couche de traduction, copy inline en anglais.
- Refonte des autres vues (Kanban, Cockpit…) ou du catalogue agentique.
- Confirmation « intelligente » de suppression (dry-run, corbeille) : simple dialog de confirmation.

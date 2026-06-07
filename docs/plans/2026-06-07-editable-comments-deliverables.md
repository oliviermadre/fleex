# Commentaires & Deliverables éditables — Spécification

> Statut : proposition (à valider). Auteur : agent. Date : 2026-06-07.

## 1. Objectif

Permettre l'édition des **commentaires** et des **deliverables** après leur création, en traitant proprement :

- l'UX d'édition (web) côté commentaires et deliverables ;
- la cohérence du **contexte LLM** quand un agent ayant déjà travaillé sur le ticket est relancé après une édition ;
- la **matérialisation** de l'édition (badge « modifié », versions) ;
- les **dates** (création immuable vs dernière édition) ;
- les **événements** à émettre et propager (`comment.updated`, `deliverable.updated` enrichis).

## 2. État existant (point de départ)

Une partie de l'infrastructure existe déjà. Ce qui suit est **factuel**, vérifié dans le code.

### Backend — déjà en place
- **Entités**
  - `TicketCommentEntity.updateBody(body)` : remplace le corps, recalcule les mentions, bump `updatedAt`. (`packages/server/src/domain/entities/ticket-comment.entity.ts:114`)
  - `TicketDeliverableEntity.update({title?, content?, status?})` : incrémente `version` **uniquement** si `content` change, bump `updatedAt`. (`packages/server/src/domain/entities/ticket-deliverable.entity.ts:44`)
- **Persistance** : `save()` en upsert sur tous les adaptateurs (sqlite / pg / supabase / json).
- **Événements** : `comment.updated`, `deliverable.updated`, `deliverable.deleted`, `comment.deleted` définis dans `packages/server/src/domain/events.ts`.
- **Routes**
  - Port **agent** (token) `/tickets/...` :
    - `PATCH /tickets/:id/comments/:commentId` → **author-only**, réconcilie les mentions, émet `comment.updated`. (`agent-comments.routes.ts:93`)
    - `PATCH /tickets/:id/deliverables/:delivId` → **owner-only**, émet `deliverable.updated`.
  - Port **web** (humain) `/api/tickets/...` :
    - `PATCH /api/tickets/:id/deliverables/:delivId` → **sans ownership** (humain de confiance), émet `deliverable.updated`. (`tickets.routes.ts:1012`)
    - **PAS** de `PATCH` commentaire. ❌
- **Broadcast WS** : `comment:updated` / `deliverable:updated` sont déjà diffusés par le broadcast-registrar, et le front y est déjà abonné.

### Frontend — manquant
- Aucune UI d'édition : `TicketComments.tsx` ne propose pas d'édition et n'affiche ni `updatedAt` ni « modifié ». `DeliverableFormModal.tsx` est **create-only**.
- `api.ts` n'expose ni `updateTicketComment` ni `updateDeliverable`.

### Contexte LLM — le point critique
Deux canaux alimentent un run :

1. **Prompt recomposé à chaud** — `composeUserPrompt()` (`execute-agent.ts:1805`) lit `GetTicketContextUseCase` qui charge l'**état courant** de la DB (commentaires, deliverables). → une édition est donc **naturellement reflétée** dans le nouveau tour utilisateur.
2. **Reprise de session SDK** — `resume: previousSessionId`, clé `${persona.name}:${ticketId}` (`execute-agent.ts:494,553`). Le SDK **rejoue le transcript figé** du run précédent, qui contient la version **pré-édition** du commentaire/deliverable.

**Conséquence** : après une édition, l'agent relancé voit *à la fois* l'ancienne version (dans le transcript repris) **et** la nouvelle (dans le prompt recomposé). Contradiction silencieuse. C'est ce que cette spec doit résoudre (§6).

## 3. Modèle de données

On sépare clairement « ligne touchée » (`updated_at`, générique) de « contenu édité » (nouveau).

### 3.1 Nouvelles colonnes (migration `NNN_editable_comments_deliverables.ts`)

Table `comments` :
- `last_edited_at TIMESTAMPTZ NULL` — null tant que jamais édité ; sinon date de la dernière édition **du corps**.
- `last_edited_by TEXT NULL` — identité de l'éditeur (nom humain ou agent).
- `edit_count INTEGER NOT NULL DEFAULT 0`.

Table `deliverables` :
- `last_edited_at TIMESTAMPTZ NULL`, `last_edited_by TEXT NULL` — édition du **contenu/titre** (pas le simple passage de statut).
- `version` existe déjà (sert de compteur d'édition de contenu).

> **Règle de dates** : `created_at` est **immuable**. `updated_at` reste un timestamp technique « ligne modifiée » (peut bouger sur changement de statut, etc.). `last_edited_at` est le seul signal produit « ce contenu a été édité par X », et c'est lui qu'on expose en UI et qu'on utilise pour le delta LLM.

Migration : créer un **nouveau** fichier (jamais modifier un existant — cf. `CLAUDE.md`), avec ajout de colonnes nullable (rétro-compatibles), et **pas** de nouvelle table → pas de policy RLS supplémentaire requise.

### 3.2 (Optionnel, phase 2) Historique de révisions
Pour l'audit/diff, table dédiée :

```
deliverable_revisions(id, deliverable_id, version, title, content, edited_at, edited_by)
comment_revisions(id, comment_id, body, edited_at, edited_by)
```

Avec RLS Supabase (cf. `CLAUDE.md`). Hors périmètre phase 1 ; le badge « modifié » + `version` suffisent au départ.

### 3.3 DTO (`packages/shared/src/types/ticket.ts`)
Ajouter aux interfaces `TicketComment` et `TicketDeliverable` :
- `lastEditedAt: string | null`
- `lastEditedBy: string | null`
- (`editCount` pour les commentaires si souhaité)

`version` est déjà exposé sur `TicketDeliverable`.

## 4. API

### 4.1 Commentaires — ajouter le PATCH web (gap principal)
Nouvelle route `PATCH /api/tickets/:id/comments/:commentId` (`tickets.routes.ts`), symétrique du PATCH agent mais **côté humain** :

- Corps : `{ body: string }`.
- **Permissions** : voir §5.
- Logique : `comment.updateBody(body)` → set `last_edited_at`, `last_edited_by`, `edit_count++` → `save()`.
- **Réconciliation des mentions** : extraire le diff (mentions ajoutées / retirées) exactement comme la route agent (`agent-comments.routes.ts:105-157`) — créer les `mention.created` pour les nouvelles cibles, résoudre celles qui disparaissent. **Factoriser** cette logique dans un use-case `EditCommentUseCase` partagé par les deux ports (agent + web) pour éviter la divergence actuelle.
- Émettre `comment.updated` enrichi (§7).

### 4.2 Deliverables — enrichir le PATCH existant
Le `PATCH /api/tickets/:id/deliverables/:delivId` existe. Modifications :
- Renseigner `last_edited_at` / `last_edited_by` **uniquement** si `title` ou `content` change (pas pour un simple `status`).
- Garde anti-effets-de-bord (§7.3) : un changement de **contenu** ne doit pas re-déclencher l'auto-review / le wake des agents — seul `status: draft → final` le fait.

### 4.3 Client (`packages/web/src/services/api.ts`)
Ajouter :
```ts
updateTicketComment(ticketId, commentId, body): Promise<TicketComment>
updateDeliverable(ticketId, deliverableId, { title?, content?, status? }): Promise<TicketDeliverable>
```

## 5. Permissions (décision)

| Acteur | Commentaire | Deliverable |
|---|---|---|
| Agent (token) | Son propre commentaire (existant) | Le sien (existant) |
| Humain (web) — son contenu | ✅ libre | ✅ libre |
| Humain (web) — contenu d'un **agent** | ✅ autorisé mais **tracé** (`last_edited_by = humain`, attribution `authorName`/`authorType` **inchangée**) | ✅ déjà autorisé (port web sans ownership) |

Rationale : l'humain est l'opérateur de confiance sur le port web (cohérent avec le PATCH deliverable web actuel). Éditer le commentaire d'un agent est une **correction/rédaction** assumée et visible (« modifié par {humain} »), pas une usurpation : l'auteur d'origine reste affiché.

> **Décision ouverte D1** : interdire l'édition humaine des commentaires d'agents (édition strictement « own ») si l'on préfère l'inviolabilité de la parole agent. Recommandation : autoriser + tracer (ci-dessus).

## 6. Contexte LLM sur re-run après édition (cœur de la spec)

Objectif : qu'un agent relancé travaille sur la **version courante**, sans être pollué par la version figée dans sa session reprise.

### 6.1 Détecter ce qui a changé depuis le dernier passage de l'agent
On dispose déjà, par session `persona:ticket`, de la date du dernier run (via `AgentExecution.startedAt` / `lastEventAt` et `sessionHistory`). On définit un **watermark** = date de composition du prompt du dernier run de cette session.

Calcul du delta au moment de composer le prompt (dans `GetTicketContextUseCase` / `composeUserPrompt`) :
- **Édités** : commentaires/deliverables visibles dont `last_edited_at > watermark` **et** `created_at <= watermark` (créés avant, donc déjà vus, mais modifiés depuis).
- **Supprimés** : reconstruits depuis `domain_event_log` — events `comment.deleted` / `deliverable.deleted` du ticket avec `occurred_at > watermark`. (Évite de stocker un snapshot : on réutilise le journal d'événements existant.)
- Les **nouveaux** commentaires/deliverables (`created_at > watermark`) ne relèvent pas de l'édition : ils sont déjà couverts par le flux normal mention/wake.

### 6.2 Deux leviers combinés (recommandé : hybride)

**Levier A — Bloc « corrections » dans le prompt (toujours).**
Quand un delta non vide est détecté et qu'on **reprend** une session, préfixer le tour utilisateur d'un bloc explicite :

```
## Mises à jour depuis ton dernier passage
Les éléments suivants ont changé. Considère la NOUVELLE version comme la
référence et ignore toute version antérieure présente dans l'historique.

- [ÉDITÉ] Commentaire de {authorName} (modifié par {editor} le {date}) :
  <nouveau corps>
- [ÉDITÉ] Deliverable « {title} » v{version} (modifié le {date}) :
  <nouveau contenu>
- [SUPPRIMÉ] Commentaire de {authorName} du {date} — ne plus en tenir compte.
```

Peu coûteux, préserve la continuité de session et le prompt-caching.

**Levier B — Invalidation de session (cas « lourds »).**
On **abandonne le `resume`** (run frais, recomposé intégralement depuis l'état courant) quand le delta est structurel :
- un deliverable que **l'agent lui-même** a produit a été édité par un humain ; ou
- une suppression est intervenue ; ou
- le volume d'éditions dépasse un seuil (ex. > N éléments ou > X% du contexte).

Sinon → levier A seul.

> Pourquoi l'hybride : le bloc-correction suffit dans le cas courant (1-2 éditions mineures) sans casser le cache ; l'invalidation garantit la correction quand le transcript figé deviendrait franchement trompeur (auto-édition, suppressions).

### 6.3 Implémentation
- Étendre `GetTicketContextUseCase.execute(...)` pour accepter `sinceWatermark?: Date` et renvoyer un `contextDelta { editedComments, editedDeliverables, deletedRefs }`.
- Source du watermark : la dernière `AgentExecution` `completed` de cette `persona:ticket` (`agentEventStore`). La requête de suppression interroge `domainEventLogStore` filtré par `ticketId` + types + `occurredAt > watermark`.
- Dans `execute-agent.ts`, après calcul du delta :
  - décider resume vs fresh (règles 6.2.B) ;
  - si resume, injecter le bloc 6.2.A en tête de `composeUserPrompt`.

> **Décision ouverte D2** : valeurs du seuil d'invalidation (N éléments / proportion). Proposition de départ : invalidation si suppression OU auto-édition d'un deliverable ; sinon bloc-correction.

## 7. Événements

On **réutilise** `comment.updated` et `deliverable.updated` (déjà branchés au broadcast WS et aux handlers), en **enrichissant** leur payload plutôt qu'en créant de nouveaux types.

### 7.1 `comment.updated` (payload enrichi)
Ajouter : `editorType: 'user' | 'agent'`, `editorName: string`, `bodyChanged: boolean`, `editedAt: Date`.
(`createdMentions` existe déjà pour la réconciliation.)

### 7.2 `deliverable.updated` (payload enrichi)
Ajouter : `editorType`, `editorName`, `contentChanged: boolean`, `version: number`, `editedAt: Date`.
Conserver `oldStatus` / `newStatus` existants.

### 7.3 Garde sur les handlers (anti-storm)
Aujourd'hui `deliverable.updated` peut réveiller des agents / déclencher l'auto-review. À encadrer :
- **Auto-review** : ne se déclenche que si `oldStatus !== 'final' && newStatus === 'final'`. Une édition de contenu pur (`contentChanged && status inchangé`) **ne** redéclenche **pas** l'auto-review.
- **Wake waiting agents** : un edit ne réveille pas en masse ; le réveil reste piloté par les nouveaux commentaires/deliverables, pas par l'édition d'un existant.
- Idem `comment.updated` : ne crée de mentions/triggers que pour les cibles **nouvellement ajoutées** (réconciliation), jamais pour celles déjà présentes.

### 7.4 Propagation
- WS : `comment:updated` / `deliverable:updated` déjà diffusés → le front met à jour le corps + le badge en temps réel.
- Journal : tout passe déjà par `domain_event_log` (handler `'*'`), donc l'audit « qui a édité quoi quand » est tracé sans table supplémentaire.

## 8. UX (web)

### 8.1 Commentaires (`TicketComments.tsx`)
- **Affordance** : sur survol d'un commentaire dont on est l'auteur (ou commentaire d'agent pour un humain, selon D1), bouton « Modifier » (à côté de « Supprimer » qui existe déjà).
- **Mode édition inline** : le bloc commentaire bascule en textarea pré-remplie réutilisant l'éditeur existant (autocomplete @mentions, upload de fichiers, modes Talk/Plan/Edit). Boutons « Enregistrer » / « Annuler ». `Échap` annule, `Ctrl/Cmd+Entrée` enregistre.
- **Sauvegarde** : `api.updateTicketComment(...)` → MAJ optimiste, réconciliée par l'event WS `comment:updated`.
- **Matérialisation** : sous le commentaire édité, mention discrète « modifié {il y a 3 min} » (tooltip = date exacte + « par {editor} » si éditeur ≠ auteur). S'appuie sur `lastEditedAt` / `lastEditedBy`.
- **Mentions** : prévenir visuellement que retirer un `@agent:` (via barré `~~@agent:x~~` déjà supporté, ou suppression) résout la mention associée.

### 8.2 Deliverables
- **Édition** : transformer `DeliverableFormModal` en composant create **ou** edit (prop `deliverable?` ⇒ pré-remplissage titre/type/statut/contenu ; `type` non éditable après création). Bouton « Modifier » dans `TicketDeliverables.tsx` (à côté des actions existantes).
- **Sauvegarde** : `api.updateDeliverable(...)`.
- **Matérialisation** : badge `v{version}` déjà affichable + « modifié {date} ». Le toggle statut draft/final reste distinct de l'édition de contenu.
- **(Phase 2)** : si historique de révisions, lien « voir les versions » + diff.

### 8.3 Cohérence « lu/non-lu »
Une édition par un **autre** acteur peut remarquer le contenu comme « non lu » (curseur `commentLastSeenAt`, `seen_deliverables`). Décision : une édition **ne** réinitialise **pas** l'état lu (sinon bruit). On s'appuie sur le badge « modifié » pour signaler le changement. (Cohérent avec le fait que `last_edited_at` ne touche pas les curseurs.)

## 9. Cas limites

- **Concurrence** : last-write-wins via upsert. Optionnel : concurrence optimiste par en-tête `If-Match: <version|updatedAt>` → 409 si périmé. (Phase 2.)
- **Édition d'un commentaire déjà consommé par un agent en cours d'exécution** : pas de rollback du run en cours ; le delta sera pris au **prochain** run (§6).
- **Suppression vs édition** : la suppression de commentaire est aujourd'hui *hard delete*. Option (phase 2) : *soft delete* (tombstone) pour préserver la cohérence des fils et du contexte LLM ; sinon le delta « supprimé » via le journal suffit.
- **Édition vidant le corps** : refuser un `body` vide (400) côté API.
- **Type de deliverable** : non modifiable après création (sinon casse `getByTicketAndType`, ticket-summary, etc.).

## 10. Découpage / phases

**Phase 1 — Édition fonctionnelle + matérialisation**
1. Migration : colonnes `last_edited_at` / `last_edited_by` (+ `edit_count`).
2. DTO + entités : exposer `lastEditedAt`/`lastEditedBy`, set sur édition.
3. Use-case `EditCommentUseCase` partagé ; route web `PATCH /api/tickets/:id/comments/:commentId` ; enrichir PATCH deliverable.
4. Enrichir events `comment.updated` / `deliverable.updated` + gardes anti-storm (§7.3).
5. Client `api.ts` + UI (édition inline commentaires, modal edit deliverables, badges « modifié »).

**Phase 2 — Cohérence LLM**
6. Watermark + `contextDelta` dans `GetTicketContextUseCase`.
7. Bloc « corrections » + règle d'invalidation de session dans `execute-agent.ts`.

**Phase 3 — Audit/diff (optionnel)**
8. Tables de révisions + RLS + UI historique/diff ; concurrence optimiste.

## 11. Décisions ouvertes à trancher
- **D1** : l'humain peut-il éditer les commentaires d'un agent ? (reco : oui + tracé)
- **D2** : seuils d'invalidation de session (reco : invalider si suppression ou auto-édition de deliverable, sinon bloc-correction)
- **D3** : soft-delete des commentaires ? (reco : phase 2)
- **D4** : historique de révisions complet dès le départ ? (reco : non, phase 3)

# Design: Collaboration Multi-Agents sur le Ticketing ASM

## Principe directeur

Le Kanban ASM est un **receptacle passif**. Il ne prescrit aucun workflow, aucun role, aucun pipeline. L'intelligence d'orchestration est **entierement externe** : un agent chef de projet (ou tout autre systeme) lit les tickets, decide qui mentionner, quand changer un statut, quel livrable demander. ASM fournit les primitives — discussion, mentions, livrables, notifications — et les agents s'en servent librement.

## Ce qui existe deja

| Capacite | API | Detail |
|----------|-----|--------|
| Auth agent | `Bearer token` + `X-Agent-Name` | Token SHA256, header identite |
| CRUD tickets | `GET/POST/PATCH/DELETE /api/agents/v1/tickets` | Complet |
| Assignation | `PATCH /tickets/:id/assign` | Label assignee, pas de changement statut |
| Claim/Unclaim | `PATCH /tickets/:id/claim` | Self-assignment + auto-move doing + timestamp |
| Statut | `PATCH /tickets/:id` | L'agent change le statut librement |
| WebSocket | `/ws/tickets` | Broadcast de tous les events tickets (non auth) |
| Activity log | `GET /tickets/:id/activity` | Audit trail des changements |
| Next ticket | `GET /tickets/next` | Prochain ticket non assigne |
| Pending | `GET /tickets/pending` | Tickets reclames par l'agent appelant |

**Ce qui manque** : discussion interne, mentions, livrables, notifications ciblees, contexte agrege.

---

## 1. Modele de donnees

### 1.1 TicketComment (nouveau)

Fil de discussion par ticket. Tous les echanges entre agents passent par la.

```typescript
// packages/shared/src/types/ticket.ts

export type CommentVisibility = 'public' | 'private';

export interface TicketComment {
  readonly id: string;
  readonly ticketId: string;
  readonly authorType: 'user' | 'agent';
  readonly authorName: string;
  readonly body: string;                    // markdown, peut contenir des @agent:xxx
  readonly visibility: CommentVisibility;   // public = tout le monde, private = destinataires seulement
  readonly privateRecipients: string[];     // si private : noms des agents destinataires
  readonly mentions: string[];              // extrait auto du body : noms des agents mentionnes
  readonly parentId: string | null;         // reponse threadee (null = top-level)
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

**Stockage** : `~/.asm/projects/comments.json`

**Logique cle** : a la creation d'un commentaire, le body est parse pour extraire les patterns `@agent:<name>`. Chaque match genere un `TicketMention`.

### 1.2 TicketMention (nouveau)

Une mention est une **demande d'input** adressée a un agent specifique. Elle a un cycle de vie : creee automatiquement quand un agent est mentionne dans un commentaire, resolue quand l'agent cible repond.

```typescript
export type MentionStatus = 'pending' | 'acknowledged' | 'resolved';

export interface TicketMention {
  readonly id: string;
  readonly ticketId: string;
  readonly commentId: string;               // commentaire source (celui qui contient le @agent:xxx)
  readonly targetAgent: string;             // agent mentionne
  readonly sourceAgent: string;             // agent qui a mentionne
  readonly status: MentionStatus;
  readonly resolvedAt: string | null;
  readonly resolvedCommentId: string | null; // le commentaire qui repond a la mention
  readonly createdAt: string;
}
```

**Stockage** : `~/.asm/projects/mentions.json`

**Cycle de vie** :
- `pending` : l'agent est mentionne, il n'a pas encore reagi
- `acknowledged` : l'agent a vu la mention (optionnel, utile pour le monitoring)
- `resolved` : l'agent a fourni sa reponse — pointe vers le commentaire de reponse

Un meme agent peut avoir **plusieurs mentions en parallele** sur le meme ticket (ex: le chef de projet le mentionne 3 fois sur 3 sujets differents). Chaque mention est independante.

### 1.3 TicketDeliverable (nouveau)

Un livrable est un **output structure** produit par un agent. Pas de type impose — c'est l'agent qui decide de son type et contenu. Le chef de projet peut demander un livrable specifique via un commentaire+mention, et l'agent le poste quand il est pret.

```typescript
export interface TicketDeliverable {
  readonly id: string;
  readonly ticketId: string;
  readonly agentName: string;               // qui l'a produit
  readonly type: string;                    // type libre choisi par l'agent : 'prd', 'wireframe', 'code-review', ...
  readonly title: string;
  readonly content: string;                 // markdown ou JSON stringifie
  readonly version: number;                 // auto-incremente a chaque mise a jour du content
  readonly status: 'draft' | 'final';       // l'agent marque final quand il considere que c'est pret
  readonly mentionId: string | null;        // optionnel : lien vers la mention qui a demande ce livrable
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

**Stockage** : `~/.asm/projects/deliverables.json`

**Pas de contrainte de role** : n'importe quel agent peut poster n'importe quel type de livrable. C'est le chef de projet agent qui decide si le livrable est satisfaisant et fait avancer le ticket.

### 1.4 Modifications du Ticket existant

Ajout minimal au `Ticket` existant :

```typescript
export interface Ticket {
  // ... champs existants inchanges ...
  readonly pendingMentionCount: number;     // denormalise : nombre de mentions non resolues sur ce ticket
}
```

C'est le seul ajout. Pas de `pipelineId`, pas de `currentAgentRole`. Le ticket ne sait rien de l'orchestration. Le `pendingMentionCount` est un compteur denormalise pour afficher rapidement dans l'UI si un ticket attend des reponses.

---

## 2. API Endpoints

Tous sous le prefix existant `/api/agents/v1/` (authentifie par Bearer token).

### 2.1 Comments (Discussion)

```
GET    /tickets/:id/comments
       Query: ?visibility=public|private&since=<ISO>&limit=50&parentId=<id>
       Note: les commentaires private sont filtres — un agent ne voit que ceux
             dont il est auteur ou destinataire

POST   /tickets/:id/comments
       Body: { body: string, visibility?: 'public'|'private', privateRecipients?: string[], parentId?: string }
       Retour: TicketComment + mentions creees
       Effet de bord: parse le body, cree un TicketMention par @agent:xxx trouve

PATCH  /tickets/:id/comments/:commentId
       Body: { body: string }
       Note: auteur seulement. Re-parse les mentions (supprime les anciennes, cree les nouvelles)

DELETE /tickets/:id/comments/:commentId
       Note: auteur seulement. Les mentions associees passent a 'resolved' (annulees)
```

### 2.2 Mentions

```
GET    /mentions/pending
       Retour: TicketMention[] pour l'agent appelant (toutes les mentions pending/acknowledged)
       Query: ?ticket_id=<id>
       C'est le endpoint de polling principal pour un agent : "ai-je des demandes en attente ?"

GET    /tickets/:id/mentions
       Retour: toutes les mentions du ticket (toutes statuts)
       Query: ?status=pending|acknowledged|resolved&target_agent=<name>&source_agent=<name>

PATCH  /mentions/:id/acknowledge
       Effet: pending -> acknowledged
       Usage: l'agent signale qu'il a vu la demande et qu'il va y repondre

PATCH  /mentions/:id/resolve
       Body: { commentId?: string, deliverableId?: string }
       Effet: -> resolved, lie le commentaire ou livrable de reponse
       Note: seul l'agent cible (targetAgent) peut resoudre sa propre mention
```

### 2.3 Deliverables (Livrables)

```
GET    /tickets/:id/deliverables
       Query: ?agent_name=<name>&type=<type>&status=draft|final

POST   /tickets/:id/deliverables
       Body: { type: string, title: string, content: string, status?: 'draft'|'final', mentionId?: string }
       Note: agentName est deduit du token/header

PATCH  /tickets/:id/deliverables/:delivId
       Body: { title?: string, content?: string, status?: 'draft'|'final' }
       Note: si content change, version s'incremente. Auteur seulement.

GET    /tickets/:id/deliverables/:delivId
       Retour: detail complet du livrable
```

### 2.4 Context (vue synthetique)

```
GET    /tickets/:id/context
```

Retourne tout le contexte du ticket en un appel :

```typescript
interface TicketContext {
  ticket: Ticket;                           // le ticket avec ses champs existants
  comments: TicketComment[];                // N derniers commentaires publics (default 50) + tous les private pour l'agent
  mentions: {
    pending: TicketMention[];               // mentions en attente pour l'agent appelant sur ce ticket
    all: TicketMention[];                   // toutes les mentions du ticket (overview)
  };
  deliverables: TicketDeliverable[];        // tous les livrables du ticket
  activity: TicketActivity[];               // N dernieres entrees d'activite
}
```

C'est le **point d'entree principal** pour un agent qui debarque sur un ticket. Il obtient en un call tout ce dont il a besoin pour comprendre le contexte, voir ce qu'on lui demande, et decider de sa reponse.

Query optionnels : `?comments_limit=50&activity_limit=20`

---

## 3. WebSocket — Notifications ciblees

### 3.1 Nouveaux types de messages sur `/ws/tickets` (broadcast)

Extension des types existants pour l'UI web :

```typescript
export type TicketWsMessageType =
  | 'ticket:created' | 'ticket:updated' | 'ticket:deleted' | 'ticket:moved'  // existants
  | 'board:updated'                                                           // existant
  | 'comment:created' | 'comment:updated' | 'comment:deleted'                // nouveau
  | 'mention:created' | 'mention:acknowledged' | 'mention:resolved'          // nouveau
  | 'deliverable:created' | 'deliverable:updated';                           // nouveau
```

### 3.2 WebSocket agent authentifie (nouveau endpoint)

```
/ws/agents?token=<bearer_token>
```

Comportement :
- **Authentification** : valide le token a la connexion, rejette si invalide
- **Filtrage** : l'agent ne recoit que les events qui le concernent :
  - `mention:created` ou il est `targetAgent`
  - `comment:created` sur les tickets ou il est assigne, ou s'il est dans `privateRecipients`
  - `deliverable:created` sur les tickets ou il est assigne
  - `ticket:updated` sur les tickets ou il est assigne
- **Subscription dynamique** : l'agent peut envoyer un message pour s'abonner a des tickets supplementaires :
  ```json
  { "action": "subscribe", "ticketIds": ["uuid-1", "uuid-2"] }
  { "action": "unsubscribe", "ticketIds": ["uuid-1"] }
  ```

Message format :

```typescript
interface AgentWsMessage {
  type: string;                // ex: 'mention:created', 'comment:created'
  ticketId: string;
  data: TicketMention | TicketComment | TicketDeliverable | Ticket;
}
```

### 3.3 Fallback polling

Pour les agents sans WebSocket permanent :
- `GET /mentions/pending` — "ai-je des demandes en attente ?"
- `GET /tickets/pending` — "quels tickets ai-je claim ?"
- Polling recommande : toutes les 10-30s

---

## 4. Securite et controle d'acces

### 4.1 Pas de changement d'auth

On reutilise le systeme existant tel quel :
- Bearer token pour l'authentification
- `X-Agent-Name` pour l'identite
- Pas de roles, pas de permissions par role

### 4.2 Regles de scope (simples)

| Action | Qui peut |
|--------|----------|
| Lire commentaires publics | Tout agent authentifie |
| Lire commentaires prives | Auteur + agents dans `privateRecipients` |
| Editer/supprimer commentaire | Auteur seulement |
| Resoudre une mention | Agent cible (`targetAgent`) seulement |
| Editer un livrable | Auteur (`agentName`) seulement |
| Changer statut ticket | Tout agent authentifie |
| Assigner un ticket | Tout agent authentifie |
| Claim un ticket | Tout agent authentifie (self-assign) |

Pas de restriction par role. Tout agent authentifie peut tout lire (sauf private) et tout faire sur les tickets. La discipline vient de l'orchestrateur externe (le chef de projet agent), pas du systeme.

### 4.3 Audit

Toutes les actions sont tracees dans l'activity log existant avec de nouvelles actions :
- `'commented'` — commentaire poste
- `'mentioned'` — mention creee
- `'mention_resolved'` — mention resolue
- `'deliverable_submitted'` — livrable poste
- `'deliverable_updated'` — livrable mis a jour

---

## 5. Scenario complet (agent chef de projet comme orchestrateur)

```
1.  [humain]          Cree un ticket "Ajouter l'export CSV des rapports"
                      Statut: backlog, description du besoin

2.  [chef-de-projet]  Poll GET /tickets?status=backlog → voit le nouveau ticket
                      GET /tickets/:id/context → lit le besoin
                      POST /tickets/:id/comments →
                        "@agent:user-researcher Analyse le besoin utilisateur pour l'export CSV.
                         Qui sont les utilisateurs cibles ? Quels formats ? Quelles donnees ?"
                      PATCH /tickets/:id → { status: 'doing' }

3.  [systeme]         Cree une mention pending pour user-researcher
                      Broadcast mention:created via WS agent

4.  [user-researcher] Recoit notification (WS ou polling GET /mentions/pending)
                      GET /tickets/:id/context → comprend le ticket et la demande
                      PATCH /mentions/:id/acknowledge → "je bosse dessus"
                      ... travaille ...
                      POST /tickets/:id/deliverables →
                        { type: "user-research", title: "Analyse utilisateur export CSV", content: "...", status: "final" }
                      POST /tickets/:id/comments →
                        "@agent:chef-de-projet Voici mon analyse. 3 personas identifies, format CSV + Excel souhaite."
                      PATCH /mentions/:id/resolve → { deliverableId: "..." }

5.  [chef-de-projet]  Recoit notification (mention resolue + nouveau commentaire)
                      GET /tickets/:id/context → voit le livrable
                      Decide que c'est suffisant pour passer au PM
                      POST /tickets/:id/comments →
                        "@agent:pm Redige le PRD a partir de l'analyse user research (voir livrable).
                         Focus sur les contraintes de volume de donnees."

6.  [pm]              Recoit notification, lit le contexte, voit le livrable user-research
                      Travaille, a une question :
                      POST /tickets/:id/comments →
                        "@agent:user-researcher Quelle est la taille max de dataset chez les users B2B ?"
                      → Cree une 2e mention pour user-researcher (independante de la 1ere, deja resolue)

7.  [user-researcher] Recoit la notification, repond :
                      POST /tickets/:id/comments → "Jusqu'a 500k lignes pour les gros comptes."
                      PATCH /mentions/:id/resolve → { commentId: "..." }

8.  [pm]              Continue, soumet le PRD
                      POST /tickets/:id/deliverables → { type: "prd", ... status: "final" }
                      POST /tickets/:id/comments → "@agent:chef-de-projet PRD finalise."
                      PATCH /mentions/:id/resolve

9.  [chef-de-projet]  Lit le PRD, decide d'envoyer en parallele au designer et a l'archi :
                      POST /tickets/:id/comments →
                        "@agent:designer Propose les maquettes pour l'ecran d'export.
                         @agent:architect Definis l'architecture technique (voir PRD)."
                      → 2 mentions creees en parallele

10. [designer]        Repond avec un livrable wireframe
11. [architect]       Repond avec un livrable tech-spec

12. [chef-de-projet]  Les 2 mentions sont resolues. Decide de passer au dev :
                      POST /tickets/:id/comments →
                        "@agent:dev Implemente l'export CSV. Specs : voir PRD + tech-spec."
                      PATCH /tickets/:id → { status: 'reviewing' } (quand le dev a fini)

    ... et ainsi de suite, le chef de projet orchestre dynamiquement ...
```

**Point cle** : a aucun moment le systeme ASM ne decide de l'enchainement. C'est l'agent chef de projet qui lit, decide, mentionne. ASM fournit juste les tuyaux.

---

## 6. Plan d'implementation

### Phase 1 — Fondations (entites + stockage)

| Action | Fichier |
|--------|---------|
| Modifier | `packages/shared/src/types/ticket.ts` — ajouter `TicketComment`, `TicketMention`, `TicketDeliverable`, `CommentVisibility`, `MentionStatus`, `pendingMentionCount` au `Ticket` |
| Creer | `packages/server/src/domain/entities/ticket-comment.entity.ts` |
| Creer | `packages/server/src/domain/entities/ticket-mention.entity.ts` |
| Creer | `packages/server/src/domain/entities/ticket-deliverable.entity.ts` |
| Creer | `packages/server/src/infrastructure/adapters/json-comment-store.adapter.ts` |
| Creer | `packages/server/src/infrastructure/adapters/json-mention-store.adapter.ts` |
| Creer | `packages/server/src/infrastructure/adapters/json-deliverable-store.adapter.ts` |
| Modifier | `packages/server/src/domain/entities/ticket.entity.ts` — ajouter `pendingMentionCount` |
| Modifier | `packages/server/src/infrastructure/container.ts` — injecter les 3 nouveaux stores |

### Phase 2 — Use cases

| Action | Fichier |
|--------|---------|
| Creer | `packages/server/src/application/use-cases/post-comment.ts` — parse `@agent:xxx`, cree les mentions, met a jour `pendingMentionCount` |
| Creer | `packages/server/src/application/use-cases/resolve-mention.ts` — lie le commentaire/livrable de reponse, decremente `pendingMentionCount` |
| Creer | `packages/server/src/application/use-cases/submit-deliverable.ts` |
| Creer | `packages/server/src/application/use-cases/get-ticket-context.ts` — agrege ticket + comments + mentions + deliverables + activity |

### Phase 3 — Routes API agent

| Action | Fichier |
|--------|---------|
| Creer | `packages/server/src/infrastructure/http/agent-comments.routes.ts` |
| Creer | `packages/server/src/infrastructure/http/agent-mentions.routes.ts` |
| Creer | `packages/server/src/infrastructure/http/agent-deliverables.routes.ts` |
| Creer | `packages/server/src/infrastructure/http/agent-context.routes.ts` |
| Modifier | `packages/server/src/main.ts` — enregistrer les nouvelles routes sous `/api/agents/v1/` |

### Phase 4 — WebSocket agent authentifie

| Action | Fichier |
|--------|---------|
| Creer | `packages/server/src/infrastructure/ws/agent-ws.ts` — auth, filtrage, subscription dynamique |
| Modifier | `packages/server/src/infrastructure/ws/ticket-ws.ts` — emettre les nouveaux types d'events |
| Modifier | `packages/shared/src/types/websocket.ts` — nouveaux types |
| Modifier | `packages/shared/src/constants.ts` — nouveau path WS |
| Modifier | `packages/server/src/main.ts` — enregistrer le plugin WS agent |

### Phase 5 — Frontend (monitoring, optionnel)

| Action | Fichier |
|--------|---------|
| Modifier | Vue ticket — onglet "Discussion" avec les commentaires |
| Modifier | Vue ticket — section "Livrables" |
| Modifier | Vue ticket — indicateur de mentions pendantes |

---

## 7. Ce qu'on ne fait PAS

- **Pas de pipeline/workflow** dans ASM. L'orchestration est externe.
- **Pas de roles** dans ASM. Un agent est juste un nom (`X-Agent-Name`). C'est l'orchestrateur qui sait quel agent fait quoi.
- **Pas de registre d'agents** dans ASM. ASM ne sait pas quels agents existent. Il voit juste des noms dans les tokens.
- **Pas d'auto-avancement de statut**. Seul un agent (ou l'UI) change le statut d'un ticket via `PATCH`.
- **Pas de base de donnees**. On reste sur JSON. Migration future vers SQLite si besoin.
- **Pas de file d'attente**. WebSocket + polling. Si un agent est offline, ses mentions restent `pending`.
- **Pas de LLM integre**. ASM ne raisonne pas. Les agents sont des clients externes.

---

## 8. Questions ouvertes

1. **Escalation timeout** : faut-il un mecanisme cote ASM pour signaler qu'une mention est `pending` depuis trop longtemps ? (ex: champ `staleSince` apres X minutes). Ou c'est le chef de projet agent qui gere ca en lisant les timestamps ?
2. **Sous-tickets** : un agent devrait-il pouvoir creer des sous-tickets lies au ticket parent ? (le modele de `links` existant le permettrait avec un type `'child_ticket'`)
3. **Historique des livrables** : garder toutes les versions (append-only) ou seulement la derniere (in-place update) ?
4. **Taille des commentaires/livrables** : faut-il une limite ? Le stockage JSON rend les gros contenus couteux en I/O.
5. **Cleanup** : faut-il un mecanisme de purge pour les vieux commentaires/mentions resolues ?

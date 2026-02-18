# Design: Orchestration Multi-Agents sur le Ticketing ASM

## Contexte

ASM dispose aujourd'hui d'un socle ticketing fonctionnel avec une API agent authentifiee (Bearer token + `X-Agent-Name`), un systeme d'assignation/claim, du WebSocket temps reel, et un activity log par ticket. L'objectif est d'etendre ce socle pour permettre a des agents IA autonomes de collaborer sur un ticket a travers un workflow sequentiel (user researcher -> PM -> designer -> archi -> dev -> code quality -> QA -> chef de projet), avec discussions internes, mentions, livrables structures et notifications ciblees.

---

## 1. Modele de donnees

### 1.1 TicketComment (nouveau)

Fil de discussion interne par ticket. Chaque message est un commentaire.

```typescript
// packages/shared/src/types/ticket.ts

export type CommentVisibility = 'public' | 'private';

export interface TicketComment {
  readonly id: string;
  readonly ticketId: string;
  readonly authorType: 'user' | 'agent';
  readonly authorName: string;
  readonly body: string;                    // contenu markdown
  readonly visibility: CommentVisibility;   // public = visible par tous, private = visible uniquement par les destinataires
  readonly privateRecipients: string[];     // noms d'agents destinataires si visibility = private
  readonly mentions: string[];              // noms d'agents mentionnes (@agent:designer)
  readonly parentId: string | null;         // pour les reponses threadees (optionnel, null = top-level)
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

**Stockage** : `~/.asm/projects/comments.json` — fichier JSON separe pour ne pas alourdir tickets.json.

### 1.2 TicketMention (nouveau)

Systeme de mentions resolvables. Quand un agent est mentionne, une mention est creee. L'agent la traite, puis la resout.

```typescript
// packages/shared/src/types/ticket.ts

export type MentionStatus = 'pending' | 'acknowledged' | 'resolved';

export interface TicketMention {
  readonly id: string;
  readonly ticketId: string;
  readonly commentId: string;            // commentaire d'origine
  readonly targetAgent: string;          // agent mentionne
  readonly sourceAgent: string;          // agent qui a mentionne
  readonly status: MentionStatus;
  readonly resolvedAt: string | null;
  readonly resolvedCommentId: string | null;  // commentaire de resolution (le livrable/la reponse)
  readonly createdAt: string;
}
```

**Stockage** : `~/.asm/projects/mentions.json`

### 1.3 TicketDeliverable (nouveau)

Livrable structure produit par un agent pour un ticket. Chaque agent dans le pipeline produit un ou plusieurs livrables types.

```typescript
// packages/shared/src/types/ticket.ts

export interface TicketDeliverable {
  readonly id: string;
  readonly ticketId: string;
  readonly agentRole: string;            // 'user-researcher' | 'pm' | 'designer' | 'architect' | 'dev' | 'code-quality' | 'qa' | 'project-manager'
  readonly agentName: string;            // nom de l'agent qui l'a produit
  readonly type: string;                 // type libre: 'user-research-report', 'prd', 'wireframe', 'tech-spec', 'code-diff', 'review-report', 'test-plan', 'status-update'
  readonly title: string;
  readonly content: string;              // contenu markdown ou JSON stringifie
  readonly attachments: DeliverableAttachment[];
  readonly version: number;              // versionning simple (1, 2, 3...)
  readonly status: 'draft' | 'final';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DeliverableAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly path: string;                 // chemin local relatif dans ~/.asm/deliverables/<ticketId>/
  readonly size: number;
}
```

**Stockage** :
- Metadonnees : `~/.asm/projects/deliverables.json`
- Fichiers : `~/.asm/deliverables/<ticketId>/<deliverableId>/<filename>`

### 1.4 TicketPipeline (nouveau)

Definition du workflow sequentiel pour un ticket. Chaque etape est une phase avec un agent role assigne.

```typescript
// packages/shared/src/types/ticket.ts

export type PipelineStepStatus = 'pending' | 'active' | 'blocked' | 'completed' | 'skipped';

export interface PipelineStep {
  readonly id: string;
  readonly agentRole: string;            // role attendu
  readonly assignedAgent: string | null; // agent specifique assigne (ou null = n'importe quel agent de ce role)
  readonly status: PipelineStepStatus;
  readonly requiredDeliverables: string[];  // types de livrables attendus pour considerer l'etape complete
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface TicketPipeline {
  readonly id: string;
  readonly ticketId: string;
  readonly steps: PipelineStep[];
  readonly currentStepIndex: number;     // -1 = pas commence, 0..n = etape en cours
  readonly status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

**Stockage** : `~/.asm/projects/pipelines.json`

### 1.5 Modifications du Ticket existant

Ajout de champs au `Ticket` existant :

```typescript
// Ajouts a l'interface Ticket existante
export interface Ticket {
  // ... champs existants ...
  readonly pipelineId: string | null;          // reference vers le pipeline actif
  readonly currentAgentRole: string | null;    // role de l'agent actuellement attendu
  readonly pendingMentionCount: number;        // nombre de mentions non resolues (denormalise pour perf)
}
```

### 1.6 AgentProfile (nouveau)

Registre des agents connus et de leurs roles/capacites.

```typescript
// packages/shared/src/types/ticket.ts

export interface AgentProfile {
  readonly name: string;               // identifiant unique (= X-Agent-Name)
  readonly roles: string[];            // roles que cet agent peut remplir
  readonly description: string;        // description pour les autres agents
  readonly status: 'online' | 'offline' | 'busy';
  readonly lastSeenAt: string;
  readonly settings: Record<string, unknown>;  // config specifique a l'agent
}
```

**Stockage** : `~/.asm/agents.json`

---

## 2. API Endpoints

Tous sous le prefix existant `/api/agents/v1/` (authentifie par Bearer token).

### 2.1 Comments (Discussion interne)

```
GET    /tickets/:id/comments                    → liste les commentaires du ticket
       Query: ?visibility=public|private          (filtre optionnel)
       Note: un agent ne voit les messages private que s'il est dans privateRecipients
POST   /tickets/:id/comments                    → creer un commentaire
       Body: { body, visibility?, privateRecipients?, parentId? }
       Note: les mentions @agent:xxx sont extraites automatiquement du body
PATCH  /tickets/:id/comments/:commentId         → editer un commentaire (auteur only)
       Body: { body }
DELETE /tickets/:id/comments/:commentId         → supprimer (auteur only)
```

### 2.2 Mentions

```
GET    /mentions/pending                         → mentions en attente pour l'agent appelant
       Query: ?ticket_id=xxx                      (filtre optionnel)
GET    /tickets/:id/mentions                     → toutes les mentions d'un ticket
PATCH  /mentions/:id/acknowledge                 → passer de pending a acknowledged
PATCH  /mentions/:id/resolve                     → resoudre la mention
       Body: { commentId? }                       (commentaire de reponse optionnel)
```

### 2.3 Deliverables (Livrables)

```
GET    /tickets/:id/deliverables                 → livrables du ticket
       Query: ?agent_role=xxx&type=xxx            (filtres optionnels)
POST   /tickets/:id/deliverables                 → soumettre un livrable
       Body: { agentRole, type, title, content, status? }
PATCH  /tickets/:id/deliverables/:delivId        → mettre a jour un livrable
       Body: { content?, title?, status? }
       Note: incremente automatiquement la version si content change
GET    /tickets/:id/deliverables/:delivId        → detail d'un livrable
```

### 2.4 Pipeline (Workflow)

```
POST   /tickets/:id/pipeline                     → creer/attacher un pipeline au ticket
       Body: { steps: [{ agentRole, assignedAgent?, requiredDeliverables? }] }
GET    /tickets/:id/pipeline                     → etat du pipeline
PATCH  /tickets/:id/pipeline/advance             → avancer a l'etape suivante
       Note: verifie que les livrables requis sont fournis et marques 'final'
PATCH  /tickets/:id/pipeline/steps/:stepId       → modifier une etape
       Body: { status?, assignedAgent? }
```

### 2.5 Agent Profiles

```
GET    /agents                                   → liste des agents enregistres
GET    /agents/:name                             → profil d'un agent
PUT    /agents/me                                → creer/mettre a jour son propre profil
       Body: { roles, description, settings? }
       Note: le nom est deduit du token/header X-Agent-Name
```

### 2.6 Context Window (vue synthetique)

```
GET    /tickets/:id/context                      → contexte complet du ticket
```

Retourne un objet agrege :

```typescript
interface TicketContext {
  ticket: Ticket;
  pipeline: TicketPipeline | null;
  deliverables: TicketDeliverable[];
  recentComments: TicketComment[];       // 50 derniers commentaires publics
  pendingMentions: TicketMention[];      // mentions en attente pour l'agent appelant
  relatedAgents: AgentProfile[];         // agents impliques dans le pipeline
}
```

C'est le **point d'entree principal** pour un agent qui arrive sur un ticket. Il obtient tout le contexte en un seul appel, ce qui est essentiel pour limiter le nombre de requetes et remplir efficacement sa context window.

---

## 3. WebSocket — Notifications ciblees

### 3.1 Extension du protocol WebSocket tickets

Nouveaux types de messages :

```typescript
export type TicketWsMessageType =
  // ... existants ...
  | 'comment:created'
  | 'comment:updated'
  | 'comment:deleted'
  | 'mention:created'
  | 'mention:resolved'
  | 'deliverable:created'
  | 'deliverable:updated'
  | 'pipeline:advanced'
  | 'pipeline:step_changed'
  | 'agent:status_changed';
```

### 3.2 WebSocket agent authentifie (nouveau)

Aujourd'hui, le WebSocket `/ws/tickets` est ouvert sans auth (usage dashboard web). Pour les agents, un nouveau endpoint :

```
/ws/agents?token=<bearer_token>
```

Ce WebSocket :
- Authentifie l'agent via le token
- Filtre les messages : l'agent ne recoit que les events des tickets ou il est assigne/mentionne/dans le pipeline
- Envoie des notifications ciblees :
  - `mention:created` quand il est mentionne
  - `pipeline:your_turn` quand c'est son tour dans le pipeline
  - `comment:private` quand il recoit un message prive

Message type pour notification directe :

```typescript
interface AgentNotification {
  type: 'mention:created' | 'pipeline:your_turn' | 'comment:private';
  ticketId: string;
  data: TicketMention | PipelineStep | TicketComment;
  urgency: 'low' | 'normal' | 'high';
}
```

### 3.3 Fallback polling

Pour les agents qui ne maintiennent pas de connexion WebSocket permanente, les endpoints REST suffisent :
- `GET /mentions/pending` (polling)
- `GET /tickets/pending` (deja existant)

---

## 4. Securite et controle d'acces

### 4.1 Visibilite des commentaires

- `public` : visible par tous les agents et l'UI web
- `private` : visible uniquement par `privateRecipients` et l'auteur
- L'API filtre automatiquement selon l'identite de l'agent appelant

### 4.2 Scope des operations

- Un agent ne peut **editer/supprimer** que ses propres commentaires
- Un agent ne peut **resoudre** que les mentions qui le ciblent
- Un agent ne peut **soumettre un livrable** que pour son propre role dans le pipeline
- Un agent ne peut **avancer le pipeline** que s'il est assigne a l'etape courante

### 4.3 Pas de nouveau mecanisme d'auth

On reutilise le systeme existant : Bearer token + `X-Agent-Name`. Le header `X-Agent-Name` sert de facto d'identite agent. Pas de changement a `agent-auth.hook.ts`.

### 4.4 Audit

Toutes les actions sont tracees dans l'activity log existant (`TicketActivity`) avec :
- `actorType: 'agent'`
- `actorName: <X-Agent-Name>`
- Nouvelles actions : `'commented'`, `'mentioned'`, `'delivered'`, `'pipeline_advanced'`

---

## 5. Pipeline : cycle de vie

### 5.1 Creation

Un agent (ou l'UI) cree un pipeline avec les etapes ordonnees :

```json
{
  "steps": [
    { "agentRole": "user-researcher", "requiredDeliverables": ["user-research-report"] },
    { "agentRole": "pm", "requiredDeliverables": ["prd"] },
    { "agentRole": "designer", "requiredDeliverables": ["wireframe"] },
    { "agentRole": "architect", "requiredDeliverables": ["tech-spec"] },
    { "agentRole": "dev", "requiredDeliverables": ["code-diff"] },
    { "agentRole": "code-quality", "requiredDeliverables": ["review-report"] },
    { "agentRole": "qa", "requiredDeliverables": ["test-plan"] },
    { "agentRole": "project-manager", "requiredDeliverables": ["status-update"] }
  ]
}
```

### 5.2 Avancement automatique

Quand un agent poste un livrable marque `final` correspondant aux `requiredDeliverables` de l'etape courante :
1. L'etape courante passe a `completed`
2. L'etape suivante passe a `active`
3. L'agent de l'etape suivante recoit une notification `pipeline:your_turn`
4. Le ticket `currentAgentRole` est mis a jour
5. Si un `assignedAgent` est defini pour l'etape, il est auto-assigne sur le ticket

### 5.3 Re-mention en cours de route

Un agent peut etre re-mentionne a n'importe quel moment (ex: le QA mentionne le dev pour un bug). Cela n'impacte pas la position du pipeline mais cree une mention `pending` que l'agent cible doit traiter. Le pipeline n'avance pas tant que toutes les mentions de l'etape courante ne sont pas resolues.

### 5.4 Blocage

Si une etape est marquee `blocked`, le pipeline s'arrete. Le project-manager recoit une notification. La resolution se fait par discussion dans les commentaires + deblocage manuel.

---

## 6. Scenario complet (exemple)

```
1. [user/UI] Cree un ticket "Ajouter l'export CSV des rapports"
2. [user/UI] Attache un pipeline standard 8 etapes
3. [system] Notifie l'agent user-researcher → pipeline:your_turn
4. [user-researcher] GET /tickets/:id/context → obtient tout le contexte
5. [user-researcher] POST /tickets/:id/comments → "J'analyse les besoins utilisateur..."
6. [user-researcher] POST /tickets/:id/deliverables → soumet { type: "user-research-report", status: "final" }
7. [system] Pipeline avance → notifie l'agent PM
8. [pm] GET /tickets/:id/context → voit le research report dans deliverables
9. [pm] POST /tickets/:id/comments → "@agent:user-researcher peux-tu preciser le persona B2B ?"
10. [system] Cree une mention pending pour user-researcher
11. [user-researcher] Recoit notification mention:created
12. [user-researcher] POST /tickets/:id/comments → "Le persona B2B est..." (reponse)
13. [user-researcher] PATCH /mentions/:id/resolve → mention resolue
14. [pm] Continue son travail, soumet le PRD
15. [system] Pipeline avance vers designer...
    ...
16. [qa] POST /tickets/:id/comments → "@agent:dev regression sur le parsing des dates"
17. [dev] Recoit notification, repond, fixe
18. [qa] PATCH /mentions/:id/resolve, soumet test-plan final
19. [system] Pipeline avance vers project-manager
20. [project-manager] Soumet status-update final → pipeline completed → ticket passe en "done"
```

---

## 7. Plan d'implementation

L'implementation suit l'architecture DDD existante du projet.

### Phase 1 — Fondations (modeles + stockage)

Fichiers a creer/modifier :

| Action | Fichier |
|--------|---------|
| Creer | `packages/shared/src/types/ticket.ts` — ajouter les interfaces Comment, Mention, Deliverable, Pipeline, AgentProfile |
| Creer | `packages/server/src/domain/entities/ticket-comment.entity.ts` |
| Creer | `packages/server/src/domain/entities/ticket-mention.entity.ts` |
| Creer | `packages/server/src/domain/entities/ticket-deliverable.entity.ts` |
| Creer | `packages/server/src/domain/entities/ticket-pipeline.entity.ts` |
| Creer | `packages/server/src/domain/entities/agent-profile.entity.ts` |
| Creer | `packages/server/src/infrastructure/adapters/json-comment-store.adapter.ts` |
| Creer | `packages/server/src/infrastructure/adapters/json-mention-store.adapter.ts` |
| Creer | `packages/server/src/infrastructure/adapters/json-deliverable-store.adapter.ts` |
| Creer | `packages/server/src/infrastructure/adapters/json-pipeline-store.adapter.ts` |
| Creer | `packages/server/src/infrastructure/adapters/json-agent-profile-store.adapter.ts` |
| Modifier | `packages/server/src/domain/entities/ticket.entity.ts` — ajouter `pipelineId`, `currentAgentRole`, `pendingMentionCount` |
| Modifier | `packages/server/src/infrastructure/container.ts` — injecter les nouveaux stores |

### Phase 2 — Use cases (logique metier)

| Action | Fichier |
|--------|---------|
| Creer | `packages/server/src/application/use-cases/post-comment.ts` — extraction auto des mentions du body |
| Creer | `packages/server/src/application/use-cases/resolve-mention.ts` |
| Creer | `packages/server/src/application/use-cases/submit-deliverable.ts` — verification du role pipeline |
| Creer | `packages/server/src/application/use-cases/advance-pipeline.ts` — logique d'avancement auto |
| Creer | `packages/server/src/application/use-cases/create-pipeline.ts` |
| Creer | `packages/server/src/application/use-cases/get-ticket-context.ts` — agregation du contexte complet |

### Phase 3 — Routes API

| Action | Fichier |
|--------|---------|
| Modifier | `packages/server/src/infrastructure/http/agent-api.routes.ts` — ajouter tous les endpoints sections 2.1-2.6 |
| Alternative | Creer des fichiers de routes separes par domaine si le fichier devient trop gros : `agent-comments.routes.ts`, `agent-mentions.routes.ts`, `agent-deliverables.routes.ts`, `agent-pipeline.routes.ts`, `agent-profiles.routes.ts` |

### Phase 4 — WebSocket agent

| Action | Fichier |
|--------|---------|
| Creer | `packages/server/src/infrastructure/ws/agent-ws.ts` — WebSocket authentifie avec filtrage par agent |
| Modifier | `packages/server/src/infrastructure/ws/ticket-ws.ts` — ajouter les nouveaux types de messages |
| Modifier | `packages/shared/src/types/websocket.ts` — nouveaux types WS |
| Modifier | `packages/server/src/main.ts` — enregistrer le nouveau plugin WS |

### Phase 5 — Frontend (optionnel, UI de monitoring)

| Action | Fichier |
|--------|---------|
| Modifier | Vue ticket existante — ajouter onglet "Discussion" avec les commentaires |
| Modifier | Vue ticket existante — ajouter section "Pipeline" avec progression visuelle |
| Modifier | Vue ticket existante — ajouter section "Livrables" |
| Creer | Page "Agents" pour voir les agents enregistres et leur statut |

---

## 8. Ce qu'on ne fait PAS (hors scope)

- **Pas de base de donnees** : on reste sur le stockage JSON existant. Pour une mise a l'echelle future, migrer vers SQLite ou PostgreSQL.
- **Pas d'orchestrateur centralisé** : chaque agent est autonome et reagit aux notifications. Le pipeline est une convention, pas un scheduler.
- **Pas de file d'attente** : pas de Redis/RabbitMQ. Les agents polled ou ecoutent le WS. Si un agent est offline, ses mentions restent `pending` jusqu'a son retour.
- **Pas de LLM intégré** : ASM ne contient pas de logique IA. Les agents sont des clients externes qui appellent l'API. La logique de raisonnement est du cote de l'agent.
- **Pas de gestion de conflits** : si deux agents modifient le meme livrable, last-write-wins (coherent avec le modele JSON actuel).

---

## 9. Questions ouvertes

1. **Templates de pipeline** : faut-il pouvoir sauvegarder des templates de pipeline reutilisables (ex: "standard feature pipeline 8 etapes") ?
2. **Escalation** : faut-il un mecanisme automatique d'escalation si une mention reste `pending` trop longtemps ?
3. **Sous-tickets** : un agent devrait-il pouvoir creer des sous-tickets pour deleguer une partie de son travail ?
4. **Permissions par role** : faut-il restreindre certaines actions a certains roles (ex: seul le PM peut modifier le PRD) ?
5. **Historique des livrables** : faut-il garder toutes les versions d'un livrable ou seulement la derniere ?

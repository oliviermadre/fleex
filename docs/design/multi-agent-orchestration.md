# Design: Collaboration Multi-Agents sur le Ticketing Fleex

## Principe directeur

Le Kanban Fleex est un **receptacle passif**. Il ne prescrit aucun workflow, aucun role, aucun pipeline. L'intelligence d'orchestration est **entierement externe** : un agent chef de projet (ou tout autre systeme) lit les tickets, decide qui mentionner, quand changer un statut, quel livrable demander. Fleex fournit les primitives — discussion, mentions, livrables, notifications — et les agents s'en servent librement.

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

**Stockage** : `~/.fleex/projects/comments.json`

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

**Stockage** : `~/.fleex/projects/mentions.json`

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

**Stockage** : `~/.fleex/projects/deliverables.json`

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

## 5. Simulation complete — Auto-clone repo a la creation de session

**Contexte** : les agents tournent en cronjob toutes les 5 minutes. L'humain discute avec l'agent project-manager sur Telegram. Le project-manager connait les agents : pm, designer, archi, dev, qa, business, marketing, user-researcher.

**Demande humain sur Telegram** : "Je veux que dans Fleex, quand on cree une session Claude, si le repo n'existe pas sur le filesystem, il soit automatiquement clone. Les regles habituelles de creation s'appliquent (main, PR, issue, fresh worktree)."

Tous les headers sont omis pour lisibilite. Chaque agent envoie :
- `Authorization: Bearer fleex_<token>`
- `X-Agent-Name: <nom>`

---

### T+0min — project-manager (via Telegram, hors Fleex)

Le project-manager recoit le message Telegram, raisonne, et decide de creer un ticket dans Fleex.

```http
POST /api/agents/v1/tickets
X-Agent-Name: project-manager

{
  "boardId": "board-fleex-123",
  "title": "Auto-clone repo on session creation if not on filesystem",
  "description": "## Besoin\n\nLorsqu'un utilisateur cree une session Claude dans Fleex et que le repository cible n'existe pas encore sur le filesystem local, Fleex doit automatiquement cloner le repo avant de creer la session.\n\n## Contraintes\n- Les regles existantes de creation de session s'appliquent (main, PR, issue, fresh worktree)\n- Le clone doit utiliser les memes conventions que le systeme de worktrees actuel\n- Si le clone echoue (acces, reseau), la creation de session doit remonter une erreur claire\n\n## Origine\nDemande directe du product owner.",
  "status": "todo",
  "priority": "high",
  "tags": ["feature", "session", "repository"]
}
```

```json
← 201 { "id": "ticket-abc-001", "status": "todo", ... }
```

Le project-manager decide que c'est un sujet purement technique — pas besoin de user-researcher, designer, business, ni marketing. Il va impliquer : **archi** (analyser l'impact dans le code existant), puis **dev** (implementer), puis **qa** (valider).

Mais d'abord, il veut que le PM clarifie les specs fonctionnelles :

```http
POST /api/agents/v1/tickets/ticket-abc-001/comments
X-Agent-Name: project-manager

{
  "body": "@agent:pm J'ai besoin d'une spec fonctionnelle pour l'auto-clone de repo a la creation de session.\n\nContexte : quand un utilisateur cree une session Claude et que le repo n'est pas sur le FS, on veut cloner automatiquement.\n\nPoints a couvrir dans la spec :\n- Quel comportement exact selon le mode de creation (main, PR, issue, fresh worktree) ?\n- Que se passe-t-il si le clone echoue (timeout, auth, repo prive) ?\n- Faut-il un feedback utilisateur pendant le clone (c'est potentiellement long) ?\n- Le repo clone doit-il etre enregistre dans la config Fleex automatiquement ?"
}
```

```json
← 201 {
  "id": "comment-001",
  "mentions": ["pm"],
  "createdMentions": [
    { "id": "mention-001", "targetAgent": "pm", "sourceAgent": "project-manager", "status": "pending" }
  ]
}
```

```http
PATCH /api/agents/v1/tickets/ticket-abc-001
X-Agent-Name: project-manager

{ "status": "doing" }
```

Le project-manager a fini pour ce cycle. Il repond a l'humain sur Telegram : "J'ai cree le ticket FLEEX-001 et demande au PM de specifier. Je te tiens au courant."

---

### T+5min — cron de TOUS les agents

Chaque agent execute le meme code au demarrage de son cron :

```http
GET /api/agents/v1/mentions/pending
X-Agent-Name: <chaque-agent>
```

**Reponses :**

| Agent | Reponse |
|-------|---------|
| pm | `[{ "id": "mention-001", "ticketId": "ticket-abc-001", "sourceAgent": "project-manager", "status": "pending" }]` |
| archi | `[]` |
| dev | `[]` |
| qa | `[]` |
| designer | `[]` |
| user-researcher | `[]` |
| business | `[]` |
| marketing | `[]` |
| project-manager | `[]` |

Seul **pm** a du travail. Les 8 autres agents voient `[]`, **leur cron s'arrete la** — 1 seul call API, 0 travail.

**pm** a une mention pending. Il charge le contexte :

```http
GET /api/agents/v1/tickets/ticket-abc-001/context
X-Agent-Name: pm
```

```json
← 200 {
  "ticket": {
    "id": "ticket-abc-001",
    "title": "Auto-clone repo on session creation if not on filesystem",
    "description": "## Besoin\n\nLorsqu'un utilisateur...",
    "status": "doing",
    "assignee": null,
    ...
  },
  "comments": [
    {
      "id": "comment-001",
      "authorName": "project-manager",
      "body": "@agent:pm J'ai besoin d'une spec fonctionnelle pour l'auto-clone...",
      ...
    }
  ],
  "mentions": {
    "pending": [
      { "id": "mention-001", "targetAgent": "pm", "sourceAgent": "project-manager", "commentId": "comment-001" }
    ],
    "all": [
      { "id": "mention-001", ... }
    ]
  },
  "deliverables": [],
  "activity": [...]
}
```

Le pm a tout le contexte dans sa context window LLM. Il raisonne, redige la spec, et repond :

```http
PATCH /api/agents/v1/mentions/mention-001/acknowledge
X-Agent-Name: pm
```

```http
POST /api/agents/v1/tickets/ticket-abc-001/deliverables
X-Agent-Name: pm

{
  "type": "functional-spec",
  "title": "Spec fonctionnelle — Auto-clone repo",
  "content": "## Comportement par mode de creation\n\n### Mode `main`\nSi le repo org/name n'existe pas dans basePath :\n1. `git clone <remote> <basePath>/<org>/<name>`\n2. Checkout main\n3. Creer la session dans ce directory\n\n### Mode `PR`\nSi le repo n'existe pas :\n1. Clone comme ci-dessus\n2. Fetch la branche de la PR\n3. Creer un worktree pour cette branche\n4. Creer la session dans le worktree\n\n### Mode `issue`\nSi le repo n'existe pas :\n1. Clone\n2. Creer un worktree fresh depuis main avec le naming convention existant\n3. Creer la session\n\n### Mode `fresh worktree`\nIdentique a issue.\n\n## Gestion d'erreur\n- Clone timeout : 60s max, erreur explicite `CLONE_TIMEOUT`\n- Auth failure : remonter `CLONE_AUTH_FAILED` avec le message git\n- Repo inexistant : `REPOSITORY_NOT_FOUND`\n- Pas de place disque : `CLONE_DISK_FULL`\n\n## UX\n- La creation de session doit indiquer 'cloning repository...' comme statut intermediaire\n- Le repo clone est automatiquement ajoute a la config Fleex (repositories resolvees)\n\n## Hors scope\n- Pas de shallow clone pour l'instant\n- Pas de mirror/bare clone",
  "status": "final",
  "mentionId": "mention-001"
}
```

```json
← 201 { "id": "deliverable-001", "version": 1, ... }
```

```http
POST /api/agents/v1/tickets/ticket-abc-001/comments
X-Agent-Name: pm

{
  "body": "@agent:project-manager Spec fonctionnelle finalisee (voir livrable). Points cles :\n- 4 modes couverts (main, PR, issue, fresh worktree)\n- Gestion d'erreur explicite avec codes dedies\n- Le repo clone s'enregistre automatiquement dans la config Fleex\n- Statut intermediaire 'cloning...' cote UX"
}
```

```json
← 201 {
  "id": "comment-002",
  "createdMentions": [
    { "id": "mention-002", "targetAgent": "project-manager", "sourceAgent": "pm", "status": "pending" }
  ]
}
```

```http
PATCH /api/agents/v1/mentions/mention-001/resolve
X-Agent-Name: pm

{ "deliverableId": "deliverable-001" }
```

Le pm a fini. Mention resolue, livrable poste, project-manager notifie.

---

### T+10min — cron de tous les agents

```http
GET /api/agents/v1/mentions/pending
X-Agent-Name: <chaque-agent>
```

| Agent | Mentions pending |
|-------|-----------------|
| project-manager | `[{ "id": "mention-002", "ticketId": "ticket-abc-001", "sourceAgent": "pm" }]` |
| tous les autres | `[]` |

**project-manager** charge le contexte :

```http
GET /api/agents/v1/tickets/ticket-abc-001/context
X-Agent-Name: project-manager
```

Il voit maintenant : le ticket, les 2 commentaires, le livrable functional-spec du PM, la mention resolue du PM, et sa propre mention pending venant du PM.

Il lit la spec, la juge suffisante. Il decide de passer a l'archi et resout sa mention :

```http
PATCH /api/agents/v1/mentions/mention-002/resolve
X-Agent-Name: project-manager

{ "commentId": "comment-003" }
```

```http
POST /api/agents/v1/tickets/ticket-abc-001/comments
X-Agent-Name: project-manager

{
  "body": "@agent:archi Analyse l'impact technique de l'auto-clone dans le codebase Fleex.\n\nLa spec fonctionnelle est dans le livrable du PM (deliverable-001).\n\nJ'ai besoin de savoir :\n- Ou dans le code actuel faut-il intervenir ? (quels fichiers, quels use cases)\n- Le GitCliAdapter existant suffit-il pour le clone ou faut-il l'etendre ?\n- Y a-t-il des impacts sur le flow de creation de worktree existant ?\n- Quel est le risque de regression ?\n\nLivre-moi une tech spec."
}
```

```json
← 201 {
  "id": "comment-003",
  "createdMentions": [
    { "id": "mention-003", "targetAgent": "archi", "sourceAgent": "project-manager", "status": "pending" }
  ]
}
```

---

### T+15min — cron de tous les agents

| Agent | Mentions pending |
|-------|-----------------|
| archi | `[{ "id": "mention-003", "ticketId": "ticket-abc-001", "sourceAgent": "project-manager" }]` |
| tous les autres | `[]` |

**archi** charge le contexte :

```http
GET /api/agents/v1/tickets/ticket-abc-001/context
X-Agent-Name: archi
```

L'archi recoit dans sa context window : le ticket, les 3 commentaires, la spec fonctionnelle du PM, et la demande du project-manager. Il a toutes les infos pour travailler.

Il raisonne, analyse le code (en dehors de Fleex — c'est son LLM qui lit le codebase), et poste :

```http
PATCH /api/agents/v1/mentions/mention-003/acknowledge
X-Agent-Name: archi
```

```http
POST /api/agents/v1/tickets/ticket-abc-001/deliverables
X-Agent-Name: archi

{
  "type": "tech-spec",
  "title": "Tech spec — Auto-clone integration",
  "content": "## Points d'intervention\n\n### 1. CreateSessionFromTicketUseCase\nFichier: `packages/server/src/application/use-cases/create-session-from-ticket.ts`\nC'est le use case principal. Actuellement il determine le cwd via worktree ou basePath. Il faut ajouter une etape avant : verifier si le repo existe sur le FS, sinon cloner.\n\n### 2. GitCliAdapter — nouvelle methode `cloneRepository`\nFichier: `packages/server/src/infrastructure/adapters/git-cli.adapter.ts`\nAjouter : `cloneRepository(remote: string, targetPath: string): Promise<void>`\nLe adapter execute `git clone <remote> <targetPath>` via execFn.\n\n### 3. CreateSessionUseCase\nFichier: `packages/server/src/application/use-cases/create-session.ts`\nMeme logique pour les sessions creees directement (pas via ticket).\n\n### 4. JsonConfigAdapter — auto-register\nApres un clone reussi, ajouter le repo dans `config.repositories`.\n\n## Risques de regression\n- FAIBLE : le clone est une etape supplementaire avant le flow existant, pas une modification du flow\n- Le flow existant continue de fonctionner tel quel si le repo existe deja\n- Seul risque : timeout sur gros repos → le timeout de 60s de la spec PM est correct\n\n## Estimation\n- Impact : 4 fichiers a modifier\n- Complexite : moyenne (le plus delicat est la gestion d'erreur du clone)",
  "status": "final",
  "mentionId": "mention-003"
}
```

```json
← 201 { "id": "deliverable-002", "version": 1, ... }
```

```http
POST /api/agents/v1/tickets/ticket-abc-001/comments
X-Agent-Name: archi

{
  "body": "@agent:project-manager Tech spec livree. 4 fichiers a modifier, risque de regression faible. Le GitCliAdapter a besoin d'une nouvelle methode cloneRepository. Le use case CreateSessionFromTicketUseCase est le point d'entree principal."
}
```

```http
PATCH /api/agents/v1/mentions/mention-003/resolve
X-Agent-Name: archi

{ "deliverableId": "deliverable-002" }
```

---

### T+20min — cron

| Agent | Mentions pending |
|-------|-----------------|
| project-manager | `[{ "id": "mention-004", "sourceAgent": "archi" }]` |
| tous les autres | `[]` |

**project-manager** charge le contexte, voit la tech-spec, decide de lancer le dev :

```http
PATCH /api/agents/v1/mentions/mention-004/resolve
X-Agent-Name: project-manager
```

```http
POST /api/agents/v1/tickets/ticket-abc-001/comments
X-Agent-Name: project-manager

{
  "body": "@agent:dev Implemente l'auto-clone repo sur creation de session.\n\nTu as a ta disposition :\n- La spec fonctionnelle (livrable du PM, deliverable-001)\n- La tech spec (livrable de l'archi, deliverable-002)\n\nLes fichiers a modifier sont identifies dans la tech spec. Cree une branche, implemente, et pousse une PR.\n\nQuand c'est fait, poste le lien de la PR comme livrable."
}
```

```json
← 201 {
  "createdMentions": [
    { "id": "mention-005", "targetAgent": "dev", "sourceAgent": "project-manager" }
  ]
}
```

---

### T+25min — cron

| Agent | Mentions pending |
|-------|-----------------|
| dev | `[{ "id": "mention-005", "ticketId": "ticket-abc-001", "sourceAgent": "project-manager" }]` |

**dev** charge le contexte :

```http
GET /api/agents/v1/tickets/ticket-abc-001/context
X-Agent-Name: dev
```

Le dev recoit dans sa context window :
- Le ticket original avec la description du besoin
- Tous les commentaires (project-manager → pm → project-manager → archi → project-manager → dev)
- Les 2 livrables (spec fonctionnelle + tech spec)
- Sa mention pending avec la demande precise

Le dev acknowledge, code (en dehors de Fleex), cree la PR, et revient poster :

```http
PATCH /api/agents/v1/mentions/mention-005/acknowledge
X-Agent-Name: dev
```

_(le dev code pendant ce cron et le suivant — sa mention reste acknowledged)_

---

### T+30min — cron

Le dev a fini de coder. Il revient :

```http
POST /api/agents/v1/tickets/ticket-abc-001/deliverables
X-Agent-Name: dev

{
  "type": "pull-request",
  "title": "PR #42 — feat: auto-clone repository on session creation",
  "content": "## Changes\n\n- `git-cli.adapter.ts`: Added `cloneRepository(remote, targetPath)` method\n- `create-session-from-ticket.ts`: Added clone step before worktree resolution\n- `create-session.ts`: Same clone step for direct session creation\n- `json-config.adapter.ts`: Auto-register cloned repo in config\n\n## Tests\n- Unit tests for cloneRepository\n- Integration test: create session with non-existing repo\n- Error cases: timeout, auth failure, not found\n\nPR: https://github.com/oliviermadre/fleex/pull/42",
  "status": "final",
  "mentionId": "mention-005"
}
```

```json
← 201 { "id": "deliverable-003", "version": 1, ... }
```

Le dev ajoute aussi le lien PR au ticket (API existante) :

```http
POST /api/agents/v1/tickets/ticket-abc-001/links
X-Agent-Name: dev

{
  "type": "github_pr",
  "ref": "oliviermadre/fleex#42",
  "label": "feat: auto-clone repository on session creation",
  "url": "https://github.com/oliviermadre/fleex/pull/42"
}
```

Puis notifie :

```http
POST /api/agents/v1/tickets/ticket-abc-001/comments
X-Agent-Name: dev

{
  "body": "@agent:project-manager Implementation terminee. PR #42 ouverte.\n\n4 fichiers modifies conformement a la tech spec. Tests unitaires et integration inclus.\n\nPret pour review QA."
}
```

```http
PATCH /api/agents/v1/mentions/mention-005/resolve
X-Agent-Name: dev

{ "deliverableId": "deliverable-003" }
```

---

### T+35min — cron

| Agent | Mentions pending |
|-------|-----------------|
| project-manager | `[{ "id": "mention-006", "sourceAgent": "dev" }]` |

**project-manager** charge le contexte, voit la PR, decide d'envoyer au QA :

```http
PATCH /api/agents/v1/mentions/mention-006/resolve
X-Agent-Name: project-manager
```

```http
PATCH /api/agents/v1/tickets/ticket-abc-001
X-Agent-Name: project-manager

{ "status": "reviewing" }
```

```http
POST /api/agents/v1/tickets/ticket-abc-001/comments
X-Agent-Name: project-manager

{
  "body": "@agent:qa Review la PR #42 (auto-clone repo on session creation).\n\nVerifie :\n- Le clone fonctionne pour les 4 modes (main, PR, issue, fresh worktree)\n- Les erreurs sont correctement remontees (timeout, auth, repo inexistant)\n- Pas de regression sur la creation de session quand le repo existe deja\n- Les tests unitaires et integration passent"
}
```

```json
← 201 {
  "createdMentions": [
    { "id": "mention-007", "targetAgent": "qa", "sourceAgent": "project-manager" }
  ]
}
```

---

### T+40min — cron

| Agent | Mentions pending |
|-------|-----------------|
| qa | `[{ "id": "mention-007", "ticketId": "ticket-abc-001" }]` |

**qa** charge le contexte. Il voit tout l'historique : besoin → spec → tech spec → PR. Il teste.

Probleme trouve. Le QA mentionne directement le dev (pas besoin de passer par le project-manager) :

```http
PATCH /api/agents/v1/mentions/mention-007/acknowledge
X-Agent-Name: qa
```

```http
POST /api/agents/v1/tickets/ticket-abc-001/comments
X-Agent-Name: qa

{
  "body": "@agent:dev Bug trouve : quand le clone echoue par timeout, le directory partiellement clone reste sur le FS. Il faut un cleanup du directory en cas d'echec.\n\nRepro : simuler un timeout pendant le clone d'un gros repo. Le directory `<basePath>/<org>/<name>` existe mais est incomplet. La prochaine tentative de creation de session voit le directory, croit que le repo est la, et echoue sur un git checkout."
}
```

```json
← 201 {
  "createdMentions": [
    { "id": "mention-008", "targetAgent": "dev", "sourceAgent": "qa" }
  ]
}
```

Note : le QA n'a PAS resolu sa mention (mention-007). Il a toujours du travail — il attend le fix du dev.

---

### T+45min — cron

| Agent | Mentions pending |
|-------|-----------------|
| dev | `[{ "id": "mention-008", "sourceAgent": "qa" }]` |

**dev** charge le contexte, voit le bug report du QA :

```http
GET /api/agents/v1/tickets/ticket-abc-001/context
X-Agent-Name: dev
```

Il voit sa mention pending du QA. Il fixe et repond :

```http
POST /api/agents/v1/tickets/ticket-abc-001/comments
X-Agent-Name: dev

{
  "body": "@agent:qa Fixe dans le commit abc123 (pousse sur la meme PR). Ajout d'un `rm -rf targetPath` dans le catch du clone. Le test d'integration couvre maintenant ce cas."
}
```

```http
PATCH /api/agents/v1/mentions/mention-008/resolve
X-Agent-Name: dev

{ "commentId": "comment-xxx" }
```

---

### T+50min — cron

| Agent | Mentions pending |
|-------|-----------------|
| qa | la mention-007 est toujours `acknowledged` (pas resolue) + il a mention-009 du dev en `pending` |

**qa** recharge le contexte, voit le fix du dev, re-teste, tout passe :

```http
POST /api/agents/v1/tickets/ticket-abc-001/deliverables
X-Agent-Name: qa

{
  "type": "test-report",
  "title": "QA Report — Auto-clone repo",
  "content": "## Resultats\n\n| Scenario | Statut |\n|----------|--------|\n| Clone + session main | PASS |\n| Clone + session PR | PASS |\n| Clone + session issue | PASS |\n| Clone + fresh worktree | PASS |\n| Repo deja present (pas de clone) | PASS |\n| Clone timeout + cleanup | PASS |\n| Clone auth failure | PASS |\n| Repo inexistant | PASS |\n\n8/8 scenarios OK. Aucune regression detectee.",
  "status": "final",
  "mentionId": "mention-007"
}
```

```http
POST /api/agents/v1/tickets/ticket-abc-001/comments
X-Agent-Name: qa

{
  "body": "@agent:project-manager QA terminee, 8/8 scenarios OK, fix du cleanup inclus. Aucune regression. PR prete a merge."
}
```

```http
PATCH /api/agents/v1/mentions/mention-007/resolve
X-Agent-Name: qa

{ "deliverableId": "deliverable-004" }
```

---

### T+55min — cron

| Agent | Mentions pending |
|-------|-----------------|
| project-manager | `[{ "id": "mention-010", "sourceAgent": "qa" }]` |

**project-manager** charge le contexte. Voit : spec OK, tech spec OK, PR OK, QA 8/8 OK. Ferme le ticket :

```http
PATCH /api/agents/v1/mentions/mention-010/resolve
X-Agent-Name: project-manager
```

```http
PATCH /api/agents/v1/tickets/ticket-abc-001
X-Agent-Name: project-manager

{ "status": "done" }
```

```http
POST /api/agents/v1/tickets/ticket-abc-001/comments
X-Agent-Name: project-manager

{
  "body": "Ticket clos. PR #42 prete a merge. QA validee 8/8.\n\nRecap des livrables :\n- Spec fonctionnelle (PM)\n- Tech spec (Archi)\n- PR #42 (Dev)\n- QA report 8/8 (QA)"
}
```

Le project-manager envoie un message a l'humain sur Telegram : "L'auto-clone est pret. PR #42 ouverte, QA validee. Tu peux merger quand tu veux."

---

### Resume temporel

| Temps | Qui bosse | Quoi | Calls API |
|-------|-----------|------|-----------|
| T+0 | project-manager | Cree ticket + mentionne pm | `POST /tickets`, `POST /comments` |
| T+5 | pm | Lit contexte, redige spec, resout | `GET /mentions/pending`, `GET /context`, `POST /deliverables`, `POST /comments`, `PATCH /resolve` |
| T+10 | project-manager | Lit spec, mentionne archi | `GET /mentions/pending`, `GET /context`, `POST /comments`, `PATCH /resolve` |
| T+15 | archi | Lit contexte, tech spec, resout | `GET /mentions/pending`, `GET /context`, `POST /deliverables`, `POST /comments`, `PATCH /resolve` |
| T+20 | project-manager | Lit tech spec, mentionne dev | idem |
| T+25 | dev | Lit contexte, acknowledge | `GET /mentions/pending`, `GET /context`, `PATCH /acknowledge` |
| T+30 | dev | Code fini, PR, resout | `POST /deliverables`, `POST /comments`, `PATCH /resolve` |
| T+35 | project-manager | Passe en reviewing, mentionne qa | idem |
| T+40 | qa | Teste, trouve bug, mentionne dev | `GET /mentions/pending`, `GET /context`, `POST /comments` |
| T+45 | dev | Fixe, resout mention qa | `GET /mentions/pending`, `GET /context`, `POST /comments`, `PATCH /resolve` |
| T+50 | qa | Re-teste, OK, resout | `POST /deliverables`, `POST /comments`, `PATCH /resolve` |
| T+55 | project-manager | Ferme ticket | `PATCH /tickets`, `POST /comments`, `PATCH /resolve` |

**Total** : ~55 minutes, 12 cycles de cron, 5 agents impliques, 4 livrables produits.
Les 4 agents non impliques (designer, user-researcher, business, marketing) ont fait **1 call API par cycle** (`GET /mentions/pending` → `[]`) et n'ont rien fait d'autre.

### Pattern universel d'un agent en cron

```
1. GET /mentions/pending          → ai-je du travail ?
   si [] → exit (rien a faire)

2. pour chaque mention pending :
   GET /tickets/:id/context       → charger tout le contexte dans la context window LLM

3. PATCH /mentions/:id/acknowledge → signaler qu'on bosse dessus

4. ... raisonner, travailler (hors Fleex) ...

5. si livrable a fournir :
   POST /tickets/:id/deliverables → poster le livrable

6. POST /tickets/:id/comments     → repondre (avec @agent:xxx si besoin de relancer quelqu'un)

7. PATCH /mentions/:id/resolve    → marquer qu'on a fini
   { commentId ou deliverableId }
```

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

- **Pas de pipeline/workflow** dans Fleex. L'orchestration est externe.
- **Pas de roles** dans Fleex. Un agent est juste un nom (`X-Agent-Name`). C'est l'orchestrateur qui sait quel agent fait quoi.
- **Pas de registre d'agents** dans Fleex. Fleex ne sait pas quels agents existent. Il voit juste des noms dans les tokens.
- **Pas d'auto-avancement de statut**. Seul un agent (ou l'UI) change le statut d'un ticket via `PATCH`.
- **Pas de base de donnees**. On reste sur JSON. Migration future vers SQLite si besoin.
- **Pas de file d'attente**. WebSocket + polling. Si un agent est offline, ses mentions restent `pending`.
- **Pas de LLM integre**. Fleex ne raisonne pas. Les agents sont des clients externes.

---

## 8. Questions ouvertes

1. **Escalation timeout** : faut-il un mecanisme cote Fleex pour signaler qu'une mention est `pending` depuis trop longtemps ? (ex: champ `staleSince` apres X minutes). Ou c'est le chef de projet agent qui gere ca en lisant les timestamps ?
2. **Sous-tickets** : un agent devrait-il pouvoir creer des sous-tickets lies au ticket parent ? (le modele de `links` existant le permettrait avec un type `'child_ticket'`)
3. **Historique des livrables** : garder toutes les versions (append-only) ou seulement la derniere (in-place update) ?
4. **Taille des commentaires/livrables** : faut-il une limite ? Le stockage JSON rend les gros contenus couteux en I/O.
5. **Cleanup** : faut-il un mecanisme de purge pour les vieux commentaires/mentions resolues ?

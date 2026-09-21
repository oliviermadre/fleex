# Work view — Phase 3 : threads assistant ⇄ agent — Design

**Date** : 2026-09-21
**Branche** : `ticket/534e5b-vue-tasks-phase-3-threads-assistant-agen` (base `main`, après le merge de PR #278)
**Origine** : `docs/work-view/handoff/` (SPEC §6.2, §7, §9 ; DATA_MODEL § Phase 3 ; IMPLEMENTATION_PLAN Phase 3), `docs/work-view-status.md`.
**Maquette validée** : canvas Claude Design « Work Threads Phase 3 » — design **A** (la carte de délégation est un lien vers le panneau Threads, les tours ne se lisent que dans le panneau).

## Problème

La vue Work (phases 0 → 2b) parle aux agents comme le Kanban : un `@agent:x` dans le composer crée une mention, l'agent répond dans le fil. Il n'y a pas d'interlocuteur qui prenne la demande de l'utilisateur, la transmette à la bonne persona avec le contexte du ticket, suive l'échange et rapporte le résultat. La phase 3 ajoute cet interlocuteur, l'**assistant**, et le **thread** qu'il ouvre avec un agent.

## Décisions prises (avec l'utilisateur)

1. **Runtime** : l'assistant tourne avec le Claude Agent SDK comme les agents, un tour = un `query()` en mode `talk` (aucun outil) avec sortie JSON structurée, session reprise (`resume`) d'un tour à l'autre. Pas de clé API côté serveur, mêmes coûts et même Execution Log que les agents.
2. **Déclenchement** : tout message envoyé depuis le composer de la vue Work passe par l'assistant. Le message reste un commentaire du ticket ; l'assistant décide de répondre, déléguer, poursuivre ou conclure.
3. **Identité** : l'assistant est une persona ordinaire. Un champ de config globale désigne l'assistant par défaut ; la config conversation-scoped du ticket permet un override par ticket.
4. **UI** : design A du canvas. Carte de délégation courte dans le flux central, panneau Threads pour lire les tours.
5. **Migrations** : strictement additives (voir § Recette). La recette se fait sur l'instance QA sqlite ; la Supabase de prod n'est touchée qu'en fin de phase, après un `pg_dump`.

## Vue d'ensemble

```
composer Work ──POST /tickets/:id/assistant/messages──▶ PostComment (user, mentions agent supprimées)
                                                        │
                                                        ▼
                                              RunAssistantTurn (1 tour, lane par ticket)
                                                        │  query() talk + JSON
                        ┌───────────────┬───────────────┼────────────────┬──────────────────┐
                        ▼               ▼               ▼                ▼                  ▼
                      reply          delegate     continue_thread   conclude_thread     (rien)
                  comment ◆       thread + tour     tour @agent      résumé ◆ + close
                                   @agent:<p> ─────▶ mention.created ─▶ ExecuteAgent (inchangé)
                                                                          │
                                        mention.resolved / waiting_for_info / execution_failed
                                                                          │
                                              thread.updated ◀────────────┘
                                              RunAssistantTurn (trigger thread_reply)
```

Le pipeline d'exécution des agents (`PostComment` → `mention.created` → `ExecuteAgent` → `mention.*`) ne change pas. L'assistant s'y branche par des commentaires qui portent un `threadId` et par un listener sur les événements de mention.

## Modèle de données

### Nouvelle entité `AgentThreadEntity` (`domain/entities/agent-thread.entity.ts`)

| Champ | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `ticketId` | uuid | |
| `initiator` | `'assistant'` | réservé pour de futurs initiateurs |
| `personaId` / `personaName` | string | l'agent délégué (nom = clé de mention) |
| `assistantPersonaId` | string | la persona qui a joué l'assistant sur ce thread |
| `brief` | string | une ligne, affichée sur la carte |
| `forwardedContext` | `string[]` | chips : `ticket`, `worktrees`, `pr`, `deliverables` |
| `status` | `'running' \| 'waiting' \| 'concluded' \| 'failed'` | miroir de la mention courante, voir transitions |
| `currentMentionId` | string \| null | la mention en cours pour ce thread |
| `exchanges` | int | nombre de tours (assistant + agent + utilisateur) |
| `summary` | string \| null | posé à la conclusion |
| `createdAt` / `updatedAt` / `concludedAt` | dates | |

Transitions : `running → waiting` (mention `waiting_for_info`), `waiting → running` (mention réveillée ou nouveau tour), `running|waiting → concluded` (assistant `conclude_thread` ou « Conclude now »), `running → failed` (mention `execution_failed`). `concluded` et `failed` sont terminaux ; un thread `failed` peut être relancé par l'assistant sous forme d'un nouveau thread.

### Tours = commentaires

Un tour est un `TicketComment` avec un `threadId` non nul. Trois auteurs : l'assistant (`authorType: 'assistant'`), l'agent (`authorType: 'agent'`, produit par `ExecuteAgent` sans modification), l'utilisateur (`authorType: 'user'`, « Step into the thread »).

`PostCommentUseCase.execute` gagne deux paramètres :
- `threadId?: string | null` ; **héritage** : si `parentId` est fourni sans `threadId`, le commentaire hérite du `threadId` de son parent. C'est ce qui range automatiquement la réponse de l'agent dans le thread (`ExecuteAgent` répond toujours avec `parentId: mention.commentId`).
- `suppressAgentMentions?: boolean` : n'ouvre aucune mention `@agent:` / `@panel:` pour ce commentaire. Utilisé pour le message utilisateur du composer Work : l'assistant interprète les `@agent:x` comme une consigne de délégation. Les mentions `@skill:` et `@workflow:` gardent leur comportement.

La règle « les commentaires d'agents ne créent pas de mentions » (`isAgentAuthored`) ne s'applique qu'à `authorType === 'agent'`. Un commentaire `assistant` crée des mentions : c'est ainsi que l'assistant lance un agent.

### Types partagés (`@fleex/shared`)

- `TicketComment.authorType: 'user' | 'agent' | 'assistant'` ; `TicketComment.threadId: string | null`.
- `AgentThread` DTO, `AgentThreadStatus`.
- `Ticket.assistantPersonaId: string | null` (config conversation-scoped, à côté de `modelOverride`, `effortOverride`, `fastMode`).
- `AppConfig.defaultAssistantPersonaId?: string`.
- `TicketWsMessageType` gagne `thread:created`, `thread:updated`, `thread:concluded`.

### Migration `035_agent_threads` (additive, idempotente)

```sql
CREATE TABLE IF NOT EXISTS agent_threads (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, initiator TEXT NOT NULL,
  persona_id TEXT NOT NULL, persona_name TEXT NOT NULL, assistant_persona_id TEXT NOT NULL,
  brief TEXT NOT NULL, forwarded_context TEXT NOT NULL,      -- JSON string[]
  status TEXT NOT NULL, current_mention_id TEXT, exchanges INTEGER NOT NULL DEFAULT 0,
  summary TEXT, created_at <ts> NOT NULL, updated_at <ts> NOT NULL, concluded_at <ts>
);
CREATE INDEX IF NOT EXISTS idx_agent_threads_ticket ON agent_threads(ticket_id);
ALTER TABLE ticket_comments ADD COLUMN thread_id TEXT;          -- nullable
ALTER TABLE tickets ADD COLUMN assistant_persona_id TEXT;      -- nullable
```

`<ts>` = `TEXT` (sqlite) ou `TIMESTAMPTZ` (pgsql, supabase) via `ctx.dialect`, comme la migration 033.

Sur `supabase` : `ENABLE ROW LEVEL SECURITY` + policy `service_role_agent_threads` (règle CLAUDE.md), puis `NOTIFY pgrst, 'reload schema'` (nouvelle table et nouvelles colonnes vues par PostgREST, même pattern que 029/030/032). Les `ALTER TABLE ADD COLUMN` sont gardés par une lecture du schéma pour rester idempotents (sqlite n'a pas `ADD COLUMN IF NOT EXISTS`). `down` : `DROP TABLE agent_threads` ; les deux colonnes restent (un drop de colonne sqlite exige un rebuild de table, sans valeur ici).

Aucune contrainte CHECK n'existe sur `author_type` : la valeur `assistant` s'écrit sans changement de schéma.

### Stockage

- `ThreadStorePort` (`getById`, `getByTicket`, `getByCurrentMentionId`, `save`) + adaptateurs `sqlite`, `pg`, `supabase` sur le modèle des comment stores.
- Les trois comment stores lisent/écrivent `thread_id`. Les trois ticket stores lisent/écrivent `assistant_persona_id`.
- `AppConfig.defaultAssistantPersonaId` suit le chemin existant de `PUT /api/config`.

## Serveur

### `RunAssistantTurnUseCase` (`application/use-cases/run-assistant-turn.ts`)

**Entrée** : `{ ticketId, trigger }` avec
- `{ kind: 'user_message', commentId }` — un message du composer ;
- `{ kind: 'thread_reply', threadId, mentionStatus: 'resolved' | 'waiting_for_info' | 'failed' }` — l'agent a répondu, demande une info, ou a planté ;
- `{ kind: 'conclude_request', threadId }` — l'utilisateur a cliqué « Conclude now ».

**Lane par ticket** : une seule exécution assistant à la fois par ticket (`Map<ticketId, Promise>` chaînée). Les triggers en attente sont exécutés dans l'ordre. Un tour produit **exactement une action** puis s'arrête ; le tour suivant n'est déclenché que par un nouvel événement. Aucune boucle interne.

**Persona assistant** : `ticket.assistantPersonaId ?? config.defaultAssistantPersonaId`. Si aucune n'est définie ou si la persona n'existe plus : pas de tour, la route répond `assistant: null`, le composer affiche « No assistant configured » et le message reste un commentaire ordinaire dont les mentions agents ont été **exécutées normalement** (la route ne supprime les mentions que lorsqu'un assistant est résolu).

**Prompt** :
- system = SOUL / IDENTITY / MEMORY de la persona assistant + le **protocole assistant** (rôle, liste des personas disponibles avec `displayName` / `name` / extrait d'`identityMd`, règles ci-dessous, schéma de sortie) ;
- user = `GetTicketContext(ticketId, agentName = persona.name)` (ticket, commentaires visibles, mentions, livrables, activité, mémoire) + l'état des threads du ticket + la description du trigger (le commentaire utilisateur, ou la réponse de l'agent, ou la demande de conclusion).

Règles du protocole : déléguer quand la demande exige du code, une analyse de dépôt ou une expertise d'une persona ; un `@agent:x` dans le message utilisateur = délégation explicite à `x` ; un seul thread ouvert par persona et par ticket ; sur une question de l'agent (`waiting_for_info`), répondre soi-même si le contexte du ticket contient la réponse, sinon la relayer à l'humain via `reply` avec options ; conclure dès que la réponse de l'agent est finale ; résumé ≤ 3 lignes ; répondre dans la langue de l'utilisateur ; ne jamais inventer un état du ticket.

**Options SDK** : `buildSdkOptions('talk', …)`, auxquelles le use case ajoute `resume` (aujourd'hui `buildSdkOptions` ne le pose qu'en mode `edit`) = session `${persona.name}:${ticketId}` lue dans `agentEventStore.getSessionHistory()` (comme `ExecuteAgent`), `outputFormat` = schéma ci-dessous, modèle / effort / fast résolus par la config du ticket. La résolution modèle/effort/fast, aujourd'hui privée dans `ExecuteAgent.resolveExecutionConfig`, est extraite dans `application/utils/resolve-execution-config.ts` et réutilisée par les deux (refactor ciblé, sans changement de comportement).

**Exécution** : `agentEventStore.startExecution({ executionId, personaId, ticketId, mentionId: 'assistant:<turnId>' })` comme les workflows (clé synthétique). Les événements passent par `emitEvent` standard : l'Execution Log et le coût par ticket fonctionnent sans travail supplémentaire. Le préfixe `assistant:` est le marqueur que l'UI utilise pour ne pas afficher ces exécutions comme des run cards.

**Schéma de sortie** (`outputFormat`) :

```json
{
  "action": "reply | delegate | continue_thread | conclude_thread",
  "message": "texte posté dans le flux principal (reply ; optionnel pour delegate et conclude_thread)",
  "question": { "text": "…", "options": ["…"] },
  "personaName": "delegate : clé de la persona",
  "brief": "delegate : une ligne pour la carte",
  "forward": ["ticket", "worktrees", "pr", "deliverables"],
  "turn": "delegate / continue_thread : le message adressé à l'agent",
  "threadId": "continue_thread / conclude_thread",
  "summary": "conclude_thread : ≤ 3 lignes"
}
```

**Effets par action** :

| action | effets |
|---|---|
| `reply` | `PostComment(authorType 'assistant', body = message [+ options])`. Les options sont rendues comme la liste que `parseInlineOptions` reconnaît déjà, donc la question inline existante s'applique. |
| `delegate` | 1) crée le thread (`running`, `brief`, `forwardedContext`) ; 2) si `message`, commentaire assistant dans le flux principal (« Je vois ça avec … ») ; 3) tour d'ouverture : commentaire assistant `threadId`, body `@agent:<personaName> <turn>` → mention créée → `ExecuteAgent` ; 4) `currentMentionId`, `exchanges` ; 5) `thread.created`. Si un thread `running`/`waiting` existe déjà pour cette persona sur ce ticket, l'action est convertie en `continue_thread` sur ce thread. |
| `continue_thread` | tour assistant dans le thread avec `@agent:<personaName>` (nouvelle mention), `status running`, `thread.updated`. Plafond : au-delà de 8 tours assistant sur un thread, l'action est convertie en `conclude_thread` avec un résumé automatique (« Thread interrompu après N échanges »). |
| `conclude_thread` | `status concluded`, `summary`, `concludedAt` ; si la mention courante n'est pas résolue : `ExecuteAgent.cancelExecutionForMention` puis résolution de la mention ; commentaire assistant dans le flux principal `Retour de <displayName> : <summary>` [+ options] ; `thread.concluded`. |

Sur un trigger `conclude_request`, la seule action acceptée est `conclude_thread` ; toute autre sortie est convertie en `conclude_thread` avec, comme résumé, le `message` ou le `summary` fourni, sinon « Thread conclu à la demande de l'utilisateur ».

Sortie invalide ou vide (JSON non parsable, action inconnue) : le tour est journalisé `warn`, un commentaire assistant court signale l'échec (« Je n'ai pas pu traiter ce message ») et rien d'autre n'est modifié. Pas de retry automatique.

### Listener `AssistantThreadListener` (`application/assistant-thread-listener.ts`)

Abonné sur l'`EventBus` local :
- `mention.resolved`, `mention.waiting_for_info`, `mention.execution_failed` : `threadStore.getByCurrentMentionId(mentionId)` ; si un thread existe → mise à jour du `status` (`running` / `waiting` / `failed`), `exchanges` (+1 sur `resolved` et `waiting_for_info`, un commentaire agent a été posté), `thread.updated`, puis `RunAssistantTurn({ kind: 'thread_reply', … })`.
- `mention.woken_up` sur la mention courante d'un thread `waiting` → `status running`, `thread.updated` (l'utilisateur a répondu dans le thread, l'agent repart ; pas de tour assistant).
- `comment.posted` avec `threadId` et `authorType 'user'` → `exchanges` +1, `thread.updated`.

Le listener est câblé dans `container.ts` à côté de `DomainEventListener`. Il ne s'abonne **pas** au bus des événements distants (hub) : une seule instance dirige un thread.

### `BroadcastRegistrar`

`thread.created` → `thread:created`, `thread.updated` → `thread:updated`, `thread.concluded` → `thread:concluded`, DTO complet rechargé depuis `threadStore`, canal WS `tickets`.

### Routes (`infrastructure/http/assistant-threads.routes.ts`)

| Route | Effet |
|---|---|
| `POST /api/tickets/:id/assistant/messages { body }` | Résout la persona assistant. Si présente : `PostComment(user, suppressAgentMentions: true)` puis `RunAssistantTurn(user_message)` en arrière-plan ; répond `{ comment, assistant: { personaId, displayName } }`. Sinon : délègue au chemin existant de `POST /api/tickets/:id/comments` et répond `{ comment, assistant: null }`. |
| `GET /api/tickets/:id/threads` | `AgentThread[]` du ticket, plus récents d'abord. |
| `GET /api/threads/:id` | `{ thread, turns: TicketComment[] }` (commentaires `threadId`, ordre chronologique). |
| `POST /api/threads/:id/messages { body }` | Tour utilisateur : `PostComment(user, threadId)`. Si la mention courante est `waiting_for_info`, aucune nouvelle mention (le commentaire réveille l'agent via le chemin `comment.posted` existant) ; sinon le body est préfixé `@agent:<personaName>` pour relancer l'agent dans le thread. Refusé (409) sur un thread `concluded`. |
| `POST /api/threads/:id/conclude` | `RunAssistantTurn(conclude_request)` ; 409 si déjà `concluded`. |
| `PATCH /api/tickets/:id/execution-config` | accepte `assistantPersonaId?: string \| null` (existant, étendu). |
| `PUT /api/config` | accepte `defaultAssistantPersonaId` (existant, étendu). |

`GET /api/tickets/:id/comments` est inchangé : il renvoie aussi les tours (avec leur `threadId`). Le filtrage est côté client. Le Kanban (`TicketDetail`) continue d'afficher tous les commentaires ; les tours y apparaissent comme des messages ordinaires. Limitation acceptée pour cette phase (règle de non-régression : pas d'édition de `TicketDetail`).

## Web

Tout est sous le flag `workThreadsEnabled` (`settingsStore`, défaut `true`). Flag à `false` : le composer poste des commentaires ordinaires (phase 1), l'outil Threads et les cartes sont masqués.

### Composer (`task/Composer.tsx`, `useTaskConversation.ts`)

- `post(body)` appelle `api.postAssistantMessage(ticketId, body)`. Si la réponse a `assistant: null`, un hint « No assistant configured · choose one » s'affiche sous le composer (lien vers le picker).
- Footer : chip `◆ <assistant displayName> ▾` = picker de persona assistant du ticket (`PATCH execution-config { assistantPersonaId }`, « Default » = `null`), placé avant le picker de modèle existant.
- Indicateur « <assistant> is thinking… » pendant qu'une exécution dont le `personaId` est la persona assistant est `running` sur le ticket (dérivé de `ticketActivityStore` / agent-events, aucun événement nouveau).
- Les chips `⇄ See with the PM / dev` de `Suggestions.tsx` préremplissent le composer avec `Vois ça avec @agent:<name> : ` et envoient au composer (donc à l'assistant).

### Flux central (`selectors.ts`, `TaskStream.tsx`, `StreamItem.tsx`, nouveau `task/DelegationCard.tsx`)

- `buildStream(comments, activity, executions, deliverables, threads)` : exclut les commentaires `threadId !== null`, exclut les exécutions dont `mentionId` commence par `assistant:`, ajoute une entrée `{ kind: 'delegation', at: thread.createdAt, thread }`.
- `StreamItem` : `authorType 'assistant'` → avatar `◆` teinte accent, nom = `authorName`. La détection de question inline (`parseInlineOptions`) s'applique aux commentaires `agent` **et** `assistant`.
- `DelegationCard` (design A) : en-tête `◆ Assistant ⇄ ⌬ <persona>` + pill d'état (`in progress` pulsant, `waiting for you` ambre, `concluded` vert, `failed` rouge) ; brief ; chips `FORWARDED` ; pied `N exchanges · « dernière ligne » · Open thread ›`. En état `waiting`, la question de l'agent (dernier tour `agent` du thread, options via `parseInlineOptions`) s'affiche sur la carte ; un clic sur une option poste sur `POST /threads/:id/messages`. « Open thread » → `workStore.rightPanel = 'thread'`, `selectedThreadId`.
- Après conclusion, la carte reste dans le flux (état `concluded`) et le commentaire assistant `Retour de …` suit dans l'ordre chronologique.

### Panneau Threads (`panel/ThreadsPanel.tsx`, `RightPanel` branche `'thread'`)

Conforme au SPEC §6.2 et à l'artboard « Panneau Threads » : liste des threads (point d'état, persona, brief, âge) ; thread sélectionné avec en-tête, pill, coût (somme des `costUsd` des exécutions dont `mentionId` est une mention du thread) ; onglets **Conversation** (chips `CONTEXT FORWARDED`, tours ◆ / ⌬ / You, tool calls du tour agent tirés des `agent_events` de son exécution, « <persona> is working… », `Concluded · summary posted back to the main thread`) et **Agent SDK stream** (log de l'exécution courante via le composant d'execution log existant, footer `exec <id>` · Open in Execution log · Terminate = `cancelExecution`). Footer : input « Step into the thread… » (Enter → `POST /threads/:id/messages`) + « Conclude now ↩ » (→ `POST /threads/:id/conclude`), masqués sur un thread terminal.

`workStore` : `selectedThreadId` et `threadTab` existent déjà (persistés). `resolveSelectedThread(threads, selectedThreadId)` : le thread persisté s'il existe, sinon le plus récent non terminal, sinon le plus récent.

### Tool strip, queue, hooks

- `ToolStrip` : outil `Threads` `⇄` (après Context), point ambre si un thread est `running` ou `waiting`.
- Queue : quand un thread est `running`, `activityDetail` = `<persona> · in thread with assistant` ; `waiting` → l'activité `waiting` existante (NEEDS YOU).
- `useTicketThreads(ticketId)` : `GET /tickets/:id/threads` + fusion des messages WS `thread:*` ; `useThreadTurns(threadId)` : `GET /threads/:id` + `comment:created` filtrés par `threadId`.
- Settings → onglet Agents : select « Default assistant » (personas) → `PUT /api/config { defaultAssistantPersonaId }`.

## Tests

**Serveur** (vitest, co-localisés) : transitions de `AgentThreadEntity` ; `PostComment` (héritage de `threadId` par `parentId`, `suppressAgentMentions`, un commentaire `assistant` crée des mentions, un commentaire `agent` toujours pas) ; `RunAssistantTurn` avec un faux `streamSdkQuery` retournant chaque action (effets, conversion `delegate` → `continue_thread` sur thread ouvert, plafond de tours, sortie invalide) ; `AssistantThreadListener` (chaque événement de mention → statut, `exchanges`, déclenchement du tour) ; route `assistant/messages` avec et sans persona configurée ; migration 035 `up` sur sqlite (table, colonnes, idempotence au second run) ; les trois thread stores (aller-retour DTO).

**Web** : `buildStream` avec threads (exclusion des tours, entrée `delegation`, exclusion des exécutions `assistant:`) ; `DelegationCard` par état (snapshot léger + options cliquables en `waiting`) ; `resolveSelectedThread` ; `useTicketThreads` (fusion WS) ; `Composer` (assistant vs commentaire ordinaire selon le flag et `assistant: null`) ; `StreamItem` auteur `assistant`.

## Recette et sécurité des données

- Développement et recette sur l'instance QA **sqlite** (`FLEEX_STORAGE_DRIVER=sqlite`, `FLEEX_SQLITE_PATH` dédié dans le `.env` du worktree). Les migrations tournent au boot sans possibilité de les désactiver : la branche ne démarre **pas** sur la Supabase de prod pendant la phase.
- Avant la première recette sur la prod : `pg_dump` via `FLEEX_SUPABASE_DB_URL`. Une seule session de recette, branche démarrée quand aucun agent ne tourne (la recovery au boot d'`ExecuteAgent` marque toutes les exécutions `running` comme interrompues, y compris celles d'une autre instance sur la même base).
- Après recette, `main` redémarre sans dommage : le runner ignore les migrations appliquées qu'il ne connaît pas ; les colonnes et la table ajoutées sont invisibles pour lui. Effet résiduel : les tours de threads apparaissent dans le fil des tickets côté prod comme des messages ordinaires, tant que la phase 3 n'est pas mergée.

## Hors périmètre

Détection en langage naturel dans le composer (« vois avec le PM » sans `@agent:`) : l'assistant la fait déjà par nature puisqu'il lit le message ; aucune heuristique côté client. Cloisonnement du contexte entre threads : `GetTicketContext` donne à un agent tous les commentaires visibles du ticket, tours des autres threads compris (limitation acceptée, à revoir si le bruit gêne). Politique d'orchestration de threads parallèles, threads inter-tickets, plafonds de coût (le coût par exécution est déjà suivi), filtrage des tours dans le Kanban, initiateurs autres que l'assistant.

## Livraison

Un PR sur cette branche, en deux séries de commits pour garder l'ordre de revue du plan : `feat(threads)` serveur (entité, migration, stores, use case, listener, routes, WS, config) puis `feat(work)` UI (flag, composer, cartes, panneau, tool strip, settings). Chaque série est verte seule (server tsc + vitest, web tsc + vitest, `check-raw-palette.mjs`). `docs/work-view-status.md` est mis à jour à la fin avec le résumé de la phase et la stratégie de recette ci-dessus.

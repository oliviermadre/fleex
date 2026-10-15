# Work view Phase 3 — Threads assistant ⇄ agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dans la vue Work, chaque message du composer passe par une persona « assistant » qui répond, délègue à un agent dans un thread suivi, puis rapporte le résultat ; le thread se lit dans un panneau Threads et se résume par une carte de délégation dans le flux.

**Architecture:** Une entité `AgentThread` + une colonne `thread_id` sur les commentaires ; un use case `RunAssistantTurn` qui joue un tour assistant (SDK `talk`, sortie JSON, `resume`) et produit exactement une action ; un listener qui met à jour le thread et relance l'assistant sur les événements de mention. Le pipeline d'exécution des agents (`PostComment → mention.created → ExecuteAgent`) ne change pas : l'assistant s'y branche par des commentaires qui portent un `threadId`. Côté web, un `threadStore` alimenté par WS, une `DelegationCard` dans le flux (design A) et un `ThreadsPanel`.

**Tech Stack:** TypeScript, Fastify, Claude Agent SDK (`streamSdkQuery` / `buildSdkOptions`), sqlite (bun:sqlite) / pgsql / supabase (PostgREST), zustand, React, vitest (+ `@testing-library/react` côté web).

**Spec:** `docs/superpowers/specs/2026-09-21-work-threads-phase-3-design.md`

## Global Constraints

- Migrations **strictement additives**, idempotentes, un seul fichier `035_agent_threads.ts`. Jamais de rename, de drop, de NOT NULL sans défaut. Sur `supabase` : RLS + policy `service_role_agent_threads` + `NOTIFY pgrst, 'reload schema'`.
- Ne jamais modifier un fichier de migration déjà committé (CLAUDE.md).
- Un tour assistant = **une** action ; aucun tour n'en déclenche un autre sans événement externe. Plafond : 8 tours assistant par thread.
- `ExecuteAgent`, `RunPanel`, `TicketDetail`, `KanbanBoard`, `AssistantConversation` ne sont pas modifiés (hors les deux lectures d'`authorType` dans `TicketComments.tsx` et `MobileConversation.tsx`, Task 18).
- Les exécutions assistant portent `mentionId = 'assistant:<turnId>'` ; le web les exclut des run cards sur ce préfixe.
- Tout nouveau state web persisté est préfixé `fleex_work` ; aucune nouvelle clé n'est nécessaire dans ce plan (`selectedThreadId`/`threadTab` existent déjà).
- Recette sur l'instance QA sqlite uniquement (`FLEEX_STORAGE_DRIVER=sqlite`, `FLEEX_SQLITE_PATH` dédié). La Supabase de prod n'est pas démarrée avec cette branche pendant la phase.
- Vérifications par package, depuis `packages/server` ou `packages/web` : `../../node_modules/.bin/vitest run`, `../../node_modules/.bin/tsc --noEmit -p .` ; web : `node ../../scripts/check-raw-palette.mjs`. Tests bun (sqlite réel) : `bun run test:bun` depuis la racine. Après tout changement de `packages/shared` : `(cd packages/shared && ../../node_modules/.bin/tsc)`.
- Commits : messages `feat(threads): …` (serveur) et `feat(work): …` (web), terminés par `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Écarts assumés par rapport à la spec (décidés en écrivant le plan)

1. `POST /api/tickets/:id/assistant/messages` sans persona assistant résolue répond `200 { comment: null, assistant: null }` **sans rien poster** ; le web retombe alors sur `api.postTicketComment` (le chemin existant avec sa résolution de conflits de mentions). La spec disait « la route délègue au chemin existant » : cela dupliquerait la logique de conflits, le repli client est plus simple.
2. Nouvelle route `GET /api/threads/open` (threads `running` ou `waiting`, tous tickets) pour le label de queue « in thread with assistant » sur tous les tickets visibles.
3. Un commentaire d'auteur `assistant` **ne réveille pas** les agents en `waiting_for_info` via le chemin `comment.posted` générique : l'assistant réveille explicitement la mention de son thread (`ExecuteAgent.wakeUp`) quand il répond à une question de l'agent, et laisse dormir les autres.

## Carte des fichiers

**Shared** — `packages/shared/src/types/ticket.ts` (modif), `packages/shared/src/types/agent-thread.ts` (créé), `packages/shared/src/types/agent-event.ts` (modif), `packages/shared/src/index.ts` (modif).

**Serveur** — `domain/entities/agent-thread.entity.ts` (créé), `domain/entities/ticket-comment.entity.ts` (modif), `domain/entities/ticket.entity.ts` (modif), `domain/events.ts` (modif), `application/ports/thread-store.port.ts` (créé), `application/ports/config.port.ts` (modif), `application/use-cases/post-comment.ts` (modif), `application/use-cases/run-assistant-turn.ts` (créé), `application/assistant/assistant-protocol.ts` (créé), `application/assistant-thread-listener.ts` (créé), `application/utils/resolve-execution-config.ts` (créé), `application/use-cases/execute-agent.ts` (modif minime : utilise l'util extrait), `application/broadcast-registrar.ts` (modif), `application/domain-event-listener.ts` (modif), `infrastructure/migrations/migrations/035_agent_threads.ts` (créé), `infrastructure/migrations/index.ts` (modif), `infrastructure/adapters/{sqlite,pgsql,supabase}/*-thread-store.adapter.ts` (créés), `infrastructure/adapters/{sqlite,pgsql,supabase}/*-comment-store.adapter.ts` (modif), `infrastructure/adapters/{sqlite,pgsql,supabase}/*-ticket-store.adapter.ts` (modif), `infrastructure/adapters/storage-factory.ts` (modif), `infrastructure/http/assistant-threads.routes.ts` (créé), `infrastructure/http/tickets.routes.ts` (modif : body du PATCH), `infrastructure/container.ts` (modif), `infrastructure/ws/unified-ws.ts` (modif), `main.ts` (modif). Tests dans `packages/server/tests/unit/`.

**Web** — `services/api.ts` (modif), `stores/threadStore.ts` (créé), `stores/settingsStore.ts` (modif), `hooks/useExecConfig.ts` (modif), `components/markdown/ComposerExecBar.tsx` (modif), `components/work/selectors.ts` (modif), `components/work/task/{StreamItem,TaskStream,TaskPane,Composer,useTaskConversation,Suggestions}.tsx` (modif), `components/work/task/DelegationCard.tsx` (créé), `components/work/panel/{ThreadsPanel.tsx,threadSelection.ts,useThreadTurns.ts}` (créés), `components/work/panel/{RightPanel,ToolStrip}.tsx` (modif), `components/work/useWorkQueue.ts` (modif), `components/work/WorkView.tsx` (modif), `components/settings/SettingsPanel.tsx` (modif), `components/tickets/TicketComments.tsx` + `mobile/MobileConversation.tsx` (modif d'une ligne chacun).

---

## Série 1 — Serveur

### Task 1: Types partagés

**Files:**
- Create: `packages/shared/src/types/agent-thread.ts`
- Modify: `packages/shared/src/types/ticket.ts` (TicketComment, Ticket, UpdateTicketExecutionConfigRequest, TicketWsMessageType)
- Modify: `packages/shared/src/types/agent-event.ts:79` (ExecutionKind)
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/server/src/application/ports/config.port.ts` (AppConfig)

**Interfaces:**
- Produces: `CommentAuthorType`, `TicketComment.threadId`, `AgentThread`, `AgentThreadStatus`, `Ticket.assistantPersonaId`, `UpdateTicketExecutionConfigRequest.assistantPersonaId`, `TicketWsMessageType` `thread:*`, `ExecutionKind` `'assistant'`, `AppConfig.defaultAssistantPersonaId`.

- [ ] **Step 1: Créer `agent-thread.ts`**

```ts
// packages/shared/src/types/agent-thread.ts
export type AgentThreadStatus = 'running' | 'waiting' | 'concluded' | 'failed';

/**
 * A delegation opened by the assistant with one agent persona on a ticket.
 * Turns are ticket comments carrying `threadId === id`.
 */
export interface AgentThread {
  readonly id: string;
  readonly ticketId: string;
  readonly initiator: 'assistant';
  readonly personaId: string;
  /** Mention key of the delegated persona (`@agent:<personaName>`). */
  readonly personaName: string;
  readonly assistantPersonaId: string;
  readonly brief: string;
  /** Context chips: 'ticket' | 'worktrees' | 'pr' | 'deliverables'. */
  readonly forwardedContext: string[];
  readonly status: AgentThreadStatus;
  readonly currentMentionId: string | null;
  readonly exchanges: number;
  readonly summary: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly concludedAt: string | null;
}
```

- [ ] **Step 2: Modifier `ticket.ts`**

Dans `TicketComment` (ligne ~211), remplacer `readonly authorType: 'user' | 'agent';` par :

```ts
export type CommentAuthorType = 'user' | 'agent' | 'assistant';
// …
  readonly authorType: CommentAuthorType;
  // …
  readonly parentId: string | null;
  /** Set when this comment is a turn inside an assistant ⇄ agent thread. */
  readonly threadId: string | null;
```

Dans `Ticket`, après `readonly fastMode: boolean;` :

```ts
  /** Persona that plays the assistant on this ticket. null = the workspace default. */
  readonly assistantPersonaId: string | null;
```

Dans `UpdateTicketExecutionConfigRequest`, après `fastMode` :

```ts
  /** Pass null to clear the override (use the workspace default assistant). */
  readonly assistantPersonaId?: string | null;
```

Dans `TicketWsMessageType`, après `'deliverable:deleted'` :

```ts
  | 'thread:created'
  | 'thread:updated'
  | 'thread:concluded';
```

- [ ] **Step 3: `ExecutionKind` et exports**

`agent-event.ts` : ajouter `| 'assistant'` à `ExecutionKind`. `index.ts` : à côté de `TicketComment,` ajouter `CommentAuthorType,` ; ajouter une ligne `export type { AgentThread, AgentThreadStatus } from './types/agent-thread.js';` (même style que les autres exports du fichier).

- [ ] **Step 4: `AppConfig`**

`config.port.ts`, après `agentMaxTurns?: number;` :

```ts
  /** Persona id that plays the assistant in the Work view unless a ticket overrides it. */
  defaultAssistantPersonaId?: string;
```

- [ ] **Step 5: Compiler shared, constater les erreurs attendues côté serveur/web**

Run: `(cd packages/shared && ../../node_modules/.bin/tsc)` → PASS.
Run: `(cd packages/server && ../../node_modules/.bin/tsc --noEmit -p .)` → FAIL attendu sur `ticket-comment.entity.ts` (`toDTO` sans `threadId`) et `ticket.entity.ts` (`toDTO` sans `assistantPersonaId`). Ces erreurs sont corrigées en Task 5 et Task 6 ; on ne committe pas encore.

### Task 2: Migration `035_agent_threads`

**Files:**
- Create: `packages/server/src/infrastructure/migrations/migrations/035_agent_threads.ts`
- Modify: `packages/server/src/infrastructure/migrations/index.ts`
- Test: `packages/server/tests/unit/migration-035-agent-threads.bun.test.ts`

- [ ] **Step 1: Test bun (sqlite réel)**

```ts
// packages/server/tests/unit/migration-035-agent-threads.bun.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
let conn: SqliteConnection;

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
});
afterEach(() => conn.close());

function columns(table: string): string[] {
  return (conn.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

describe('035_agent_threads', () => {
  it('creates agent_threads with the expected columns', () => {
    expect(columns('agent_threads')).toEqual(expect.arrayContaining([
      'id', 'ticket_id', 'initiator', 'persona_id', 'persona_name', 'assistant_persona_id', 'brief',
      'forwarded_context', 'status', 'current_mention_id', 'exchanges', 'summary',
      'created_at', 'updated_at', 'concluded_at',
    ]));
  });
  it('adds nullable thread_id on comments and assistant_persona_id on tickets', () => {
    expect(columns('comments')).toContain('thread_id');
    expect(columns('tickets')).toContain('assistant_persona_id');
  });
  it('is idempotent on a second run', async () => {
    await expect(runPendingMigrations('sqlite', conn, silent as never)).resolves.toBeUndefined();
    expect(columns('agent_threads')).toContain('id');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `bun run test:bun` (racine) → FAIL : `agent_threads` absent (`no such table`).

- [ ] **Step 3: Écrire la migration**

```ts
// packages/server/src/infrastructure/migrations/migrations/035_agent_threads.ts
import type { Migration } from '../types.js';

/**
 * Phase 3 of the Work view: assistant ⇄ agent threads.
 *
 * Strictly additive so an older server (main) keeps booting on a database that
 * already carries it: one new table, two nullable columns. Every statement is
 * guarded so a re-run is a no-op.
 */
const migration: Migration = {
  name: '035_agent_threads',

  async up(ctx) {
    const ts = ctx.dialect({ sqlite: 'TEXT', pgsql: 'TIMESTAMPTZ', supabase: 'TIMESTAMPTZ' });

    await ctx.exec(`
      CREATE TABLE IF NOT EXISTS agent_threads (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        initiator TEXT NOT NULL,
        persona_id TEXT NOT NULL,
        persona_name TEXT NOT NULL,
        assistant_persona_id TEXT NOT NULL,
        brief TEXT NOT NULL,
        forwarded_context TEXT NOT NULL,
        status TEXT NOT NULL,
        current_mention_id TEXT,
        exchanges INTEGER NOT NULL DEFAULT 0,
        summary TEXT,
        created_at ${ts} NOT NULL,
        updated_at ${ts} NOT NULL,
        concluded_at ${ts}
      )
    `);
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_agent_threads_ticket ON agent_threads(ticket_id)');
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_agent_threads_mention ON agent_threads(current_mention_id)');

    // Nullable columns. SQLite has no ADD COLUMN IF NOT EXISTS: same try/catch
    // idempotence as migration 021.
    for (const stmt of [
      'ALTER TABLE comments ADD COLUMN thread_id TEXT',
      'ALTER TABLE tickets ADD COLUMN assistant_persona_id TEXT',
    ]) {
      try {
        await ctx.exec(stmt);
      } catch {
        // Column already exists.
      }
    }
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread_id)');

    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE agent_threads ENABLE ROW LEVEL SECURITY');
      try {
        await ctx.exec(`CREATE POLICY "service_role_agent_threads" ON agent_threads FOR ALL USING (true) WITH CHECK (true)`);
      } catch {
        // Policy already exists.
      }
      // PostgREST caches the schema: make the new table and columns visible now.
      await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
    }
  },

  async down(ctx) {
    await ctx.exec('DROP TABLE IF EXISTS agent_threads');
    // The two nullable columns stay: dropping a column on SQLite means a table
    // rebuild, and an unused nullable column is harmless.
    if (ctx.adapter === 'supabase') await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
  },
};

export default migration;
```

`index.ts` : `import migration036 from './migrations/035_agent_threads.js';` après l'import de `migration035`, et `migration036,` en fin de tableau `allMigrations` (le fichier numérote les imports à partir d'un décalage : le nom de variable suit l'ordre du tableau, le nom de fichier suit la séquence disque).

- [ ] **Step 4: Vérifier**

Run: `bun run test:bun` → PASS (3 tests). Run: `(cd packages/server && ../../node_modules/.bin/vitest run)` → toujours vert.

- [ ] **Step 5: Commit** (avec les types de Task 1 ; le tsc serveur est encore rouge, c'est accepté jusqu'à Task 6 — ne pas amender ensuite)

```bash
git add packages/shared/src packages/server/src/application/ports/config.port.ts packages/server/src/infrastructure/migrations packages/server/tests/unit/migration-035-agent-threads.bun.test.ts
git commit -m "feat(threads): shared thread types and additive migration 035

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 3: Entité `AgentThreadEntity`

**Files:**
- Create: `packages/server/src/domain/entities/agent-thread.entity.ts`
- Test: `packages/server/tests/unit/agent-thread.entity.test.ts`

**Interfaces:**
- Produces: `AgentThreadEntity` avec `static create(params)`, `openTurn(mentionId)`, `recordAgentTurn()`, `recordUserTurn()`, `markWaiting()`, `markRunning()`, `conclude(summary)`, `fail()`, `get isTerminal()`, `toDTO(): AgentThread`.

- [ ] **Step 1: Test**

```ts
// packages/server/tests/unit/agent-thread.entity.test.ts
import { describe, it, expect } from 'vitest';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';

function thread() {
  return AgentThreadEntity.create({
    id: 'th1', ticketId: 't1', personaId: 'p1', personaName: 'builder',
    assistantPersonaId: 'pa', brief: 'Fix the e2e', forwardedContext: ['ticket', 'pr'],
  });
}

describe('AgentThreadEntity', () => {
  it('starts running with no mention and zero exchanges', () => {
    const t = thread();
    expect(t.status).toBe('running');
    expect(t.currentMentionId).toBeNull();
    expect(t.exchanges).toBe(0);
    expect(t.toDTO().forwardedContext).toEqual(['ticket', 'pr']);
  });

  it('openTurn sets the current mention, counts an exchange and returns to running', () => {
    const t = thread();
    t.markWaiting();
    t.openTurn('m1');
    expect(t.currentMentionId).toBe('m1');
    expect(t.exchanges).toBe(1);
    expect(t.status).toBe('running');
  });

  it('waiting ↔ running transitions', () => {
    const t = thread();
    expect(t.markWaiting()).toBe(true);
    expect(t.status).toBe('waiting');
    expect(t.markRunning()).toBe(true);
    expect(t.status).toBe('running');
  });

  it('conclude is terminal and records the summary', () => {
    const t = thread();
    expect(t.conclude('Done, 540 tests green')).toBe(true);
    expect(t.status).toBe('concluded');
    expect(t.summary).toBe('Done, 540 tests green');
    expect(t.concludedAt).not.toBeNull();
    expect(t.isTerminal).toBe(true);
    expect(t.markWaiting()).toBe(false);
    expect(t.openTurn('m2')).toBe(false);
    expect(t.fail()).toBe(false);
  });

  it('fail is terminal and cannot be re-opened', () => {
    const t = thread();
    expect(t.fail()).toBe(true);
    expect(t.status).toBe('failed');
    expect(t.conclude('x')).toBe(false);
  });

  it('agent and user turns count exchanges', () => {
    const t = thread();
    t.recordAgentTurn();
    t.recordUserTurn();
    expect(t.exchanges).toBe(2);
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — Run: `(cd packages/server && ../../node_modules/.bin/vitest run tests/unit/agent-thread.entity.test.ts)` → FAIL (module introuvable).

- [ ] **Step 3: Implémenter**

```ts
// packages/server/src/domain/entities/agent-thread.entity.ts
import type { AgentThread, AgentThreadStatus } from '@fleex/shared';

/**
 * A delegation the assistant opened with one agent persona on a ticket. Its
 * status mirrors the mention currently driving it; `concluded` and `failed`
 * are terminal — every transition on a terminal thread is a no-op that
 * returns false, so a late mention event can never resurrect a closed thread.
 */
export class AgentThreadEntity {
  constructor(
    public readonly id: string,
    public readonly ticketId: string,
    public readonly initiator: 'assistant',
    public readonly personaId: string,
    public readonly personaName: string,
    public readonly assistantPersonaId: string,
    public readonly brief: string,
    public readonly forwardedContext: string[],
    public status: AgentThreadStatus,
    public currentMentionId: string | null,
    public exchanges: number,
    public summary: string | null,
    public readonly createdAt: Date,
    public updatedAt: Date,
    public concludedAt: Date | null,
  ) {}

  static create(params: {
    id: string;
    ticketId: string;
    personaId: string;
    personaName: string;
    assistantPersonaId: string;
    brief: string;
    forwardedContext: string[];
  }): AgentThreadEntity {
    const now = new Date();
    return new AgentThreadEntity(
      params.id, params.ticketId, 'assistant', params.personaId, params.personaName,
      params.assistantPersonaId, params.brief, [...params.forwardedContext],
      'running', null, 0, null, now, now, null,
    );
  }

  get isTerminal(): boolean {
    return this.status === 'concluded' || this.status === 'failed';
  }

  /** The assistant posted a turn that opened `mentionId` on the agent. */
  openTurn(mentionId: string): boolean {
    if (this.isTerminal) return false;
    this.currentMentionId = mentionId;
    this.exchanges += 1;
    this.status = 'running';
    this.touch();
    return true;
  }

  recordAgentTurn(): boolean {
    if (this.isTerminal) return false;
    this.exchanges += 1;
    this.touch();
    return true;
  }

  recordUserTurn(): boolean {
    if (this.isTerminal) return false;
    this.exchanges += 1;
    this.touch();
    return true;
  }

  markWaiting(): boolean {
    if (this.isTerminal) return false;
    this.status = 'waiting';
    this.touch();
    return true;
  }

  markRunning(): boolean {
    if (this.isTerminal) return false;
    this.status = 'running';
    this.touch();
    return true;
  }

  conclude(summary: string): boolean {
    if (this.isTerminal) return false;
    this.status = 'concluded';
    this.summary = summary;
    this.concludedAt = new Date();
    this.touch();
    return true;
  }

  fail(): boolean {
    if (this.isTerminal) return false;
    this.status = 'failed';
    this.concludedAt = new Date();
    this.touch();
    return true;
  }

  private touch(): void {
    this.updatedAt = new Date();
  }

  toDTO(): AgentThread {
    return {
      id: this.id,
      ticketId: this.ticketId,
      initiator: this.initiator,
      personaId: this.personaId,
      personaName: this.personaName,
      assistantPersonaId: this.assistantPersonaId,
      brief: this.brief,
      forwardedContext: [...this.forwardedContext],
      status: this.status,
      currentMentionId: this.currentMentionId,
      exchanges: this.exchanges,
      summary: this.summary,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      concludedAt: this.concludedAt?.toISOString() ?? null,
    };
  }
}
```

- [ ] **Step 4: Vérifier** — même commande → PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domain/entities/agent-thread.entity.ts packages/server/tests/unit/agent-thread.entity.test.ts
git commit -m "feat(threads): AgentThreadEntity with guarded status transitions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
### Task 4: `ThreadStorePort` et ses trois adaptateurs

**Files:**
- Create: `packages/server/src/application/ports/thread-store.port.ts`
- Create: `packages/server/src/infrastructure/adapters/sqlite/sqlite-thread-store.adapter.ts`
- Create: `packages/server/src/infrastructure/adapters/pgsql/pg-thread-store.adapter.ts`
- Create: `packages/server/src/infrastructure/adapters/supabase/supabase-thread-store.adapter.ts`
- Modify: `packages/server/src/infrastructure/adapters/storage-factory.ts` (interface `StorageBundle` ligne ~32 + les trois constructeurs lignes ~149/219/300)
- Test: `packages/server/tests/unit/sqlite-thread-store.bun.test.ts`

**Interfaces:**
- Produces:
```ts
export interface ThreadStorePort {
  getById(id: string): Promise<AgentThreadEntity | null>;
  getByTicket(ticketId: string): Promise<AgentThreadEntity[]>;        // plus récents d'abord
  getByCurrentMentionId(mentionId: string): Promise<AgentThreadEntity | null>;
  getOpen(): Promise<AgentThreadEntity[]>;                             // status running|waiting
  save(thread: AgentThreadEntity): Promise<void>;                      // upsert
}
```

- [ ] **Step 1: Test bun sur l'adaptateur sqlite**

```ts
// packages/server/tests/unit/sqlite-thread-store.bun.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteThreadStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-thread-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
let conn: SqliteConnection;
let store: SqliteThreadStoreAdapter;

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  store = new SqliteThreadStoreAdapter(conn);
});
afterEach(() => conn.close());

function make(id: string, ticketId = 't1') {
  return AgentThreadEntity.create({
    id, ticketId, personaId: 'p1', personaName: 'builder', assistantPersonaId: 'pa',
    brief: `brief ${id}`, forwardedContext: ['ticket'],
  });
}

describe('SqliteThreadStoreAdapter', () => {
  it('round-trips a thread through save/getById', async () => {
    const t = make('th1');
    t.openTurn('m1');
    await store.save(t);
    const back = await store.getById('th1');
    expect(back?.toDTO()).toEqual(t.toDTO());
  });

  it('getByTicket returns newest first and getByCurrentMentionId finds the driver', async () => {
    const a = make('a'); await store.save(a);
    await new Promise((r) => setTimeout(r, 5));
    const b = make('b'); b.openTurn('m-b'); await store.save(b);
    expect((await store.getByTicket('t1')).map((x) => x.id)).toEqual(['b', 'a']);
    expect((await store.getByCurrentMentionId('m-b'))?.id).toBe('b');
    expect(await store.getByCurrentMentionId('nope')).toBeNull();
  });

  it('getOpen excludes terminal threads and save upserts', async () => {
    const a = make('a'); await store.save(a);
    const b = make('b', 't2'); b.conclude('done'); await store.save(b);
    const c = make('c', 't3'); c.markWaiting(); await store.save(c);
    expect((await store.getOpen()).map((x) => x.id).sort()).toEqual(['a', 'c']);
    a.fail(); await store.save(a);
    expect((await store.getOpen()).map((x) => x.id)).toEqual(['c']);
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — Run: `bun run test:bun` → FAIL (module introuvable).

- [ ] **Step 3: Port**

```ts
// packages/server/src/application/ports/thread-store.port.ts
import type { AgentThreadEntity } from '../../domain/entities/agent-thread.entity.js';

export interface ThreadStorePort {
  getById(id: string): Promise<AgentThreadEntity | null>;
  /** Newest first. */
  getByTicket(ticketId: string): Promise<AgentThreadEntity[]>;
  getByCurrentMentionId(mentionId: string): Promise<AgentThreadEntity | null>;
  /** Threads whose status is running or waiting, across tickets. */
  getOpen(): Promise<AgentThreadEntity[]>;
  save(thread: AgentThreadEntity): Promise<void>;
}
```

Ajouter `export type { ThreadStorePort } from './thread-store.port.js';` dans `packages/server/src/application/ports/index.ts` (même forme que les autres lignes du fichier).

- [ ] **Step 4: Adaptateur sqlite**

```ts
// packages/server/src/infrastructure/adapters/sqlite/sqlite-thread-store.adapter.ts
import type { AgentThreadStatus } from '@fleex/shared';
import { AgentThreadEntity } from '../../../domain/entities/agent-thread.entity.js';
import type { ThreadStorePort } from '../../../application/ports/thread-store.port.js';
import type { SqliteConnection } from './connection.js';

interface ThreadRow {
  id: string; ticket_id: string; initiator: string; persona_id: string; persona_name: string;
  assistant_persona_id: string; brief: string; forwarded_context: string; status: string;
  current_mention_id: string | null; exchanges: number; summary: string | null;
  created_at: string; updated_at: string; concluded_at: string | null;
}

export function threadRowToEntity(r: ThreadRow): AgentThreadEntity {
  return new AgentThreadEntity(
    r.id, r.ticket_id, 'assistant', r.persona_id, r.persona_name, r.assistant_persona_id, r.brief,
    JSON.parse(r.forwarded_context) as string[], r.status as AgentThreadStatus, r.current_mention_id,
    Number(r.exchanges), r.summary, new Date(r.created_at), new Date(r.updated_at),
    r.concluded_at ? new Date(r.concluded_at) : null,
  );
}

export function threadEntityToRow(t: AgentThreadEntity): ThreadRow {
  return {
    id: t.id, ticket_id: t.ticketId, initiator: t.initiator, persona_id: t.personaId,
    persona_name: t.personaName, assistant_persona_id: t.assistantPersonaId, brief: t.brief,
    forwarded_context: JSON.stringify(t.forwardedContext), status: t.status,
    current_mention_id: t.currentMentionId, exchanges: t.exchanges, summary: t.summary,
    created_at: t.createdAt.toISOString(), updated_at: t.updatedAt.toISOString(),
    concluded_at: t.concludedAt?.toISOString() ?? null,
  };
}

export class SqliteThreadStoreAdapter implements ThreadStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getById(id: string): Promise<AgentThreadEntity | null> {
    const row = this.conn.db.prepare('SELECT * FROM agent_threads WHERE id = ?').get(id) as ThreadRow | undefined;
    return row ? threadRowToEntity(row) : null;
  }

  async getByTicket(ticketId: string): Promise<AgentThreadEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM agent_threads WHERE ticket_id = ? ORDER BY created_at DESC, id DESC')
      .all(ticketId) as ThreadRow[];
    return rows.map(threadRowToEntity);
  }

  async getByCurrentMentionId(mentionId: string): Promise<AgentThreadEntity | null> {
    const row = this.conn.db
      .prepare('SELECT * FROM agent_threads WHERE current_mention_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(mentionId) as ThreadRow | undefined;
    return row ? threadRowToEntity(row) : null;
  }

  async getOpen(): Promise<AgentThreadEntity[]> {
    const rows = this.conn.db
      .prepare(`SELECT * FROM agent_threads WHERE status IN ('running', 'waiting') ORDER BY created_at DESC`)
      .all() as ThreadRow[];
    return rows.map(threadRowToEntity);
  }

  async save(thread: AgentThreadEntity): Promise<void> {
    this.conn.db.prepare(`
      INSERT OR REPLACE INTO agent_threads
        (id, ticket_id, initiator, persona_id, persona_name, assistant_persona_id, brief, forwarded_context,
         status, current_mention_id, exchanges, summary, created_at, updated_at, concluded_at)
      VALUES
        (@id, @ticket_id, @initiator, @persona_id, @persona_name, @assistant_persona_id, @brief, @forwarded_context,
         @status, @current_mention_id, @exchanges, @summary, @created_at, @updated_at, @concluded_at)
    `).run(threadEntityToRow(thread));
  }
}
```

- [ ] **Step 5: Adaptateur pgsql** (même mapping, requêtes `$n`)

```ts
// packages/server/src/infrastructure/adapters/pgsql/pg-thread-store.adapter.ts
import type { AgentThreadStatus } from '@fleex/shared';
import { AgentThreadEntity } from '../../../domain/entities/agent-thread.entity.js';
import type { ThreadStorePort } from '../../../application/ports/thread-store.port.js';
import type { PgConnection } from './connection.js';

function rowToThread(row: Record<string, unknown>): AgentThreadEntity {
  return new AgentThreadEntity(
    row.id as string, row.ticket_id as string, 'assistant', row.persona_id as string, row.persona_name as string,
    row.assistant_persona_id as string, row.brief as string, JSON.parse(row.forwarded_context as string) as string[],
    row.status as AgentThreadStatus, (row.current_mention_id as string | null) ?? null, Number(row.exchanges),
    (row.summary as string | null) ?? null, new Date(row.created_at as string), new Date(row.updated_at as string),
    row.concluded_at ? new Date(row.concluded_at as string) : null,
  );
}

export class PgThreadStore implements ThreadStorePort {
  constructor(private readonly db: PgConnection) {}

  async getById(id: string): Promise<AgentThreadEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM agent_threads WHERE id = $1', [id]);
    return rows.length > 0 ? rowToThread(rows[0]) : null;
  }
  async getByTicket(ticketId: string): Promise<AgentThreadEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM agent_threads WHERE ticket_id = $1 ORDER BY created_at DESC, id DESC', [ticketId]);
    return rows.map(rowToThread);
  }
  async getByCurrentMentionId(mentionId: string): Promise<AgentThreadEntity | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM agent_threads WHERE current_mention_id = $1 ORDER BY updated_at DESC LIMIT 1', [mentionId]);
    return rows.length > 0 ? rowToThread(rows[0]) : null;
  }
  async getOpen(): Promise<AgentThreadEntity[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM agent_threads WHERE status IN ('running','waiting') ORDER BY created_at DESC`);
    return rows.map(rowToThread);
  }
  async save(t: AgentThreadEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO agent_threads (id, ticket_id, initiator, persona_id, persona_name, assistant_persona_id, brief,
         forwarded_context, status, current_mention_id, exchanges, summary, created_at, updated_at, concluded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET status = $9, current_mention_id = $10, exchanges = $11, summary = $12,
         updated_at = $14, concluded_at = $15`,
      [t.id, t.ticketId, t.initiator, t.personaId, t.personaName, t.assistantPersonaId, t.brief,
       JSON.stringify(t.forwardedContext), t.status, t.currentMentionId, t.exchanges, t.summary,
       t.createdAt.toISOString(), t.updatedAt.toISOString(), t.concludedAt?.toISOString() ?? null],
    );
  }
}
```

- [ ] **Step 6: Adaptateur supabase** (PostgREST ; `forwarded_context` est une chaîne JSON, colonne TEXT)

```ts
// packages/server/src/infrastructure/adapters/supabase/supabase-thread-store.adapter.ts
import type { AgentThreadStatus } from '@fleex/shared';
import { AgentThreadEntity } from '../../../domain/entities/agent-thread.entity.js';
import type { ThreadStorePort } from '../../../application/ports/thread-store.port.js';
import type { SupabaseConnection } from './connection.js';

interface ThreadRow {
  id: string; ticket_id: string; persona_id: string; persona_name: string; assistant_persona_id: string;
  brief: string; forwarded_context: string; status: string; current_mention_id: string | null;
  exchanges: number; summary: string | null; created_at: string; updated_at: string; concluded_at: string | null;
}

function rowToEntity(r: ThreadRow): AgentThreadEntity {
  return new AgentThreadEntity(
    r.id, r.ticket_id, 'assistant', r.persona_id, r.persona_name, r.assistant_persona_id, r.brief,
    JSON.parse(r.forwarded_context) as string[], r.status as AgentThreadStatus, r.current_mention_id,
    Number(r.exchanges), r.summary, new Date(r.created_at), new Date(r.updated_at),
    r.concluded_at ? new Date(r.concluded_at) : null,
  );
}

export class SupabaseThreadStore implements ThreadStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getById(id: string): Promise<AgentThreadEntity | null> {
    const { data, error } = await this.conn.client.from('agent_threads').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`SupabaseThreadStore.getById failed: ${error.message}`);
    return data ? rowToEntity(data as ThreadRow) : null;
  }
  async getByTicket(ticketId: string): Promise<AgentThreadEntity[]> {
    const { data, error } = await this.conn.client.from('agent_threads').select('*')
      .eq('ticket_id', ticketId).order('created_at', { ascending: false });
    if (error) throw new Error(`SupabaseThreadStore.getByTicket failed: ${error.message}`);
    return (data as ThreadRow[]).map(rowToEntity);
  }
  async getByCurrentMentionId(mentionId: string): Promise<AgentThreadEntity | null> {
    const { data, error } = await this.conn.client.from('agent_threads').select('*')
      .eq('current_mention_id', mentionId).order('updated_at', { ascending: false }).limit(1);
    if (error) throw new Error(`SupabaseThreadStore.getByCurrentMentionId failed: ${error.message}`);
    const rows = data as ThreadRow[];
    return rows.length > 0 ? rowToEntity(rows[0]!) : null;
  }
  async getOpen(): Promise<AgentThreadEntity[]> {
    const { data, error } = await this.conn.client.from('agent_threads').select('*')
      .in('status', ['running', 'waiting']).order('created_at', { ascending: false });
    if (error) throw new Error(`SupabaseThreadStore.getOpen failed: ${error.message}`);
    return (data as ThreadRow[]).map(rowToEntity);
  }
  async save(t: AgentThreadEntity): Promise<void> {
    const { error } = await this.conn.client.from('agent_threads').upsert({
      id: t.id, ticket_id: t.ticketId, initiator: t.initiator, persona_id: t.personaId,
      persona_name: t.personaName, assistant_persona_id: t.assistantPersonaId, brief: t.brief,
      forwarded_context: JSON.stringify(t.forwardedContext), status: t.status,
      current_mention_id: t.currentMentionId, exchanges: t.exchanges, summary: t.summary,
      created_at: t.createdAt.toISOString(), updated_at: t.updatedAt.toISOString(),
      concluded_at: t.concludedAt?.toISOString() ?? null,
    });
    if (error) throw new Error(`SupabaseThreadStore.save failed: ${error.message}`);
  }
}
```

- [ ] **Step 7: Câbler la fabrique**

Dans `storage-factory.ts` : ajouter `threadStore: ThreadStorePort;` à l'interface du bundle (à côté de `commentStore`), importer le type, puis dans chacune des trois fonctions ajouter l'import dynamique et la construction : sqlite `threadStore: new SqliteThreadStoreAdapter(connection)`, pgsql `threadStore: new PgThreadStore(connection)`, supabase `threadStore: new SupabaseThreadStore(connection)`. Dans `container.ts`, destructurer `threadStore` du bundle là où `commentStore` l'est (ligne ~161) et l'exposer dans le `return` (à côté de `commentStore`).

- [ ] **Step 8: Vérifier** — Run: `bun run test:bun` → PASS. Run: `(cd packages/server && ../../node_modules/.bin/tsc --noEmit -p .)` → seules restent les erreurs `toDTO` de Task 1.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/application/ports packages/server/src/infrastructure/adapters packages/server/src/infrastructure/container.ts packages/server/tests/unit/sqlite-thread-store.bun.test.ts
git commit -m "feat(threads): ThreadStorePort with sqlite, pgsql and supabase adapters

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 5: `threadId` sur les commentaires et règles de `PostComment`

**Files:**
- Modify: `packages/server/src/domain/entities/ticket-comment.entity.ts`
- Modify: `packages/server/src/infrastructure/adapters/sqlite/sqlite-comment-store.adapter.ts`, `pgsql/pg-comment-store.adapter.ts`, `supabase/supabase-comment-store.adapter.ts`
- Modify: `packages/server/src/application/use-cases/post-comment.ts`
- Modify: `packages/server/src/domain/events.ts:106` (`CommentPostedEvent.authorType`)
- Modify: `packages/server/src/application/domain-event-listener.ts:360-372` (`handleWakeWaitingOnComment`)
- Test: `packages/server/tests/unit/post-comment.test.ts` (ajouter un `describe`)

**Interfaces:**
- Produces: `TicketCommentEntity` 12ᵉ paramètre `threadId: string | null = null` ; `TicketCommentEntity.create({ …, threadId? })` ; `PostCommentUseCase.execute({ …, authorType: CommentAuthorType, threadId?, suppressAgentMentions? })`.

- [ ] **Step 1: Tests**

Ajouter en fin de `post-comment.test.ts` (les fakes du fichier existent déjà ; `FakeCommentStore` gagne `getById`) :

```ts
// Dans FakeCommentStore, ajouter :
//   async getById(id: string) { return this.saved.find((c) => c.id === id) ?? null; }

describe('PostCommentUseCase — assistant threads', () => {
  let comments: FakeCommentStore;
  let mentions: FakeMentionStore;
  let useCase: PostCommentUseCase;

  beforeEach(() => {
    comments = new FakeCommentStore();
    mentions = new FakeMentionStore();
    useCase = new PostCommentUseCase(
      comments as unknown as CommentStorePort,
      mentions as unknown as MentionStorePort,
      new FakeTicketStore() as unknown as TicketStorePort,
      new FakeLogger() as unknown as LoggerPort,
    );
  });

  it('an assistant-authored comment DOES create agent mentions', async () => {
    const { createdMentions, comment } = await useCase.execute({
      ticketId: 't1', authorType: 'assistant', authorName: 'Nas', body: '@agent:builder fix it', threadId: 'th1',
    });
    expect(createdMentions.map((m) => m.targetAgent)).toEqual(['builder']);
    expect(comment.threadId).toBe('th1');
    expect(comment.toDTO().threadId).toBe('th1');
  });

  it('an agent-authored comment still creates no mention', async () => {
    const { createdMentions } = await useCase.execute({
      ticketId: 't1', authorType: 'agent', authorName: 'The Builder', body: '@agent:pm look',
    });
    expect(createdMentions).toHaveLength(0);
  });

  it('suppressAgentMentions skips agent and panel mentions but keeps skills/workflows', async () => {
    const { createdMentions } = await useCase.execute({
      ticketId: 't1', authorType: 'user', authorName: 'olivier',
      body: '@agent:builder @panel:leadership @skill:lint @workflow:review', suppressAgentMentions: true,
    });
    expect(createdMentions.map((m) => m.targetType).sort()).toEqual(['skill', 'workflow']);
  });

  it('inherits threadId from the parent comment when parentId is given', async () => {
    const { comment: parent } = await useCase.execute({
      ticketId: 't1', authorType: 'assistant', authorName: 'Nas', body: '@agent:builder go', threadId: 'th1',
    });
    const { comment: reply } = await useCase.execute({
      ticketId: 't1', authorType: 'agent', authorName: 'The Builder', body: 'done', parentId: parent.id,
    });
    expect(reply.threadId).toBe('th1');
  });

  it('an explicit threadId: null on a reply is kept (no inheritance)', async () => {
    const { comment: parent } = await useCase.execute({
      ticketId: 't1', authorType: 'assistant', authorName: 'Nas', body: 'x', threadId: 'th1',
    });
    const { comment: reply } = await useCase.execute({
      ticketId: 't1', authorType: 'user', authorName: 'olivier', body: 'y', parentId: parent.id, threadId: null,
    });
    expect(reply.threadId).toBeNull();
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — Run: `(cd packages/server && ../../node_modules/.bin/vitest run tests/unit/post-comment.test.ts)` → FAIL (type/`threadId` undefined).

- [ ] **Step 3: Entité**

`ticket-comment.entity.ts` : importer `CommentAuthorType` depuis `@fleex/shared` ; `authorType: CommentAuthorType` dans le constructeur et `create` ; ajouter en **dernier** paramètre du constructeur `public readonly threadId: string | null = null,` ; `create` accepte `threadId?: string | null` et le passe (`params.threadId ?? null`) ; `toDTO()` ajoute `threadId: this.threadId`.

- [ ] **Step 4: Adaptateurs**

Pour les trois adaptateurs : ajouter `thread_id: string | null` à `CommentRow` (sqlite/supabase) ; dans `save` ajouter la colonne `thread_id` (sqlite : `thread_id` + `@thread_id` + `thread_id: comment.threadId` ; pgsql : `thread_id` en 12ᵉ colonne `$12` + `thread_id = $12` dans le `DO UPDATE SET` + `comment.threadId` dans le tableau ; supabase : `thread_id: comment.threadId` dans l'upsert) ; dans le mapping vers l'entité, passer `row.thread_id ?? null` en dernier argument et caster `author_type as CommentAuthorType`.

- [ ] **Step 5: `PostComment`**

```ts
// post-comment.ts — signature
import type { CommentVisibility, MentionExecutionMode, CommentAuthorType } from '@fleex/shared';
// …
  async execute(params: {
    ticketId: string;
    authorType: CommentAuthorType;
    authorName: string;
    body: string;
    visibility?: CommentVisibility;
    privateRecipients?: string[];
    parentId?: string | null;
    /**
     * Thread this comment is a turn of. `undefined` = inherit the parent's
     * threadId when `parentId` is given (this is how an agent's reply lands in
     * the thread that mentioned it); `null` = force a main-stream comment.
     */
    threadId?: string | null;
    humanMentionNames?: string[];
    executionMode?: MentionExecutionMode;
    suppressMentionForAgents?: string[];
    /**
     * Skip @agent:/@panel: mentions entirely. The Work composer sets it: the
     * assistant reads those mentions as delegation instructions instead.
     */
    suppressAgentMentions?: boolean;
  })
```

Corps : avant `TicketCommentEntity.create`, résoudre le thread :

```ts
    let threadId: string | null = params.threadId ?? null;
    if (params.threadId === undefined && params.parentId) {
      const parent = await this.commentStore.getById(params.parentId);
      threadId = parent?.threadId ?? null;
    }
```

passer `threadId` à `create` ; remplacer `const isAgentAuthored = params.authorType === 'agent';` par `const skipAgentMentions = params.authorType === 'agent' || params.suppressAgentMentions === true;` et conditionner **les deux** boucles `@agent:` et `@panel:` sur `!skipAgentMentions` (les boucles skill/workflow restent conditionnées à `params.authorType !== 'agent'`, comme aujourd'hui via le bloc `if (!isAgentAuthored)` — restructurer le bloc en deux `if`). Activité : `source: params.authorType === 'user' ? 'web' : 'api'`.

- [ ] **Step 6: Événement et wake**

`events.ts` : `CommentPostedEvent.authorType: CommentAuthorType` (import). `domain-event-listener.ts`, début de `handleWakeWaitingOnComment` :

```ts
    // The assistant addresses agents explicitly (a new mention, or a targeted
    // ExecuteAgent.wakeUp on its own thread). Its comments must not wake every
    // waiting agent on the ticket.
    if (event.authorType === 'assistant') return;
```

- [ ] **Step 7: Vérifier** — Run: `(cd packages/server && ../../node_modules/.bin/vitest run tests/unit/post-comment.test.ts)` → PASS. `tsc` serveur : il ne reste que l'erreur `assistantPersonaId` de `ticket.entity.ts`.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/domain packages/server/src/application/use-cases/post-comment.ts packages/server/src/application/domain-event-listener.ts packages/server/src/infrastructure/adapters packages/server/tests/unit/post-comment.test.ts
git commit -m "feat(threads): comments carry a threadId; assistant comments create mentions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 6: `assistantPersonaId` sur le ticket et `defaultAssistantPersonaId` en config

**Files:**
- Modify: `packages/server/src/domain/entities/ticket.entity.ts` (constructeur ligne ~33, `updateExecutionConfig` ligne ~191, `toDTO` ligne ~400)
- Modify: `packages/server/src/infrastructure/adapters/sqlite/sqlite-ticket-store.adapter.ts` (`TicketRow` ~42, `save` ~196-232, `toEntity` ~449), `pgsql/pg-ticket-store.adapter.ts` (~137, ~160, ~372), `supabase/supabase-ticket-store.adapter.ts` (~44, ~99, ~290)
- Modify: `packages/server/src/infrastructure/http/tickets.routes.ts:397` (le body est déjà typé `UpdateTicketExecutionConfigRequest` : rien à changer sauf vérifier)
- Test: `packages/server/tests/unit/ticket-assistant-persona.test.ts`

- [ ] **Step 1: Test**

```ts
// packages/server/tests/unit/ticket-assistant-persona.test.ts
import { describe, it, expect } from 'vitest';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';

describe('TicketEntity.assistantPersonaId', () => {
  it('defaults to null and round-trips through the DTO', () => {
    const t = TicketEntity.create({ id: 't1', boardId: 'b1', displayId: 1, title: 'x' });
    expect(t.assistantPersonaId).toBeNull();
    expect(t.toDTO().assistantPersonaId).toBeNull();
  });

  it('updateExecutionConfig sets and clears the override with a diff', () => {
    const t = TicketEntity.create({ id: 't1', boardId: 'b1', displayId: 1, title: 'x' });
    expect(t.updateExecutionConfig({ assistantPersonaId: 'pa' })).toEqual({
      assistantPersonaId: { from: null, to: 'pa' },
    });
    expect(t.assistantPersonaId).toBe('pa');
    expect(t.updateExecutionConfig({ assistantPersonaId: 'pa' })).toEqual({});
    expect(t.updateExecutionConfig({ assistantPersonaId: null })).toEqual({
      assistantPersonaId: { from: 'pa', to: null },
    });
  });
});
```

(Si `TicketEntity.create` exige d'autres champs obligatoires, reprendre exactement la liste des `params` de `static create` du fichier.)

- [ ] **Step 2: Vérifier l'échec** — Run: `(cd packages/server && ../../node_modules/.bin/vitest run tests/unit/ticket-assistant-persona.test.ts)` → FAIL.

- [ ] **Step 3: Entité**

Constructeur : après `public fastMode: boolean = false,` ajouter `public assistantPersonaId: string | null = null,`. `updateExecutionConfig` : type `assistantPersonaId?: string | null;` et le bloc :

```ts
    if (changes.assistantPersonaId !== undefined && changes.assistantPersonaId !== this.assistantPersonaId) {
      diff['assistantPersonaId'] = { from: this.assistantPersonaId, to: changes.assistantPersonaId };
      this.assistantPersonaId = changes.assistantPersonaId;
    }
```

`toDTO` : `assistantPersonaId: this.assistantPersonaId,` après `fastMode`.

- [ ] **Step 4: Adaptateurs ticket**

Même geste que `model_override` dans chacun : colonne `assistant_persona_id` dans l'INSERT (sqlite : `@assistant_persona_id`, `assistant_persona_id = excluded.assistant_persona_id`, valeur `ticket.assistantPersonaId` ; pgsql : nouvelle colonne en fin de liste avec son `$n` et sa ligne `DO UPDATE SET` ; supabase : `assistant_persona_id: ticket.assistantPersonaId`) ; lecture : passer `row.assistant_persona_id ?? null` comme **dernier** argument du constructeur, après `fast_mode`. Ajouter `assistant_persona_id: string | null` aux interfaces de row.

- [ ] **Step 5: Vérifier** — Run test → PASS. Run: `(cd packages/server && ../../node_modules/.bin/tsc --noEmit -p .)` → PASS (plus aucune erreur). Run: `(cd packages/server && ../../node_modules/.bin/vitest run)` → PASS. `bun run test:bun` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src
git add packages/server/tests/unit/ticket-assistant-persona.test.ts
git commit -m "feat(threads): per-ticket assistant persona override

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 7: Événements domaine `thread.*` et diffusion WS

**Files:**
- Modify: `packages/server/src/domain/events.ts` (nouveaux événements + union `AnyDomainEvent`)
- Modify: `packages/server/src/application/broadcast-registrar.ts` (deps + handlers)
- Modify: `packages/server/src/application/domain-event-listener.ts:64` (passe `threadStore` au registrar) et `DomainEventListenerDeps`
- Modify: `packages/server/src/infrastructure/container.ts` (passe `threadStore` au listener local et au `RemoteDomainEventListener`, qui construit lui aussi un registrar — vérifier `grep -n "BroadcastRegistrar" packages/server/src/application/remote-domain-event-listener.ts`)
- Test: `packages/server/tests/unit/broadcast-registrar-threads.test.ts`

- [ ] **Step 1: Test**

```ts
// packages/server/tests/unit/broadcast-registrar-threads.test.ts
import { describe, it, expect } from 'vitest';
import { EventBus } from '../../src/application/event-bus.js';
import { BroadcastRegistrar } from '../../src/application/broadcast-registrar.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';

describe('BroadcastRegistrar — thread events', () => {
  it('pushes the thread DTO on the tickets channel for each thread.* event', async () => {
    const thread = AgentThreadEntity.create({
      id: 'th1', ticketId: 't1', personaId: 'p1', personaName: 'builder',
      assistantPersonaId: 'pa', brief: 'b', forwardedContext: [],
    });
    const threadStore = { getById: async (id: string) => (id === 'th1' ? thread : null) };
    const registrar = new BroadcastRegistrar({
      personaStore: {}, skillStore: {}, ticketStore: {}, mentionStore: {}, commentStore: {},
      deliverableStore: {}, threadStore,
    } as never);
    const pushed: Array<{ type: string; data: unknown }> = [];
    registrar.setTicketBroadcast((type, data) => pushed.push({ type, data }));
    const bus = new EventBus();
    registrar.register(bus);

    bus.emit({ type: 'thread.created', threadId: 'th1', ticketId: 't1', occurredAt: new Date() });
    bus.emit({ type: 'thread.updated', threadId: 'th1', ticketId: 't1', occurredAt: new Date() });
    bus.emit({ type: 'thread.concluded', threadId: 'th1', ticketId: 't1', occurredAt: new Date() });
    await new Promise((r) => setTimeout(r, 0));

    expect(pushed.map((p) => p.type)).toEqual(['thread:created', 'thread:updated', 'thread:concluded']);
    expect((pushed[0]!.data as { id: string }).id).toBe('th1');
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — Run le test → FAIL (type `thread.created` inconnu / handler absent).

- [ ] **Step 3: Événements**

Dans `events.ts`, avant `// ── Deliverable events ──` :

```ts
// ── Assistant thread events ──

export interface ThreadCreatedEvent extends DomainEvent {
  type: 'thread.created';
  threadId: string;
  ticketId: string;
}

export interface ThreadUpdatedEvent extends DomainEvent {
  type: 'thread.updated';
  threadId: string;
  ticketId: string;
}

export interface ThreadConcludedEvent extends DomainEvent {
  type: 'thread.concluded';
  threadId: string;
  ticketId: string;
}
```

et les trois dans l'union `AnyDomainEvent`.

- [ ] **Step 4: Registrar**

`BroadcastRegistrarDeps` gagne `threadStore: ThreadStorePort;`. Dans `register`, après les mention broadcasts :

```ts
    // ── Assistant thread broadcasts ──
    bus.on('thread.created', (e) => this.broadcastThreadEntity(e, 'thread:created'));
    bus.on('thread.updated', (e) => this.broadcastThreadEntity(e, 'thread:updated'));
    bus.on('thread.concluded', (e) => this.broadcastThreadEntity(e, 'thread:concluded'));
```

et la méthode :

```ts
  private async broadcastThreadEntity(event: AnyDomainEvent, wsType: string): Promise<void> {
    if (!('threadId' in event)) return;
    const thread = await this.deps.threadStore.getById((event as { threadId: string }).threadId);
    if (thread) this.ticketBroadcast(wsType, thread.toDTO());
  }
```

`DomainEventListenerDeps` gagne `threadStore: ThreadStorePort` et le passe au `new BroadcastRegistrar({...})` ligne 64 ; idem pour le listener distant s'il construit un registrar. `container.ts` : `threadStore` dans les deux constructions.

- [ ] **Step 5: Vérifier** — test → PASS ; `tsc` serveur → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src packages/server/tests/unit/broadcast-registrar-threads.test.ts
git commit -m "feat(threads): thread.* domain events broadcast on the tickets WS channel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
### Task 8: Extraire `resolveExecutionConfig`

**Files:**
- Create: `packages/server/src/application/utils/resolve-execution-config.ts`
- Modify: `packages/server/src/application/use-cases/execute-agent.ts:734-759` (la méthode privée délègue à l'util)
- Test: `packages/server/tests/unit/resolve-execution-config.test.ts`

**Interfaces:**
- Produces:
```ts
export interface ResolvedExecutionConfig { mode: MentionExecutionMode; model: string; effort?: EffortLevel; fast: boolean }
export function resolveExecutionConfig(
  persona: { executionMode: ExecutionMode; model: string },
  ticket: { conversationMode: ConversationMode; modelOverride: string | null; effortOverride: EffortLevel | null; fastMode: boolean } | null,
  logger?: Pick<LoggerPort, 'warn'>,
): ResolvedExecutionConfig
```

- [ ] **Step 1: Test**

```ts
// packages/server/tests/unit/resolve-execution-config.test.ts
import { describe, it, expect } from 'vitest';
import { resolveExecutionConfig } from '../../src/application/utils/resolve-execution-config.js';

const persona = { executionMode: 'claude_code' as const, model: 'claude-sonnet-5' };

describe('resolveExecutionConfig', () => {
  it('uses the ticket conversation mode and the persona model by default', () => {
    const r = resolveExecutionConfig(persona, { conversationMode: 'edit', modelOverride: null, effortOverride: null, fastMode: false });
    expect(r).toMatchObject({ mode: 'edit', model: 'claude-sonnet-5', fast: false });
  });
  it('a message persona always runs in talk mode', () => {
    const r = resolveExecutionConfig({ ...persona, executionMode: 'message' }, { conversationMode: 'edit', modelOverride: null, effortOverride: null, fastMode: false });
    expect(r.mode).toBe('talk');
  });
  it('the ticket model override wins over the persona model', () => {
    const r = resolveExecutionConfig(persona, { conversationMode: 'plan', modelOverride: 'claude-opus-5', effortOverride: null, fastMode: false });
    expect(r.model).toBe('claude-opus-5');
  });
  it('no ticket → plan mode, persona model', () => {
    expect(resolveExecutionConfig(persona, null)).toMatchObject({ mode: 'plan', model: 'claude-sonnet-5' });
  });
});
```

- [ ] **Step 2: Vérifier l'échec** → FAIL (module introuvable).

- [ ] **Step 3: Implémenter** — copier le corps de `ExecuteAgentUseCase.resolveExecutionConfig` (lignes 734-759) dans la fonction exportée, le `logger?.warn` remplaçant `this.logger.warn`. Dans `execute-agent.ts`, la méthode privée devient `return resolveExecutionConfig(persona, ticket, this.logger);` (import de l'util). Aucun autre changement.

- [ ] **Step 4: Vérifier** — test → PASS ; `vitest run` complet serveur → PASS (aucune régression sur les tests d'`ExecuteAgent`).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/application/utils/resolve-execution-config.ts packages/server/src/application/use-cases/execute-agent.ts packages/server/tests/unit/resolve-execution-config.test.ts
git commit -m "refactor(agents): extract resolveExecutionConfig for reuse by the assistant

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 9: Protocole assistant (prompt, schéma de sortie, parsing)

**Files:**
- Create: `packages/server/src/application/assistant/assistant-protocol.ts`
- Test: `packages/server/tests/unit/assistant-protocol.test.ts`

**Interfaces:**
- Produces:
```ts
export type AssistantAction =
  | { action: 'reply'; message: string; question?: AssistantQuestion | null }
  | { action: 'delegate'; personaName: string; brief: string; forward: string[]; turn: string; message?: string | null }
  | { action: 'continue_thread'; threadId: string; turn: string }
  | { action: 'conclude_thread'; threadId: string; summary: string; message?: string | null; question?: AssistantQuestion | null };
export interface AssistantQuestion { text: string; options: string[] }
export const ASSISTANT_OUTPUT_SCHEMA: Record<string, unknown>;
export function parseAssistantOutput(structured: Record<string, unknown> | null, text: string): AssistantAction | null;
export function buildAssistantSystemPrompt(p: { persona: { soulMd: string; identityMd: string; memoryMd: string }; personas: { name: string; displayName: string; identityMd: string }[]; assistantName: string }): string;
export function buildAssistantUserPrompt(p: { context: TicketContext; threads: AgentThread[]; trigger: AssistantTrigger; turns: TicketComment[] }): string;
export type AssistantTrigger =
  | { kind: 'user_message'; commentId: string }
  | { kind: 'thread_reply'; threadId: string; mentionStatus: 'resolved' | 'waiting_for_info' | 'failed' }
  | { kind: 'conclude_request'; threadId: string };
export function renderQuestion(q: AssistantQuestion | null | undefined): string; // "" ou "\n\n<text>\n- opt\n- opt"
```

- [ ] **Step 1: Test**

```ts
// packages/server/tests/unit/assistant-protocol.test.ts
import { describe, it, expect } from 'vitest';
import { parseAssistantOutput, renderQuestion, buildAssistantSystemPrompt } from '../../src/application/assistant/assistant-protocol.js';

describe('parseAssistantOutput', () => {
  it('accepts a structured reply', () => {
    expect(parseAssistantOutput({ action: 'reply', message: 'Salut' }, '')).toEqual({ action: 'reply', message: 'Salut', question: null });
  });
  it('accepts a delegate with defaults for optional fields', () => {
    const a = parseAssistantOutput({ action: 'delegate', personaName: 'builder', brief: 'Fix e2e', turn: 'Go' }, '');
    expect(a).toEqual({ action: 'delegate', personaName: 'builder', brief: 'Fix e2e', forward: ['ticket'], turn: 'Go', message: null });
  });
  it('falls back to JSON found in the text when structured output is missing', () => {
    const a = parseAssistantOutput(null, 'Voici:\n{"action":"conclude_thread","threadId":"th1","summary":"ok"}');
    expect(a).toMatchObject({ action: 'conclude_thread', threadId: 'th1', summary: 'ok' });
  });
  it('rejects an unknown action or a delegate without persona', () => {
    expect(parseAssistantOutput({ action: 'dance' }, '')).toBeNull();
    expect(parseAssistantOutput({ action: 'delegate', brief: 'x', turn: 'y' }, '')).toBeNull();
    expect(parseAssistantOutput(null, 'plain prose')).toBeNull();
  });
});

describe('renderQuestion', () => {
  it('renders the bullet list parseInlineOptions understands', () => {
    expect(renderQuestion({ text: 'Push it?', options: ['Push it', 'Hold'] })).toBe('\n\nPush it?\n- Push it\n- Hold');
    expect(renderQuestion(null)).toBe('');
    expect(renderQuestion({ text: 'x', options: ['only one'] })).toBe('');
  });
});

describe('buildAssistantSystemPrompt', () => {
  it('lists the delegable personas and the four actions', () => {
    const s = buildAssistantSystemPrompt({
      persona: { soulMd: 'SOUL', identityMd: '', memoryMd: '' }, assistantName: 'Nas',
      personas: [{ name: 'builder', displayName: 'The Builder', identityMd: 'Builds things.' }],
    });
    expect(s).toContain('SOUL');
    expect(s).toContain('@agent:builder');
    for (const a of ['reply', 'delegate', 'continue_thread', 'conclude_thread']) expect(s).toContain(`"${a}"`);
  });
});
```

- [ ] **Step 2: Vérifier l'échec** → FAIL.

- [ ] **Step 3: Implémenter**

```ts
// packages/server/src/application/assistant/assistant-protocol.ts
import type { AgentThread, TicketComment, TicketContext } from '@fleex/shared';

export interface AssistantQuestion { text: string; options: string[] }

export type AssistantTrigger =
  | { kind: 'user_message'; commentId: string }
  | { kind: 'thread_reply'; threadId: string; mentionStatus: 'resolved' | 'waiting_for_info' | 'failed' }
  | { kind: 'conclude_request'; threadId: string };

export type AssistantAction =
  | { action: 'reply'; message: string; question: AssistantQuestion | null }
  | { action: 'delegate'; personaName: string; brief: string; forward: string[]; turn: string; message: string | null }
  | { action: 'continue_thread'; threadId: string; turn: string }
  | { action: 'conclude_thread'; threadId: string; summary: string; message: string | null; question: AssistantQuestion | null };

export const FORWARD_KEYS = ['ticket', 'worktrees', 'pr', 'deliverables'] as const;

export const ASSISTANT_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['reply', 'delegate', 'continue_thread', 'conclude_thread'] },
    message: { type: ['string', 'null'] },
    question: {
      type: ['object', 'null'],
      properties: { text: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
      required: ['text', 'options'],
    },
    personaName: { type: ['string', 'null'] },
    brief: { type: ['string', 'null'] },
    forward: { type: ['array', 'null'], items: { type: 'string', enum: [...FORWARD_KEYS] } },
    turn: { type: ['string', 'null'] },
    threadId: { type: ['string', 'null'] },
    summary: { type: ['string', 'null'] },
  },
  required: ['action'],
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function question(v: unknown): AssistantQuestion | null {
  if (!v || typeof v !== 'object') return null;
  const q = v as { text?: unknown; options?: unknown };
  const text = str(q.text);
  const options = Array.isArray(q.options) ? q.options.map(str).filter((o): o is string => o !== null) : [];
  return text && options.length >= 2 ? { text, options } : null;
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Validates the model's output into exactly one action, or null when unusable. */
export function parseAssistantOutput(structured: Record<string, unknown> | null, text: string): AssistantAction | null {
  const raw = structured ?? extractJson(text);
  if (!raw) return null;
  switch (raw.action) {
    case 'reply': {
      const message = str(raw.message);
      return message ? { action: 'reply', message, question: question(raw.question) } : null;
    }
    case 'delegate': {
      const personaName = str(raw.personaName);
      const brief = str(raw.brief);
      const turn = str(raw.turn);
      if (!personaName || !brief || !turn) return null;
      const forward = Array.isArray(raw.forward)
        ? raw.forward.filter((f): f is string => typeof f === 'string' && (FORWARD_KEYS as readonly string[]).includes(f))
        : [];
      return { action: 'delegate', personaName, brief, forward: forward.length > 0 ? forward : ['ticket'], turn, message: str(raw.message) };
    }
    case 'continue_thread': {
      const threadId = str(raw.threadId);
      const turn = str(raw.turn);
      return threadId && turn ? { action: 'continue_thread', threadId, turn } : null;
    }
    case 'conclude_thread': {
      const threadId = str(raw.threadId);
      const summary = str(raw.summary);
      return threadId && summary
        ? { action: 'conclude_thread', threadId, summary, message: str(raw.message), question: question(raw.question) }
        : null;
    }
    default:
      return null;
  }
}

/** The bullet-list shape `parseInlineOptions` (web) recognises as an inline question. */
export function renderQuestion(q: AssistantQuestion | null | undefined): string {
  if (!q || q.options.length < 2) return '';
  return `\n\n${q.text}\n${q.options.map((o) => `- ${o}`).join('\n')}`;
}

export function buildAssistantSystemPrompt(p: {
  persona: { soulMd: string; identityMd: string; memoryMd: string };
  personas: { name: string; displayName: string; identityMd: string }[];
  assistantName: string;
}): string {
  const identity = [p.persona.soulMd, p.persona.identityMd, p.persona.memoryMd].filter((s) => s.trim().length > 0).join('\n\n---\n\n');
  const roster = p.personas
    .map((x) => `- @agent:${x.name} — ${x.displayName}${x.identityMd.trim() ? ` : ${x.identityMd.trim().split('\n')[0]!.slice(0, 160)}` : ''}`)
    .join('\n');
  return `${identity ? `${identity}\n\n---\n\n` : ''}# Rôle : assistant du ticket (« ${p.assistantName} »)

Tu es l'interlocuteur de l'utilisateur sur ce ticket. Tu lis chaque message, puis tu choisis EXACTEMENT UNE action et tu réponds UNIQUEMENT avec un objet JSON conforme au schéma fourni.

## Actions
- "reply" : répondre à l'utilisateur dans le fil principal (\`message\`, + \`question\` {text, options} si tu attends un choix).
- "delegate" : ouvrir un thread avec une persona (\`personaName\` = clé après @agent:, \`brief\` une ligne, \`forward\` parmi ticket|worktrees|pr|deliverables, \`turn\` = le message complet adressé à l'agent avec tout le contexte utile, \`message\` optionnel = annonce dans le fil principal, ex. « Je vois ça avec The Builder »).
- "continue_thread" : envoyer un nouveau tour à l'agent d'un thread ouvert (\`threadId\`, \`turn\`). Si l'agent a posé une question et que le contexte du ticket contient la réponse, réponds-lui ici.
- "conclude_thread" : clore un thread (\`threadId\`, \`summary\` ≤ 3 lignes, + \`message\`/\`question\` optionnels pour le fil principal).

## Règles
- Délègue quand la demande exige du code, une analyse de dépôt ou l'expertise d'une persona ; réponds toi-même sinon.
- Un \`@agent:x\` dans le message de l'utilisateur est une consigne explicite de délégation à x.
- Un seul thread ouvert par persona et par ticket : s'il existe, utilise "continue_thread".
- Si l'agent attend une information que seul l'utilisateur détient, utilise "reply" avec une \`question\` ; ne l'invente jamais.
- Conclus dès que la réponse de l'agent est finale. Sur une demande de conclusion, la seule action valide est "conclude_thread".
- Réponds dans la langue de l'utilisateur. N'affirme rien sur l'état du ticket qui ne soit dans le contexte.

## Personas disponibles
${roster || '(aucune persona déléguable)'}`;
}

function renderComment(c: TicketComment): string {
  const who = c.authorType === 'user' ? 'Utilisateur' : c.authorType === 'assistant' ? 'Assistant' : c.authorName;
  return `[${c.createdAt}] ${who}${c.threadId ? ` (thread ${c.threadId})` : ''} : ${c.body}`;
}

export function buildAssistantUserPrompt(p: {
  context: TicketContext;
  threads: AgentThread[];
  trigger: AssistantTrigger;
  turns: TicketComment[];
}): string {
  const t = p.context.ticket;
  const main = p.context.comments.filter((c) => !c.threadId).slice(-30).map(renderComment).join('\n');
  const threads = p.threads.length
    ? p.threads.map((th) => `- ${th.id} · @agent:${th.personaName} · ${th.status} · ${th.exchanges} tours · « ${th.brief} »`).join('\n')
    : '(aucun)';
  const turns = p.turns.length ? p.turns.map(renderComment).join('\n') : '(aucun)';
  const deliverables = p.context.deliverables.slice(-10).map((d) => `- ${d.title} (${d.status})`).join('\n') || '(aucun)';
  let trigger: string;
  switch (p.trigger.kind) {
    case 'user_message': {
      const c = p.context.comments.find((x) => x.id === p.trigger.commentId);
      trigger = `Nouveau message de l'utilisateur :\n${c ? c.body : '(introuvable)'}`;
      break;
    }
    case 'thread_reply':
      trigger = p.trigger.mentionStatus === 'failed'
        ? `L'exécution de l'agent du thread ${p.trigger.threadId} a échoué. Informe l'utilisateur ("reply") ou relance ("continue_thread").`
        : `L'agent du thread ${p.trigger.threadId} a répondu (statut de sa mention : ${p.trigger.mentionStatus}). Décide : continuer, conclure, ou relayer une question à l'utilisateur.`;
      break;
    case 'conclude_request':
      trigger = `L'utilisateur demande de conclure le thread ${p.trigger.threadId} maintenant. Réponds avec "conclude_thread".`;
      break;
  }
  return `# Ticket #${t.displayId} — ${t.title}
Statut : ${t.status} · Type : ${t.type ?? '-'} · Priorité : ${t.priority}
${t.description ? `\n## Description\n${t.description}\n` : ''}
## Fil principal (30 derniers)
${main || '(vide)'}

## Threads du ticket
${threads}

## Tours du thread concerné
${turns}

## Livrables
${deliverables}

## Déclencheur
${trigger}`;
}
```

- [ ] **Step 4: Vérifier** → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/application/assistant packages/server/tests/unit/assistant-protocol.test.ts
git commit -m "feat(threads): assistant protocol — prompt, output schema, parser

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
### Task 10: `RunAssistantTurnUseCase`

**Files:**
- Create: `packages/server/src/application/use-cases/run-assistant-turn.ts`
- Test: `packages/server/tests/unit/run-assistant-turn.test.ts`

**Interfaces:**
- Consumes: `AgentThreadEntity` (Task 3), `ThreadStorePort` (Task 4), `PostCommentUseCase.execute({ threadId, suppressMentionForAgents, … })` (Task 5), `resolveExecutionConfig` (Task 8), `assistant-protocol` (Task 9), `ExecuteAgentUseCase.cancelExecutionForMention(mentionId)`, `ExecuteAgentUseCase.wakeUp(mention)`, `streamSdkQuery`, `buildSdkOptions`, `buildExecutionStartData`.
- Produces:
```ts
export type SdkRunner = (p: { prompt: string; queryOptions: Record<string, unknown>; emitEvent: (t: AgentEventType, d: unknown) => Promise<void> | void; onSessionId: (sid: string) => void }) => Promise<{ resultText: string; structuredOutput: Record<string, unknown> | null; metrics: SdkQueryMetrics }>;
export class RunAssistantTurnUseCase {
  public onEvent: ((e: AgentEventEntity) => void) | null;
  constructor(deps: RunAssistantTurnDeps, sdkRunner?: SdkRunner);
  resolveAssistantPersona(ticket: TicketEntity): Promise<AgentPersonaEntity | null>;
  execute(params: { ticketId: string; trigger: AssistantTrigger }): Promise<void>;  // sérialisé par ticket
}
export const MAX_ASSISTANT_TURNS_PER_THREAD = 8;
```

- [ ] **Step 1: Test** (fakes en mémoire ; le runner SDK est injecté et retourne l'action programmée)

```ts
// packages/server/tests/unit/run-assistant-turn.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { RunAssistantTurnUseCase, type SdkRunner } from '../../src/application/use-cases/run-assistant-turn.js';
import { PostCommentUseCase } from '../../src/application/use-cases/post-comment.js';
import { EventBus } from '../../src/application/event-bus.js';
import { AgentPersonaEntity } from '../../src/domain/entities/agent-persona.entity.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import type { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import type { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';

const logger = { info() {}, warn() {}, error() {}, debug() {} };

class FakeCommentStore {
  saved: TicketCommentEntity[] = [];
  async save(c: TicketCommentEntity) { this.saved.push(c); }
  async getById(id: string) { return this.saved.find((c) => c.id === id) ?? null; }
  async getByTicket(ticketId: string) { return this.saved.filter((c) => c.ticketId === ticketId); }
}
class FakeMentionStore {
  saved: TicketMentionEntity[] = [];
  async save(m: TicketMentionEntity) { const i = this.saved.findIndex((x) => x.id === m.id); if (i >= 0) this.saved[i] = m; else this.saved.push(m); }
  async getById(id: string) { return this.saved.find((m) => m.id === id) ?? null; }
  async getByTicket(ticketId: string) { return this.saved.filter((m) => m.ticketId === ticketId); }
}
class FakeThreadStore {
  saved = new Map<string, AgentThreadEntity>();
  async getById(id: string) { return this.saved.get(id) ?? null; }
  async getByTicket(ticketId: string) { return [...this.saved.values()].filter((t) => t.ticketId === ticketId); }
  async getByCurrentMentionId(m: string) { return [...this.saved.values()].find((t) => t.currentMentionId === m) ?? null; }
  async getOpen() { return [...this.saved.values()].filter((t) => !t.isTerminal); }
  async save(t: AgentThreadEntity) { this.saved.set(t.id, t); }
}
class FakeAgentEventStore {
  executions: unknown[] = []; events: unknown[] = []; sessions = new Map<string, string>();
  async startExecution(p: unknown) { this.executions.push(p); }
  async appendEvent(e: unknown) { this.events.push(e); }
  async completeExecution() {}
  async updateSessionId(_e: string, sid: string) { this.sessions.set('last', sid); }
  async getSessionHistory() { return new Map(); }
}
class FakeExecuteAgent {
  cancelled: string[] = []; woken: string[] = [];
  async cancelExecutionForMention(id: string) { this.cancelled.push(id); return true; }
  async wakeUp(m: TicketMentionEntity) { this.woken.push(m.id); }
}

function persona(name: string, id = `p-${name}`) {
  return AgentPersonaEntity.create({ id, name, displayName: name === 'nas' ? 'Nas' : 'The Builder' });
}

function harness(actions: Array<Record<string, unknown>>) {
  const ticket = TicketEntity.create({ id: 't1', boardId: 'b', displayId: 1, title: 'e2e rouges' });
  ticket.updateExecutionConfig({ assistantPersonaId: 'p-nas' });
  const personas = [persona('nas'), persona('builder')];
  const comments = new FakeCommentStore();
  const mentions = new FakeMentionStore();
  const threads = new FakeThreadStore();
  const agentEvents = new FakeAgentEventStore();
  const executeAgent = new FakeExecuteAgent();
  const eventBus = new EventBus();
  const emitted: string[] = [];
  eventBus.on('*', (e) => { emitted.push(e.type); });
  const postComment = new PostCommentUseCase(comments as never, mentions as never, { saveActivity: async () => {} } as never, logger as never);
  const runner: SdkRunner = async () => ({ resultText: '', structuredOutput: actions.shift() ?? null, metrics: {} });
  const uc = new RunAssistantTurnUseCase({
    threadStore: threads as never, commentStore: comments as never, mentionStore: mentions as never,
    ticketStore: { getTicketById: async () => ticket } as never,
    personaStore: { getById: async (id: string) => personas.find((p) => p.id === id) ?? null, getByName: async (n: string) => personas.find((p) => p.name === n) ?? null, getAll: async () => personas } as never,
    postComment,
    getTicketContext: { execute: async () => ({ ticket: ticket.toDTO(), comments: (await comments.getByTicket('t1')).map((c) => c.toDTO()), mentions: { pending: [], all: [] }, deliverables: [], activity: [], relevantSummaries: [], epics: [], memorySnippets: [] }) } as never,
    agentEventStore: agentEvents as never, executeAgent: executeAgent as never,
    config: { get: () => ({ basePath: '', defaultShell: '', repositoryRefreshIntervalMs: 0 }) } as never,
    eventBus, logger: logger as never,
  }, runner);
  return { uc, ticket, comments, mentions, threads, agentEvents, executeAgent, emitted };
}

describe('RunAssistantTurnUseCase', () => {
  it('reply → one assistant comment in the main stream, no thread', async () => {
    const h = harness([{ action: 'reply', message: 'Bonjour', question: { text: 'On y va ?', options: ['Oui', 'Non'] } }]);
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'user_message', commentId: 'c0' } });
    expect(h.comments.saved).toHaveLength(1);
    const c = h.comments.saved[0]!;
    expect(c.authorType).toBe('assistant');
    expect(c.authorName).toBe('Nas');
    expect(c.threadId).toBeNull();
    expect(c.body).toBe('Bonjour\n\nOn y va ?\n- Oui\n- Non');
    expect(h.threads.saved.size).toBe(0);
    expect(h.emitted).toContain('comment.posted');
    expect(h.agentEvents.executions).toHaveLength(1);
    expect((h.agentEvents.executions[0] as { mentionId: string }).mentionId).toMatch(/^assistant:/);
  });

  it('delegate → announcement, thread, opening turn with a mention, thread.created', async () => {
    const h = harness([{ action: 'delegate', personaName: 'builder', brief: 'Fix e2e', forward: ['ticket', 'pr'], turn: 'Corrige les e2e', message: 'Je vois ça avec The Builder' }]);
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'user_message', commentId: 'c0' } });
    expect(h.comments.saved.map((c) => [c.threadId === null, c.body])).toEqual([
      [true, 'Je vois ça avec The Builder'],
      [false, '@agent:builder Corrige les e2e'],
    ]);
    const thread = [...h.threads.saved.values()][0]!;
    expect(thread.personaName).toBe('builder');
    expect(thread.status).toBe('running');
    expect(thread.exchanges).toBe(1);
    expect(h.mentions.saved).toHaveLength(1);
    expect(thread.currentMentionId).toBe(h.mentions.saved[0]!.id);
    expect(h.emitted).toEqual(expect.arrayContaining(['thread.created', 'mention.created', 'comment.posted']));
  });

  it('delegate on a persona that already has an open thread becomes continue_thread', async () => {
    const h = harness([
      { action: 'delegate', personaName: 'builder', brief: 'A', turn: 'un' },
      { action: 'delegate', personaName: 'builder', brief: 'B', turn: 'deux' },
    ]);
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'user_message', commentId: 'c0' } });
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'user_message', commentId: 'c1' } });
    expect(h.threads.saved.size).toBe(1);
    expect([...h.threads.saved.values()][0]!.exchanges).toBe(2);
    expect(h.mentions.saved).toHaveLength(2);
  });

  it('continue_thread on a waiting thread wakes the existing mention instead of creating one', async () => {
    const h = harness([
      { action: 'delegate', personaName: 'builder', brief: 'A', turn: 'un' },
      { action: 'continue_thread', threadId: 'SET_BELOW', turn: 'voici la réponse' },
    ]);
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'user_message', commentId: 'c0' } });
    const thread = [...h.threads.saved.values()][0]!;
    thread.markWaiting(); await h.threads.save(thread);
    const m = h.mentions.saved[0]!; m.acknowledge(); m.waitForInfo(); await h.mentions.save(m);
    // patch the programmed action with the real thread id
    (h.uc as unknown as { deps: unknown }); // no-op, keeps TS quiet
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: thread.id, mentionStatus: 'waiting_for_info' } });
    expect(h.mentions.saved).toHaveLength(1);
    expect(h.executeAgent.woken).toEqual([m.id]);
    expect(h.comments.saved.at(-1)!.threadId).toBe(thread.id);
    expect(thread.status).toBe('running');
  });

  it('conclude_thread → summary, terminal status, main-stream report, cancel of a live mention', async () => {
    const h = harness([
      { action: 'delegate', personaName: 'builder', brief: 'A', turn: 'un' },
      { action: 'conclude_thread', threadId: 'SET_BELOW', summary: 'Fix livré.', question: { text: 'Push ?', options: ['Push it', 'Hold'] } },
    ]);
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'user_message', commentId: 'c0' } });
    const thread = [...h.threads.saved.values()][0]!;
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'conclude_request', threadId: thread.id } });
    expect(thread.status).toBe('concluded');
    expect(thread.summary).toBe('Fix livré.');
    expect(h.executeAgent.cancelled).toEqual([thread.currentMentionId]);
    expect(h.mentions.saved[0]!.status).toBe('resolved');
    const report = h.comments.saved.at(-1)!;
    expect(report.threadId).toBeNull();
    expect(report.body).toBe('Retour de The Builder : Fix livré.\n\nPush ?\n- Push it\n- Hold');
    expect(h.emitted).toContain('thread.concluded');
  });

  it('conclude_request forces conclude_thread whatever the model answers', async () => {
    const h = harness([
      { action: 'delegate', personaName: 'builder', brief: 'A', turn: 'un' },
      { action: 'reply', message: 'je préfère continuer' },
    ]);
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'user_message', commentId: 'c0' } });
    const thread = [...h.threads.saved.values()][0]!;
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'conclude_request', threadId: thread.id } });
    expect(thread.status).toBe('concluded');
    expect(thread.summary).toBe('je préfère continuer');
  });

  it('invalid output → one short assistant comment, nothing else', async () => {
    const h = harness([{ action: 'dance' }]);
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'user_message', commentId: 'c0' } });
    expect(h.comments.saved).toHaveLength(1);
    expect(h.comments.saved[0]!.body).toMatch(/pas pu traiter/);
    expect(h.threads.saved.size).toBe(0);
  });

  it('does nothing when no assistant persona is configured', async () => {
    const h = harness([{ action: 'reply', message: 'x' }]);
    h.ticket.updateExecutionConfig({ assistantPersonaId: null });
    await h.uc.execute({ ticketId: 't1', trigger: { kind: 'user_message', commentId: 'c0' } });
    expect(h.comments.saved).toHaveLength(0);
  });

  it('serialises turns per ticket', async () => {
    const order: string[] = [];
    const h = harness([]);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let n = 0;
    (h.uc as unknown as { sdkRunner: SdkRunner }).sdkRunner = async () => {
      const me = ++n; order.push(`start${me}`);
      if (me === 1) await gate;
      order.push(`end${me}`);
      return { resultText: '', structuredOutput: { action: 'reply', message: `r${me}` }, metrics: {} };
    };
    const p1 = h.uc.execute({ ticketId: 't1', trigger: { kind: 'user_message', commentId: 'a' } });
    const p2 = h.uc.execute({ ticketId: 't1', trigger: { kind: 'user_message', commentId: 'b' } });
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([p1, p2]);
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2']);
  });
});
```

Note pour les deux tests marqués `SET_BELOW` : le runner du harness lit `actions.shift()` au moment de l'appel ; remplacer `'SET_BELOW'` par l'id réel avant le second `execute` (`actions[0].threadId = thread.id` — exposer le tableau `actions` depuis `harness` pour cela). Ajuster le harness en conséquence ; c'est un détail de test, pas de code de production.

- [ ] **Step 2: Vérifier l'échec** — Run: `(cd packages/server && ../../node_modules/.bin/vitest run tests/unit/run-assistant-turn.test.ts)` → FAIL (module introuvable).

- [ ] **Step 3: Implémenter**

```ts
// packages/server/src/application/use-cases/run-assistant-turn.ts
import { randomUUID } from 'node:crypto';
import type { AgentEventType } from '@fleex/shared';
import { AgentEventEntity } from '../../domain/entities/agent-event.entity.js';
import { AgentThreadEntity } from '../../domain/entities/agent-thread.entity.js';
import type { AgentPersonaEntity } from '../../domain/entities/agent-persona.entity.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import type { ThreadStorePort } from '../ports/thread-store.port.js';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { EventBus } from '../event-bus.js';
import type { PostCommentUseCase } from './post-comment.js';
import type { GetTicketContextUseCase } from './get-ticket-context.js';
import type { ExecuteAgentUseCase } from './execute-agent.js';
import { buildSdkOptions } from '../utils/build-sdk-options.js';
import { streamSdkQuery, type SdkQueryMetrics } from '../utils/stream-sdk-query.js';
import { buildExecutionStartData } from '../utils/build-execution-start-data.js';
import { resolveExecutionConfig } from '../utils/resolve-execution-config.js';
import {
  ASSISTANT_OUTPUT_SCHEMA, buildAssistantSystemPrompt, buildAssistantUserPrompt, parseAssistantOutput, renderQuestion,
  type AssistantAction, type AssistantTrigger,
} from '../assistant/assistant-protocol.js';

export const MAX_ASSISTANT_TURNS_PER_THREAD = 8;

export type SdkRunner = (p: {
  prompt: string;
  queryOptions: Record<string, unknown>;
  emitEvent: (t: AgentEventType, d: unknown) => Promise<void> | void;
  onSessionId: (sid: string) => void;
}) => Promise<{ resultText: string; structuredOutput: Record<string, unknown> | null; metrics: SdkQueryMetrics }>;

export interface RunAssistantTurnDeps {
  threadStore: ThreadStorePort;
  commentStore: CommentStorePort;
  mentionStore: MentionStorePort;
  ticketStore: TicketStorePort;
  personaStore: PersonaStorePort;
  postComment: PostCommentUseCase;
  getTicketContext: GetTicketContextUseCase;
  agentEventStore: AgentEventStorePort;
  executeAgent: Pick<ExecuteAgentUseCase, 'cancelExecutionForMention' | 'wakeUp'>;
  config: ConfigPort;
  eventBus: EventBus;
  logger: LoggerPort;
}

/**
 * One assistant turn: read the ticket, ask the assistant persona for exactly one
 * action, apply it. Turns on the same ticket are serialised; nothing here loops —
 * the next turn only comes from a new event (user message, agent reply, conclude).
 */
export class RunAssistantTurnUseCase {
  /** Set by the WS plugin to stream agent events live (same as ExecuteAgent). */
  public onEvent: ((event: AgentEventEntity) => void) | null = null;
  private lanes = new Map<string, Promise<void>>();
  private sessions = new Map<string, string>(); // `${personaId}:${ticketId}` → sdk session id
  private sessionsLoaded = false;

  constructor(
    private readonly deps: RunAssistantTurnDeps,
    private sdkRunner: SdkRunner = (p) => streamSdkQuery({ prompt: p.prompt, queryOptions: p.queryOptions, emitEvent: p.emitEvent, onSessionId: p.onSessionId }),
  ) {}

  async resolveAssistantPersona(ticket: TicketEntity): Promise<AgentPersonaEntity | null> {
    const id = ticket.assistantPersonaId ?? this.deps.config.get().defaultAssistantPersonaId ?? null;
    return id ? this.deps.personaStore.getById(id) : null;
  }

  execute(params: { ticketId: string; trigger: AssistantTrigger }): Promise<void> {
    const prev = this.lanes.get(params.ticketId) ?? Promise.resolve();
    const run = prev.then(() => this.runTurn(params)).catch((err) => {
      this.deps.logger.error('Assistant turn failed', { ticketId: params.ticketId, error: err instanceof Error ? err.message : String(err) });
    });
    this.lanes.set(params.ticketId, run);
    return run;
  }

  private async runTurn({ ticketId, trigger }: { ticketId: string; trigger: AssistantTrigger }): Promise<void> {
    const ticket = await this.deps.ticketStore.getTicketById(ticketId);
    if (!ticket) return;
    const assistant = await this.resolveAssistantPersona(ticket);
    if (!assistant) {
      this.deps.logger.info('No assistant persona configured; skipping turn', { ticketId });
      return;
    }

    const [context, allThreads, personas] = await Promise.all([
      this.deps.getTicketContext.execute({ ticketId, agentName: assistant.name }),
      this.deps.threadStore.getByTicket(ticketId),
      this.deps.personaStore.getAll(),
    ]);
    const threadId = trigger.kind === 'user_message' ? null : trigger.threadId;
    const turns = threadId ? context.comments.filter((c) => c.threadId === threadId) : [];

    const systemPrompt = buildAssistantSystemPrompt({
      persona: assistant,
      assistantName: assistant.displayName || assistant.name,
      personas: personas.filter((p) => p.id !== assistant.id).map((p) => ({ name: p.name, displayName: p.displayName, identityMd: p.identityMd })),
    });
    const prompt = buildAssistantUserPrompt({ context, threads: allThreads.map((t) => t.toDTO()), trigger, turns });

    const resolved = resolveExecutionConfig(assistant, ticket, this.deps.logger);
    const sessionKey = `${assistant.id}:${ticketId}`;
    const previousSessionId = await this.previousSession(sessionKey);
    const executionId = randomUUID();
    const turnId = randomUUID();

    await this.deps.agentEventStore.startExecution({
      executionId, personaId: assistant.id, ticketId, mentionId: `assistant:${turnId}`,
      model: resolved.model, effort: resolved.effort, fast: resolved.fast,
    });
    let sequence = 0;
    const emitEvent = async (eventType: AgentEventType, data: unknown) => {
      const event = AgentEventEntity.create({ executionId, eventType, data, sequence: sequence++ });
      await this.deps.agentEventStore.appendEvent(event);
      this.onEvent?.(event);
    };
    await emitEvent('execution_start', buildExecutionStartData({
      executionId, personaId: assistant.id, personaName: assistant.name, ticketId, mentionId: `assistant:${turnId}`,
      model: resolved.model, effectiveMode: 'talk', worktreePath: null, resumeSessionId: previousSessionId ?? null,
      kind: 'assistant', maxTurns: 0, systemPromptSections: ['Assistant protocol'], systemPromptLength: systemPrompt.length,
      userPromptLength: prompt.length, ticketTitle: context.ticket.title, ticketStatus: context.ticket.status,
      commentsCount: context.comments.length, deliverablesCount: context.deliverables.length,
    }));

    const queryOptions = buildSdkOptions('talk', {
      model: resolved.model, systemPrompt, outputFormat: ASSISTANT_OUTPUT_SCHEMA,
      effort: resolved.effort, fast: resolved.fast, maxTurns: this.deps.config.get().agentMaxTurns,
    });
    if (previousSessionId) queryOptions.resume = previousSessionId; // talk mode never sets resume itself

    let action: AssistantAction | null = null;
    try {
      const result = await this.sdkRunner({
        prompt, queryOptions, emitEvent,
        onSessionId: (sid) => { this.sessions.set(sessionKey, sid); void this.deps.agentEventStore.updateSessionId(executionId, sid); },
      });
      action = parseAssistantOutput(result.structuredOutput, result.resultText);
      await this.deps.agentEventStore.completeExecution(executionId, 'completed', { model: resolved.model, effectiveMode: 'talk', ...result.metrics });
      await emitEvent('execution_end', { status: 'completed', ticketId, effectiveMode: 'talk', model: resolved.model, ...result.metrics });
    } catch (err) {
      await this.deps.agentEventStore.completeExecution(executionId, 'failed', { model: resolved.model, effectiveMode: 'talk' });
      await emitEvent('execution_end', { status: 'failed', ticketId, effectiveMode: 'talk', model: resolved.model, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }

    if (trigger.kind === 'conclude_request') action = this.forceConclude(trigger.threadId, action);

    if (!action) {
      this.deps.logger.warn('Assistant produced no usable action', { ticketId, executionId });
      await this.postAssistant(ticket, assistant, null, "Je n'ai pas pu traiter ce message. Reformule, ou réessaie.");
      return;
    }
    await this.apply(ticket, assistant, action, allThreads);
  }

  private forceConclude(threadId: string, action: AssistantAction | null): AssistantAction {
    if (action?.action === 'conclude_thread') return { ...action, threadId };
    const summary =
      (action && 'summary' in action && action.summary) ||
      (action && 'message' in action && action.message) ||
      "Thread conclu à la demande de l'utilisateur.";
    return { action: 'conclude_thread', threadId, summary, message: null, question: null };
  }

  private async apply(ticket: TicketEntity, assistant: AgentPersonaEntity, action: AssistantAction, threads: AgentThreadEntity[]): Promise<void> {
    switch (action.action) {
      case 'reply':
        await this.postAssistant(ticket, assistant, null, action.message + renderQuestion(action.question));
        return;

      case 'delegate': {
        const open = threads.find((t) => t.personaName === action.personaName && !t.isTerminal);
        if (open) {
          await this.continueThread(ticket, assistant, open, action.turn);
          return;
        }
        const target = await this.deps.personaStore.getByName(action.personaName);
        if (!target) {
          await this.postAssistant(ticket, assistant, null, `Je ne connais pas de persona « ${action.personaName} ».`);
          return;
        }
        if (action.message) await this.postAssistant(ticket, assistant, null, action.message);
        const thread = AgentThreadEntity.create({
          id: randomUUID(), ticketId: ticket.id, personaId: target.id, personaName: target.name,
          assistantPersonaId: assistant.id, brief: action.brief, forwardedContext: action.forward,
        });
        await this.deps.threadStore.save(thread);
        this.emit({ type: 'thread.created', threadId: thread.id, ticketId: ticket.id, occurredAt: new Date() });
        await this.openTurn(ticket, assistant, thread, action.turn);
        return;
      }

      case 'continue_thread': {
        const thread = threads.find((t) => t.id === action.threadId);
        if (!thread || thread.isTerminal) {
          await this.postAssistant(ticket, assistant, null, 'Ce thread est déjà clos.');
          return;
        }
        await this.continueThread(ticket, assistant, thread, action.turn);
        return;
      }

      case 'conclude_thread': {
        const thread = threads.find((t) => t.id === action.threadId);
        if (!thread || thread.isTerminal) return;
        const target = await this.deps.personaStore.getByName(thread.personaName);
        const mentionId = thread.currentMentionId;
        thread.conclude(action.summary);
        await this.deps.threadStore.save(thread);
        if (mentionId) {
          const mention = await this.deps.mentionStore.getById(mentionId);
          if (mention && mention.status !== 'resolved') {
            await this.deps.executeAgent.cancelExecutionForMention(mentionId);
            mention.resolve();
            await this.deps.mentionStore.save(mention);
            this.emit({ type: 'mention.resolved', mentionId, ticketId: ticket.id, targetAgent: mention.targetAgent, resolvedBy: assistant.name, occurredAt: new Date() });
          }
        }
        const who = target?.displayName || thread.personaName;
        await this.postAssistant(ticket, assistant, null, `${action.message ? `${action.message}\n\n` : ''}Retour de ${who} : ${action.summary}${renderQuestion(action.question)}`);
        this.emit({ type: 'thread.concluded', threadId: thread.id, ticketId: ticket.id, occurredAt: new Date() });
        return;
      }
    }
  }

  /** Assistant turn inside a thread: wake a waiting mention, or open a new one. */
  private async continueThread(ticket: TicketEntity, assistant: AgentPersonaEntity, thread: AgentThreadEntity, turn: string): Promise<void> {
    const assistantTurns = (await this.deps.commentStore.getByTicket(ticket.id))
      .filter((c) => c.threadId === thread.id && c.authorType === 'assistant').length;
    if (assistantTurns >= MAX_ASSISTANT_TURNS_PER_THREAD) {
      await this.apply(ticket, assistant, {
        action: 'conclude_thread', threadId: thread.id, message: null, question: null,
        summary: `Thread interrompu après ${assistantTurns} échanges sans conclusion.`,
      }, [thread]);
      return;
    }
    const current = thread.currentMentionId ? await this.deps.mentionStore.getById(thread.currentMentionId) : null;
    if (current && current.status === 'waiting_for_info') {
      // Answer the agent's question: same mention, resumed session.
      await this.postAssistant(ticket, assistant, thread.id, `@agent:${thread.personaName} ${turn}`, { suppressMentionForAgents: [thread.personaName] });
      thread.recordUserTurn(); // counts the assistant's turn; naming kept generic in the entity
      thread.markRunning();
      await this.deps.threadStore.save(thread);
      await this.deps.executeAgent.wakeUp(current);
      this.emit({ type: 'thread.updated', threadId: thread.id, ticketId: ticket.id, occurredAt: new Date() });
      return;
    }
    await this.openTurn(ticket, assistant, thread, turn);
  }

  /** Post `@agent:<persona> <turn>` in the thread → new mention → ExecuteAgent. */
  private async openTurn(ticket: TicketEntity, assistant: AgentPersonaEntity, thread: AgentThreadEntity, turn: string): Promise<void> {
    const { createdMentions } = await this.postAssistant(ticket, assistant, thread.id, `@agent:${thread.personaName} ${turn}`);
    const mention = createdMentions.find((m) => m.targetAgent === thread.personaName);
    if (mention) thread.openTurn(mention.id);
    else thread.recordUserTurn();
    await this.deps.threadStore.save(thread);
    this.emit({ type: 'thread.updated', threadId: thread.id, ticketId: ticket.id, occurredAt: new Date() });
  }

  private async postAssistant(
    ticket: TicketEntity, assistant: AgentPersonaEntity, threadId: string | null, body: string,
    extra: { suppressMentionForAgents?: string[] } = {},
  ) {
    const authorName = assistant.displayName || assistant.name;
    const result = await this.deps.postComment.execute({
      ticketId: ticket.id, authorType: 'assistant', authorName, body, threadId, ...extra,
    });
    const now = new Date();
    this.emit({
      type: 'comment.posted', commentId: result.comment.id, ticketId: ticket.id, authorType: 'assistant', authorName,
      createdMentions: result.createdMentions.map((m) => ({ mentionId: m.id, targetAgent: m.targetAgent, targetType: m.targetType })),
      occurredAt: now,
    });
    for (const m of result.createdMentions) {
      this.emit({ type: 'mention.created', mentionId: m.id, ticketId: ticket.id, targetAgent: m.targetAgent, targetType: m.targetType, sourceAgent: m.sourceAgent, occurredAt: now });
    }
    return result;
  }

  private async previousSession(key: string): Promise<string | undefined> {
    if (!this.sessionsLoaded) {
      this.sessionsLoaded = true;
      for (const [k, v] of await this.deps.agentEventStore.getSessionHistory()) {
        if (!this.sessions.has(k)) this.sessions.set(k, v.sdkSessionId);
      }
    }
    return this.sessions.get(key);
  }

  private emit(event: Parameters<EventBus['emit']>[0]): void {
    this.deps.eventBus.emit(event);
  }
}
```

Remarque : `thread.recordUserTurn()` est utilisé pour compter un tour assistant qui n'ouvre pas de mention ; si le nom gêne, renommer la méthode de l'entité en `recordTurn()` (Task 3) et mettre à jour son test — même sémantique.

- [ ] **Step 4: Vérifier** — test → PASS (9 tests) ; `tsc` serveur → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/application/use-cases/run-assistant-turn.ts packages/server/tests/unit/run-assistant-turn.test.ts
git commit -m "feat(threads): RunAssistantTurn — one SDK talk turn, one action, per-ticket lane

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
### Task 11: `AssistantThreadListener`

**Files:**
- Create: `packages/server/src/application/assistant-thread-listener.ts`
- Test: `packages/server/tests/unit/assistant-thread-listener.test.ts`

**Interfaces:**
- Consumes: `ThreadStorePort`, `RunAssistantTurnUseCase.execute`, `CommentStorePort.getById`.
- Produces: `new AssistantThreadListener({ eventBus, threadStore, commentStore, runAssistantTurn, logger }).register()`.

- [ ] **Step 1: Test**

```ts
// packages/server/tests/unit/assistant-thread-listener.test.ts
import { describe, it, expect } from 'vitest';
import { EventBus } from '../../src/application/event-bus.js';
import { AssistantThreadListener } from '../../src/application/assistant-thread-listener.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const thread = AgentThreadEntity.create({ id: 'th1', ticketId: 't1', personaId: 'p', personaName: 'builder', assistantPersonaId: 'pa', brief: 'b', forwardedContext: [] });
  thread.openTurn('m1');
  const saved: string[] = [];
  const threadStore = {
    getByCurrentMentionId: async (id: string) => (id === 'm1' ? thread : null),
    getById: async (id: string) => (id === 'th1' ? thread : null),
    save: async (t: AgentThreadEntity) => { saved.push(t.status); },
  };
  const turns: unknown[] = [];
  const runAssistantTurn = { execute: async (p: unknown) => { turns.push(p); } };
  const commentStore = { getById: async (id: string) => (id === 'c-thread' ? { threadId: 'th1', authorType: 'user' } : { threadId: null, authorType: 'user' }) };
  const bus = new EventBus();
  const emitted: string[] = [];
  bus.on('thread.updated', () => { emitted.push('thread.updated'); });
  new AssistantThreadListener({ eventBus: bus, threadStore: threadStore as never, commentStore: commentStore as never, runAssistantTurn: runAssistantTurn as never, logger: logger as never }).register();
  return { bus, thread, saved, turns, emitted };
}

describe('AssistantThreadListener', () => {
  it('mention.resolved on the thread mention → agent turn counted, assistant re-run', async () => {
    const s = setup();
    s.bus.emit({ type: 'mention.resolved', mentionId: 'm1', ticketId: 't1', targetAgent: 'builder', resolvedBy: 'builder', occurredAt: new Date() });
    await tick();
    expect(s.thread.exchanges).toBe(2);
    expect(s.saved).toEqual(['running']);
    expect(s.turns).toEqual([{ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: 'th1', mentionStatus: 'resolved' } }]);
    expect(s.emitted).toEqual(['thread.updated']);
  });

  it('mention.waiting_for_info → thread waiting, assistant re-run', async () => {
    const s = setup();
    s.bus.emit({ type: 'mention.waiting_for_info', mentionId: 'm1', ticketId: 't1', targetAgent: 'builder', occurredAt: new Date() });
    await tick();
    expect(s.thread.status).toBe('waiting');
    expect(s.turns).toHaveLength(1);
  });

  it('mention.execution_failed → thread failed, assistant informed', async () => {
    const s = setup();
    s.bus.emit({ type: 'mention.execution_failed', mentionId: 'm1', ticketId: 't1', targetAgent: 'builder', reason: 'crash', message: 'x', occurredAt: new Date() });
    await tick();
    expect(s.thread.status).toBe('failed');
    expect((s.turns[0] as { trigger: { mentionStatus: string } }).trigger.mentionStatus).toBe('failed');
  });

  it('mention.woken_up → back to running, no assistant turn', async () => {
    const s = setup();
    s.thread.markWaiting();
    s.bus.emit({ type: 'mention.woken_up', mentionId: 'm1', ticketId: 't1', targetAgent: 'builder', occurredAt: new Date() });
    await tick();
    expect(s.thread.status).toBe('running');
    expect(s.turns).toHaveLength(0);
  });

  it('a user comment inside the thread counts an exchange; a main-stream one does not', async () => {
    const s = setup();
    s.bus.emit({ type: 'comment.posted', commentId: 'c-thread', ticketId: 't1', authorType: 'user', authorName: 'o', createdMentions: [], occurredAt: new Date() });
    s.bus.emit({ type: 'comment.posted', commentId: 'c-main', ticketId: 't1', authorType: 'user', authorName: 'o', createdMentions: [], occurredAt: new Date() });
    await tick();
    expect(s.thread.exchanges).toBe(2);
  });

  it('ignores mentions that belong to no thread and terminal threads', async () => {
    const s = setup();
    s.thread.conclude('done');
    s.bus.emit({ type: 'mention.resolved', mentionId: 'm1', ticketId: 't1', targetAgent: 'builder', resolvedBy: 'b', occurredAt: new Date() });
    s.bus.emit({ type: 'mention.resolved', mentionId: 'other', ticketId: 't1', targetAgent: 'x', resolvedBy: 'x', occurredAt: new Date() });
    await tick();
    expect(s.turns).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Vérifier l'échec** → FAIL.

- [ ] **Step 3: Implémenter**

```ts
// packages/server/src/application/assistant-thread-listener.ts
import type { EventBus } from './event-bus.js';
import type { ThreadStorePort } from './ports/thread-store.port.js';
import type { CommentStorePort } from './ports/comment-store.port.js';
import type { LoggerPort } from './ports/logger.port.js';
import type { RunAssistantTurnUseCase } from './use-cases/run-assistant-turn.js';
import type { AnyDomainEvent } from '../domain/events.js';

export interface AssistantThreadListenerDeps {
  eventBus: EventBus;
  threadStore: ThreadStorePort;
  commentStore: CommentStorePort;
  runAssistantTurn: Pick<RunAssistantTurnUseCase, 'execute'>;
  logger: LoggerPort;
}

/**
 * Keeps each assistant thread in step with the mention driving it, and wakes the
 * assistant when its agent has answered. Local bus only: one instance runs a
 * thread, hub-relayed events must not trigger a second assistant.
 */
export class AssistantThreadListener {
  constructor(private readonly deps: AssistantThreadListenerDeps) {}

  register(): void {
    const bus = this.deps.eventBus;
    bus.on('mention.resolved', (e) => this.onMention(e, 'resolved'));
    bus.on('mention.waiting_for_info', (e) => this.onMention(e, 'waiting_for_info'));
    bus.on('mention.execution_failed', (e) => this.onMention(e, 'failed'));
    bus.on('mention.woken_up', (e) => this.onWoken(e));
    bus.on('comment.posted', (e) => this.onComment(e));
  }

  private async onMention(e: AnyDomainEvent, status: 'resolved' | 'waiting_for_info' | 'failed'): Promise<void> {
    if (!('mentionId' in e)) return;
    const thread = await this.deps.threadStore.getByCurrentMentionId(e.mentionId);
    if (!thread || thread.isTerminal) return;
    if (status === 'failed') thread.fail();
    else {
      thread.recordAgentTurn();
      if (status === 'waiting_for_info') thread.markWaiting();
      else thread.markRunning();
    }
    await this.deps.threadStore.save(thread);
    this.deps.eventBus.emit({ type: 'thread.updated', threadId: thread.id, ticketId: thread.ticketId, occurredAt: new Date() });
    await this.deps.runAssistantTurn.execute({ ticketId: thread.ticketId, trigger: { kind: 'thread_reply', threadId: thread.id, mentionStatus: status } });
  }

  private async onWoken(e: AnyDomainEvent): Promise<void> {
    if (!('mentionId' in e)) return;
    const thread = await this.deps.threadStore.getByCurrentMentionId(e.mentionId);
    if (!thread || thread.isTerminal || thread.status !== 'waiting') return;
    thread.markRunning();
    await this.deps.threadStore.save(thread);
    this.deps.eventBus.emit({ type: 'thread.updated', threadId: thread.id, ticketId: thread.ticketId, occurredAt: new Date() });
  }

  private async onComment(e: AnyDomainEvent): Promise<void> {
    if (e.type !== 'comment.posted' || e.authorType !== 'user') return;
    const comment = await this.deps.commentStore.getById(e.commentId);
    if (!comment?.threadId) return;
    const thread = await this.deps.threadStore.getById(comment.threadId);
    if (!thread || thread.isTerminal) return;
    thread.recordUserTurn();
    await this.deps.threadStore.save(thread);
    this.deps.eventBus.emit({ type: 'thread.updated', threadId: thread.id, ticketId: thread.ticketId, occurredAt: new Date() });
  }
}
```

- [ ] **Step 4: Vérifier** → PASS. **Step 5: Commit** `feat(threads): AssistantThreadListener keeps threads in step with mentions`.

### Task 12: Routes, câblage container, WS

**Files:**
- Create: `packages/server/src/infrastructure/http/assistant-threads.routes.ts`
- Modify: `packages/server/src/infrastructure/container.ts` (construction `runAssistantTurn`, listener, exposition `threadStore`, `runAssistantTurn`)
- Modify: `packages/server/src/main.ts` (`await app.register(assistantThreadsRoutes(container));` après `ticketRoutes`)
- Modify: `packages/server/src/infrastructure/ws/unified-ws.ts:262` (`container.runAssistantTurn.onEvent = broadcastAgentEvent;`)
- Test: `packages/server/tests/unit/assistant-threads.routes.test.ts` (Fastify `inject` avec un container minimal)

- [ ] **Step 1: Routes**

```ts
// packages/server/src/infrastructure/http/assistant-threads.routes.ts
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { TicketNotFoundError } from '../../domain/errors.js';

export function assistantThreadsRoutes(container: Pick<Container, 'ticketStore' | 'threadStore' | 'commentStore' | 'mentionStore' | 'postComment' | 'runAssistantTurn' | 'config' | 'eventBus'>) {
  return async function (app: FastifyInstance) {
    // Work composer entry point: the user's comment + one assistant turn.
    app.post<{ Params: { id: string }; Body: { body: string } }>('/api/tickets/:id/assistant/messages', async (request, reply) => {
      const ticket = await container.ticketStore.getTicketById(request.params.id);
      if (!ticket) throw new TicketNotFoundError(request.params.id);
      const assistant = await container.runAssistantTurn.resolveAssistantPersona(ticket);
      if (!assistant) return reply.code(200).send({ comment: null, assistant: null });

      const { humanDisplayName, humanMentionName } = container.config.get();
      const authorName = humanDisplayName || humanMentionName || 'user';
      const { comment, createdMentions } = await container.postComment.execute({
        ticketId: ticket.id, authorType: 'user', authorName, body: request.body.body, visibility: 'public',
        humanMentionNames: humanMentionName ? [humanMentionName] : [], threadId: null, suppressAgentMentions: true,
      });
      const now = new Date();
      container.eventBus.emit({
        type: 'comment.posted', commentId: comment.id, ticketId: ticket.id, authorType: 'user', authorName,
        createdMentions: createdMentions.map((m) => ({ mentionId: m.id, targetAgent: m.targetAgent, targetType: m.targetType })),
        occurredAt: now,
      });
      for (const m of createdMentions) {
        container.eventBus.emit({ type: 'mention.created', mentionId: m.id, ticketId: ticket.id, targetAgent: m.targetAgent, targetType: m.targetType, sourceAgent: m.sourceAgent, occurredAt: now });
      }
      void container.runAssistantTurn.execute({ ticketId: ticket.id, trigger: { kind: 'user_message', commentId: comment.id } });
      return reply.code(201).send({ comment: comment.toDTO(), assistant: { personaId: assistant.id, displayName: assistant.displayName || assistant.name } });
    });

    app.get<{ Params: { id: string } }>('/api/tickets/:id/threads', async (request) =>
      (await container.threadStore.getByTicket(request.params.id)).map((t) => t.toDTO()));

    app.get('/api/threads/open', async () => (await container.threadStore.getOpen()).map((t) => t.toDTO()));

    app.get<{ Params: { id: string } }>('/api/threads/:id', async (request, reply) => {
      const thread = await container.threadStore.getById(request.params.id);
      if (!thread) return reply.code(404).send({ error: 'Thread not found' });
      const turns = (await container.commentStore.getByTicket(thread.ticketId)).filter((c) => c.threadId === thread.id).map((c) => c.toDTO());
      return { thread: thread.toDTO(), turns };
    });

    // "Step into the thread": a user turn. Wakes a waiting agent, or re-mentions it.
    app.post<{ Params: { id: string }; Body: { body: string } }>('/api/threads/:id/messages', async (request, reply) => {
      const thread = await container.threadStore.getById(request.params.id);
      if (!thread) return reply.code(404).send({ error: 'Thread not found' });
      if (thread.isTerminal) return reply.code(409).send({ error: 'Thread is closed' });
      const current = thread.currentMentionId ? await container.mentionStore.getById(thread.currentMentionId) : null;
      const waiting = current?.status === 'waiting_for_info';
      const { humanDisplayName, humanMentionName } = container.config.get();
      const authorName = humanDisplayName || humanMentionName || 'user';
      const body = waiting || request.body.body.includes(`@agent:${thread.personaName}`) ? request.body.body : `@agent:${thread.personaName} ${request.body.body}`;
      const { comment, createdMentions } = await container.postComment.execute({
        ticketId: thread.ticketId, authorType: 'user', authorName, body, visibility: 'public', threadId: thread.id,
        humanMentionNames: humanMentionName ? [humanMentionName] : [],
        suppressMentionForAgents: waiting ? [thread.personaName] : [],
      });
      const now = new Date();
      container.eventBus.emit({
        type: 'comment.posted', commentId: comment.id, ticketId: thread.ticketId, authorType: 'user', authorName,
        createdMentions: createdMentions.map((m) => ({ mentionId: m.id, targetAgent: m.targetAgent, targetType: m.targetType })),
        occurredAt: now,
      });
      for (const m of createdMentions) {
        container.eventBus.emit({ type: 'mention.created', mentionId: m.id, ticketId: thread.ticketId, targetAgent: m.targetAgent, targetType: m.targetType, sourceAgent: m.sourceAgent, occurredAt: now });
        if (m.targetAgent === thread.personaName) { thread.openTurn(m.id); await container.threadStore.save(thread); }
      }
      return reply.code(201).send(comment.toDTO());
    });

    app.post<{ Params: { id: string } }>('/api/threads/:id/conclude', async (request, reply) => {
      const thread = await container.threadStore.getById(request.params.id);
      if (!thread) return reply.code(404).send({ error: 'Thread not found' });
      if (thread.isTerminal) return reply.code(409).send({ error: 'Thread is closed' });
      void container.runAssistantTurn.execute({ ticketId: thread.ticketId, trigger: { kind: 'conclude_request', threadId: thread.id } });
      return reply.code(202).send({ accepted: true });
    });
  };
}
```

Note : dans `POST /api/threads/:id/messages`, quand la mention courante n'est pas en attente et que la persona est re-mentionnée, la mention créée devient la mention courante du thread (`openTurn`) : le listener suivra ensuite la réponse de l'agent. Le `comment.posted` d'un utilisateur dans le thread est aussi compté par le listener (`recordUserTurn`) ; `openTurn` compte déjà un tour : pour éviter le double compte, la route n'appelle `openTurn` que si une mention a été créée et le listener ignore les commentaires utilisateur dont `createdMentions` contient la persona du thread (ajouter cette condition dans `onComment` : `if (e.createdMentions.some((m) => m.targetAgent === thread.personaName)) return;`).

- [ ] **Step 2: Test de routes (inject)**

```ts
// packages/server/tests/unit/assistant-threads.routes.test.ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { assistantThreadsRoutes } from '../../src/infrastructure/http/assistant-threads.routes.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';
import { EventBus } from '../../src/application/event-bus.js';

describe('assistant threads routes', () => {
  it('POST assistant/messages answers { assistant: null } and posts nothing when no assistant is configured', async () => {
    const app = Fastify();
    const posted: unknown[] = [];
    await app.register(assistantThreadsRoutes({
      ticketStore: { getTicketById: async () => ({ id: 't1', assistantPersonaId: null }) },
      runAssistantTurn: { resolveAssistantPersona: async () => null, execute: async () => {} },
      postComment: { execute: async (p: unknown) => { posted.push(p); return { comment: { id: 'c', toDTO: () => ({}) }, createdMentions: [] }; } },
      config: { get: () => ({}) }, eventBus: new EventBus(), threadStore: {}, commentStore: {}, mentionStore: {},
    } as never));
    const res = await app.inject({ method: 'POST', url: '/api/tickets/t1/assistant/messages', payload: { body: 'hello' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ comment: null, assistant: null });
    expect(posted).toHaveLength(0);
  });

  it('GET /api/threads/open lists open threads', async () => {
    const app = Fastify();
    const t = AgentThreadEntity.create({ id: 'th', ticketId: 't1', personaId: 'p', personaName: 'b', assistantPersonaId: 'a', brief: 'x', forwardedContext: [] });
    await app.register(assistantThreadsRoutes({ threadStore: { getOpen: async () => [t] } } as never));
    const res = await app.inject({ method: 'GET', url: '/api/threads/open' });
    expect(res.json()).toHaveLength(1);
  });

  it('POST /api/threads/:id/conclude refuses a closed thread', async () => {
    const app = Fastify();
    const t = AgentThreadEntity.create({ id: 'th', ticketId: 't1', personaId: 'p', personaName: 'b', assistantPersonaId: 'a', brief: 'x', forwardedContext: [] });
    t.conclude('done');
    await app.register(assistantThreadsRoutes({ threadStore: { getById: async () => t } } as never));
    const res = await app.inject({ method: 'POST', url: '/api/threads/th/conclude' });
    expect(res.statusCode).toBe(409);
  });
});
```

- [ ] **Step 3: Container et WS**

Dans `container.ts`, après `wakeWaitingAgents` (ligne ~394) :

```ts
  const runAssistantTurn = new RunAssistantTurnUseCase({
    threadStore, commentStore, mentionStore, ticketStore: ticketStore_, personaStore: personaStore_, postComment,
    getTicketContext, agentEventStore: agentEventStore_, executeAgent, config, eventBus, logger,
  });
```

après `domainEventListener.register();` :

```ts
  new AssistantThreadListener({ eventBus, threadStore, commentStore, runAssistantTurn, logger }).register();
```

et `runAssistantTurn,` + `threadStore,` dans le `return`. `unified-ws.ts` : `container.runAssistantTurn.onEvent = broadcastAgentEvent;` après la ligne 262. `main.ts` : import + `await app.register(assistantThreadsRoutes(container));` après `ticketRoutes`.

- [ ] **Step 4: Vérifier** — `vitest run` serveur → PASS ; `tsc` serveur → PASS ; `bun run test:bun` → PASS. Démarrer l'instance QA sqlite et vérifier à la main : `curl -X POST localhost:<port>/api/tickets/<id>/assistant/messages -d '{"body":"bonjour"}' -H 'content-type: application/json'` répond `assistant: null` tant qu'aucune persona assistant n'est configurée ; après `PUT /api/config {"defaultAssistantPersonaId":"<persona id>"}`, la réponse est `201` et un commentaire assistant apparaît dans `GET /api/tickets/<id>/comments`.

- [ ] **Step 5: Commit** `feat(threads): assistant/thread routes, container wiring, live agent events`.
---

## Série 2 — Web

Les tâches web sont exécutées par l'auteur du plan lui-même ; elles sont décrites au niveau « fichier + comportement + test », le code est écrit en suivant les composants voisins cités (mêmes classes Tailwind `--theme-*`, mêmes hooks).

### Task 13: API client et `threadStore`

**Files:**
- Modify: `packages/web/src/services/api.ts` — ajouter :
  - `postAssistantMessage(ticketId, body): Promise<{ comment: TicketComment | null; assistant: { personaId: string; displayName: string } | null }>` → `POST /tickets/:id/assistant/messages`
  - `fetchTicketThreads(ticketId): Promise<AgentThread[]>`, `fetchOpenThreads(): Promise<AgentThread[]>`, `fetchThread(threadId): Promise<{ thread: AgentThread; turns: TicketComment[] }>`, `postThreadMessage(threadId, body): Promise<TicketComment>`, `concludeThread(threadId): Promise<void>`.
- Create: `packages/web/src/stores/threadStore.ts` — zustand, non persisté :
  - state `threadsByTicket: Record<string, AgentThread[]>` (plus récents d'abord), `loadedTickets: Set<string>`
  - `loadForTicket(ticketId)`, `loadOpen()` (fusionne dans `threadsByTicket` sans écraser les threads terminaux déjà chargés), `upsert(thread)` (WS), `selectOpenByTicket(ticketId)`.
  - `applyWsMessage(msg: TicketWsMessage)` : `thread:created|updated|concluded` → `upsert(msg.data as AgentThread)`.
- Create: `packages/web/src/components/work/panel/useTicketThreads.ts` — `useTicketThreads(ticketId | null): AgentThread[]` : `loadForTicket` à la sélection + abonnement `appWs.onChannel('tickets', …)` → `applyWsMessage` (même pattern que `useTicketDeliverables.ts`). Un second hook `useOpenThreads()` appelé une fois dans `WorkView` : `loadOpen()` au montage + même abonnement WS.
- Test: `packages/web/src/stores/threadStore.test.ts` — `upsert` remplace par id et garde l'ordre par `createdAt` décroissant ; `applyWsMessage` ignore les autres types ; `selectOpenByTicket` exclut `concluded`/`failed`.

Commit `feat(work): thread API client and live threadStore`.

### Task 14: Sélecteurs du flux et rendu assistant

**Files:**
- Modify: `packages/web/src/components/work/selectors.ts` :
  - `StreamEntry` gagne `{ kind: 'delegation'; at: number; thread: AgentThread }` ; `STREAM_RANK.delegation = 1` (ex æquo avec `comment`, l'insertion garde l'annonce avant la carte car l'annonce est postée avant la création du thread).
  - `buildStream(comments, activity, executions, deliverables, threads = [])` : ignore `c.threadId !== null`, ignore `e.mentionId.startsWith('assistant:')`, ajoute une entrée `delegation` par thread à `Date.parse(thread.createdAt)`.
  - `export function threadTurns(comments, threadId)` → commentaires du thread, ordre chronologique.
  - `export function lastAgentQuestion(turns)` → dernier tour `authorType==='agent'` dont `parseInlineOptions(body).length >= 2`, ou null.
  - `export function threadActivityDetail(threads, personaDisplayName)` → `'<persona> · in thread with assistant'` s'il existe un thread `running`, sinon null.
  - `suggestionsFor` : les deux chips `⇄` seedent `Vois ça avec @agent:builder : ` / `Vois ça avec @agent:pm : ` (texte envoyé à l'assistant, plus une simple mention).
- Modify: `StreamItem.tsx` : `authorType === 'assistant'` → avatar `◆` sur `bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]`, sinon comportement actuel.
- Modify: `TaskStream.tsx` : la question inline se déclenche pour `authorType` `agent` **ou** `assistant` (l'assistant relaie des questions avec options) ; `buildStream(..., threads)` ; nouvelle prop `threads: AgentThread[]`, `assistantThinking: { name: string } | null` (ligne « ◆ <name> is thinking… » en fin de flux), `onOpenThread(threadId)`, `onAnswerThread(threadId, text)`.
- Test: `packages/web/src/components/work/selectors.test.ts` (fichier existant ou nouveau) — `buildStream` exclut les tours et les exécutions `assistant:`, place la carte à `createdAt` ; `threadTurns`, `lastAgentQuestion`, `threadActivityDetail`.

Commit `feat(work): stream selectors know threads and assistant turns`.

### Task 15: `DelegationCard` (design A)

**Files:**
- Create: `packages/web/src/components/work/task/DelegationCard.tsx` — props `{ thread: AgentThread; turns: TicketComment[]; personaDisplayName: string; onOpen: (threadId) => void; onAnswer: (threadId, text) => void | Promise<void> }`.
  - En-tête : `◆ Assistant` · `⇄` · `⌬ <personaDisplayName>` · pill d'état à droite : `running` → « in progress » avec point accent pulsant (`animate-pulse`) sur fond `tint('yellow')` ; `waiting` → « waiting for you » `tint('yellow')` bordure ; `concluded` → « concluded » `tint('green')` ; `failed` → « failed » `tint('red')` (helpers `tint()` de `lib/tints`).
  - Corps : `brief` ; chips `FORWARDED` (`ticket` → `#<displayId>` non disponible ici : afficher les clés en mono, `ticket`, `worktrees`, `pr`, `deliverables`) ; en `waiting` : texte de la dernière question agent (`lastAgentQuestion`) + boutons options (clic → `onAnswer(thread.id, option)`) + bouton « Reply… » qui ouvre le thread.
  - Pied : `N exchanges · « dernière ligne du dernier tour agent tronquée à 80 car. » · Open thread ›` (bouton → `onOpen`).
  - Bouton racine accessible : `<button type="button">` pour « Open thread », options en `<button>`.
- Modify: `TaskStream.tsx` : `case 'delegation'` → `<DelegationCard … />` ; `personaDisplayName` via `useAgentPersonaStore` (`personas.find(p => p.id === thread.personaId)?.displayName ?? thread.personaName`).
- Test: `packages/web/src/components/work/task/DelegationCard.test.tsx` — rend les quatre états (texte de la pill), affiche les options en `waiting` et appelle `onAnswer` au clic, `onOpen` sur « Open thread ».

Commit `feat(work): delegation card in the task stream`.

### Task 16: Composer → assistant, flag, picker, indicateur

**Files:**
- Modify: `packages/web/src/stores/settingsStore.ts` — `workThreadsEnabled?: boolean` (absent = `true`), `defaultAssistantPersonaId?: string` dans `AppSettings`.
- Modify: `useTaskConversation.ts` — `post(body)` : si `workThreadsEnabled !== false` → `api.postAssistantMessage` ; si la réponse a `assistant === null` → repli `api.postTicketComment(ticketId, body)` et `assistantMissing = true` (état exposé, remis à `false` quand un assistant répond). Sinon comportement actuel. `postToThread(threadId, body)` → `api.postThreadMessage`.
- Modify: `hooks/useExecConfig.ts` — expose `assistantPersonaId: string | null` (depuis le ticket) ; `patchExecConfig({ assistantPersonaId })` fonctionne déjà via `UpdateTicketExecutionConfigRequest`.
- Modify: `components/markdown/ComposerExecBar.tsx` — prop optionnelle `assistantPicker?: boolean` ; quand `true`, un `<select>` « ◆ Assistant : » avant le Mode : option `Default (<displayName du défaut> | none)` valeur `''`, puis chaque persona de `useAgentPersonaStore` ; `onChange` → `patchExecConfig({ assistantPersonaId: v || null })`.
- Modify: `Composer.tsx` — `<ComposerExecBar exec={exec} assistantPicker />` ; sous l'éditeur, si `assistantMissing` : hint « No assistant configured — pick one above or in Settings ». Prop `assistantMissing?: boolean`.
- Modify: `TaskPane.tsx` — `threads = useTicketThreads(task.id)` ; `assistantThinking` = `executions.some(e => e.status === 'running' && e.mentionId.startsWith('assistant:'))` → `{ name }` (displayName de la persona assistant de l'exécution) ; passe `threads`, `assistantThinking`, `onOpenThread` (`setRightPanel('thread')` + `setSelectedThreadId`), `onAnswerThread` (`convo.postToThread`) à `TaskStream`, `assistantMissing` au `Composer`.
- Modify: `Suggestions.tsx` — inchangé (les chips seedent le composer ; le texte seedé change en Task 14).
- Modify: `workStore.ts` — vérifier l'existence de `setSelectedThreadId` / `setThreadTab` ; les ajouter s'ils manquent (`commit({ selectedThreadId })`, `commit({ threadTab })`).
- Test: `useTaskConversation.test.ts` (mock `api`) — avec flag on : appelle `postAssistantMessage` ; réponse `assistant: null` → repli `postTicketComment` + `assistantMissing`.

Commit `feat(work): composer talks to the assistant; per-ticket assistant picker`.

### Task 17: Panneau Threads, tool strip, sélection

**Files:**
- Create: `packages/web/src/components/work/panel/threadSelection.ts` — `resolveSelectedThread(threads, selectedId)` : le thread persisté s'il existe, sinon le plus récent non terminal, sinon le plus récent, sinon null. Test `threadSelection.test.ts` (4 cas).
- Create: `packages/web/src/components/work/panel/useThreadTurns.ts` — `useThreadTurns(threadId | null): TicketComment[]` : `api.fetchThread` puis WS `comment:created|updated|deleted` filtrés sur `threadId` (pattern `useTaskConversation`).
- Create: `packages/web/src/components/work/panel/ThreadsPanel.tsx` — props `{ task: WorkTask }` :
  - haut : liste `useTicketThreads(task.id)` (point d'état coloré, `personaDisplayName`, brief tronqué, âge relatif) ; clic → `setSelectedThreadId`.
  - bas : thread résolu (`resolveSelectedThread`) ; en-tête `◆ ⇄ ⌬ <persona>` + pill (réutiliser un petit composant `ThreadStatusPill` exporté depuis `DelegationCard.tsx`) + coût mono à droite = somme des `costUsd` des exécutions du ticket dont `mentionId ∈ mentions du thread` (mentions via `api.fetchTicketMentions(task.id)` filtrées par `commentId ∈ turns`) ; onglets `Conversation` | `Agent SDK stream` (`workStore.threadTab`).
  - Conversation : chips `CONTEXT FORWARDED`, tours (◆ assistant / ⌬ agent / bulle You), « <persona> is working… » si `status === 'running'`, « Concluded · summary posted back to the main thread » si terminal.
  - Agent SDK stream : `executionId` = exécution du ticket (`useAgentEventStore.executionsByTicket`) dont `mentionId === thread.currentMentionId` ; `<AgentEventStream executionId />` ; footer `exec <id court>` · bouton « Terminate » (`api.cancelExecution`) si `running` ; message « No execution yet » sinon.
  - Footer (non terminal) : `<input>` « Step into the thread… » (Enter → `api.postThreadMessage`) + bouton « Conclude now ↩ » (`api.concludeThread`).
- Modify: `RightPanel.tsx` — `{rightPanel === 'thread' && <ThreadsPanel task={task} />}`.
- Modify: `ToolStrip.tsx` — outil `{ key: 'thread', label: 'Threads', icon: <svg …deux flèches ⇄… /> }` après `context` ; point ambre si `openThreads.some(t => t.ticketId === task.id)` (lecture `useThreadStore`). Masqué si `workThreadsEnabled === false`.
- Test: `threadSelection.test.ts`.

Commit `feat(work): Threads panel with conversation and SDK stream tabs`.

### Task 18: Queue, réglage global, libellés Kanban/mobile

**Files:**
- Modify: `useWorkQueue.ts` — `threadsByTicket = useThreadStore(s => s.threadsByTicket)` ; `activityDetail: threadActivityDetail(threadsByTicket[t.id] ?? [], displayName) ?? detailByTicket[t.id] ?? null` (displayName via `useAgentPersonaStore`).
- Modify: `WorkView.tsx` — appelle `useOpenThreads()` une fois.
- Modify: `SettingsPanel.tsx` — état `defaultAssistantPersonaId` (init depuis `settings`), `<select>` « Default assistant » dans `GeneralTab` (options = personas de `useAgentPersonaStore`, `''` = none), inclus dans `handleSave` (`defaultAssistantPersonaId: v || undefined`).
- Modify: `TicketComments.tsx:1111,1117` et `MobileConversation.tsx:515` — `c.authorType !== 'user'` pour le style, libellé `c.authorType` (`'agent' | 'assistant' | 'you'`).
- Test: `useWorkQueue` a-t-il un test ? Si oui, un cas « thread running → detail in thread with assistant » ; sinon couvert par `threadActivityDetail` (Task 14).

Commit `feat(work): thread-aware queue label, default assistant setting, author labels`.

### Task 19: Documentation et vérification finale

- Modify: `docs/work-view-status.md` — section « Phase 3 » : ce qui est livré (résumé par surface), le flag, la stratégie de recette (QA sqlite, `pg_dump`, unique passage prod), les limitations assumées (Kanban affiche les tours ; contexte des agents non cloisonné), et les items reportés.
- Vérifier : `(cd packages/shared && ../../node_modules/.bin/tsc)` ; serveur `tsc` + `vitest run` ; `bun run test:bun` ; web `tsc` + `vitest run` + `node ../../scripts/check-raw-palette.mjs`.
- Recette manuelle sur l'instance QA sqlite (`FLEEX_STORAGE_DRIVER=sqlite`) : 1) configurer un assistant par défaut dans Settings ; 2) dans Work, envoyer « bonjour » → réponse assistant `◆` ; 3) envoyer « Vois ça avec @agent:builder : liste les fichiers du repo » → annonce + carte `in progress` + agent qui tourne + carte `concluded` + « Retour de … » ; 4) ouvrir le panneau Threads, onglet SDK stream ; 5) « Conclude now » sur un thread en cours ; 6) désactiver `workThreadsEnabled` → le composer redevient un commentaire ordinaire.
- Commit `docs(work): Phase 3 status and QA notes`, puis `git push -u origin ticket/534e5b-vue-tasks-phase-3-threads-assistant-agen` et PR vers `main` (titre `feat(work): Phase 3 — assistant ⇄ agent threads`).

## Self-review (fait à l'écriture)

- **Couverture spec** : entité/tours/types (T1, T3, T5), migration (T2), stores (T4), override persona + config (T6, T16, T18), événements + WS (T7), use case + protocole + lane + plafond + conclude forcé + sortie invalide (T9, T10), listener (T11), routes dont `assistant/messages`, `threads`, `messages`, `conclude` (T12), flag + composer + picker + indicateur (T16), flux + carte + états (T14, T15), panneau Threads + tool strip + sélection (T17), queue + settings (T18), recette et doc (T19). Écarts listés en tête de plan.
- **Cohérence des noms** : `ThreadStorePort.getByCurrentMentionId/getOpen`, `AgentThreadEntity.openTurn/recordAgentTurn/recordUserTurn/markWaiting/markRunning/conclude/fail/isTerminal`, `RunAssistantTurnUseCase.execute({ ticketId, trigger })/resolveAssistantPersona`, `AssistantTrigger`, `postAssistantMessage`, `threadStore.threadsByTicket`, `resolveSelectedThread`, `threadActivityDetail` — utilisés à l'identique d'une tâche à l'autre.

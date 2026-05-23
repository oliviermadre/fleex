# Ticket Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th agentic resource to Fleex — workflows — as a DAG of typed steps (agent, skill, panel, human_gate) connected by conditional edges, with a visual editor (React Flow), a runtime orchestrator, and a per-ticket runtime view.

**Architecture:** Approach C from the spec — new `RunWorkflowStepUseCase` delegates to per-type step executor adapters that wrap existing `ExecuteAgentUseCase` / `RunPanelUseCase` (via a small refactor extracting `outputFormat`). Template + run + step_run persisted in 3 new tables. Mention `@workflow:slug` and `SmartSessionButton` start runs. Frontend reuses `@xyflow/react` (React Flow) for editor and runtime DAG view.

**Tech Stack:** TypeScript (server + web), Vitest, SQLite + Supabase adapters, React + Zustand, `@xyflow/react`, Zod validation.

**Spec:** `docs/superpowers/specs/2026-05-23-ticket-workflows-design.md`

**Phase dependencies:**
```
Phase A (Domain) ──┬─→ Phase B (Orchestrator) ──→ Phase C (Trigger)
                   ├─→ Phase D (UI runtime)
                   └─→ Phase E (UI editor)
```
D and E can run in parallel once A is merged. C requires both A and B.

---

## Phase A — Domain & Persistance

Foundation: shared types, migration, entities, store ports + 2 adapters per port (SQLite + Supabase). Tests for entities only — repos are integration-tested via the existing migration tests.

### Task A.1: Shared types in `@fleex/shared`

**Files:**
- Create: `packages/shared/src/types/workflow.ts`
- Modify: `packages/shared/src/types/index.ts` (add re-export)
- Modify: `packages/shared/src/types/ticket.ts` (extend `MentionTargetType`)

- [ ] **Step 1: Create the workflow types module**

Write `packages/shared/src/types/workflow.ts`:

```ts
export type WorkflowExecutorType = 'agent' | 'skill' | 'panel' | 'human_gate';

export type EdgeOperator = 'eq' | 'neq' | 'in' | 'gt' | 'lt' | 'contains';

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  enum?: string[];
  description?: string;
  items?: JsonSchemaProperty;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface WorkflowStep {
  id: string;
  name: string;
  executorType: WorkflowExecutorType;
  executorRef: string;
  mode?: 'talk' | 'plan' | 'edit';
  outputSchema?: JsonSchema;
  humanGateOutcomes?: string[];
  position: { x: number; y: number };
}

export interface WorkflowEdgeCondition {
  field: string;
  operator: EdgeOperator;
  value: string | string[];
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  isDefault: boolean;
  condition?: WorkflowEdgeCondition;
  label?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  slug: string;
  emoji: string;
  description: string;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  entryStepId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowRunStatus =
  | 'running' | 'blocked' | 'needs_review'
  | 'completed' | 'failed' | 'cancelled';

export interface WorkflowTemplateSnapshot {
  name: string;
  emoji: string;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  entryStepId: string;
}

export interface WorkflowRun {
  id: string;
  ticketId: string;
  templateId: string;
  templateSnapshot: WorkflowTemplateSnapshot;
  status: WorkflowRunStatus;
  currentStepId: string | null;
  triggeredBy: string;
  triggeredFrom: string;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StepRunStatus =
  | 'queued' | 'running' | 'completed'
  | 'failed' | 'needs_review' | 'cancelled' | 'skipped';

export type StepRunResult = 'ok' | 'needs_review' | 'ko';

export interface StepOutput {
  deliverable?: {
    title: string;
    markdown: string;
    type: string;
    status: 'draft' | 'final';
  } | null;
  comment?: string | null;
  mentionStatus?: 'resolved' | 'waiting_for_info';
  schemaFields: Record<string, unknown>;
  outcome?: string;
  result: StepRunResult;
}

export interface StepRun {
  id: string;
  workflowRunId: string;
  stepId: string;
  attempt: number;
  status: StepRunStatus;
  result: StepRunResult | null;
  output: StepOutput | null;
  nextEdgeId: string | null;
  executionId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CreateWorkflowRunInput {
  ticketId: string;
  templateId: string;
  triggeredBy: string;
  triggeredFrom: string;
}

export interface ResolveHumanGateInput {
  outcome: string;
  notes?: string;
}
```

- [ ] **Step 2: Re-export from index**

Modify `packages/shared/src/types/index.ts` — add at the bottom:

```ts
export * from './workflow.js';
```

- [ ] **Step 3: Extend `MentionTargetType` with `'workflow'`**

In `packages/shared/src/types/ticket.ts`, find `MentionTargetType` (around line 156) and add `'workflow'`:

```ts
export type MentionTargetType = 'agent' | 'human' | 'panel' | 'skill' | 'workflow';
```

- [ ] **Step 4: Build the shared package**

Run: `bun run --cwd packages/shared build` (or equivalent — check `packages/shared/package.json` `scripts.build`)
Expected: build succeeds, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/workflow.ts packages/shared/src/types/index.ts packages/shared/src/types/ticket.ts
git commit -m "feat(shared): add workflow domain types"
```

---

### Task A.2: Migration `017_add_workflows.ts`

**Files:**
- Create: `packages/server/src/infrastructure/migrations/migrations/017_add_workflows.ts`
- Modify: `packages/server/src/infrastructure/migrations/migrations/index.ts` (register migration)

- [ ] **Step 1: Read the existing migration pattern to confirm types**

Run: `head -30 packages/server/src/infrastructure/migrations/migrations/016_global_display_id.ts`
Expected: see `import type { Migration } from '../types.js';` and `const migration: Migration = { name: '...', async up(ctx) {...}, async down(ctx) {...} }`

- [ ] **Step 2: Create the migration file**

Write `packages/server/src/infrastructure/migrations/migrations/017_add_workflows.ts`:

```ts
import type { Migration } from '../types.js';

/**
 * Add workflow tables: workflow_templates, workflow_runs, step_runs.
 * Supports SQLite (json adapter computes nothing) + PostgreSQL + Supabase (with RLS).
 */
const migration: Migration = {
  name: '017_add_workflows',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    const jsonType = ctx.dialect({ sqlite: 'TEXT', pgsql: 'JSONB', supabase: 'JSONB' });
    const tsType = ctx.dialect({ sqlite: 'TEXT', pgsql: 'TIMESTAMPTZ', supabase: 'TIMESTAMPTZ' });
    const tsDefault = ctx.dialect({
      sqlite: "DEFAULT (datetime('now'))",
      pgsql: 'DEFAULT NOW()',
      supabase: 'DEFAULT NOW()',
    });

    // workflow_templates
    await ctx.exec(`
      CREATE TABLE workflow_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        emoji TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        steps ${jsonType} NOT NULL,
        edges ${jsonType} NOT NULL,
        entry_step_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at ${tsType} NOT NULL ${tsDefault},
        updated_at ${tsType} NOT NULL ${tsDefault}
      )
    `);

    // workflow_runs
    await ctx.exec(`
      CREATE TABLE workflow_runs (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        template_id TEXT NOT NULL REFERENCES workflow_templates(id),
        template_snapshot ${jsonType} NOT NULL,
        status TEXT NOT NULL,
        current_step_id TEXT,
        triggered_by TEXT NOT NULL,
        triggered_from TEXT NOT NULL,
        started_at ${tsType} NOT NULL ${tsDefault},
        completed_at ${tsType},
        created_at ${tsType} NOT NULL ${tsDefault},
        updated_at ${tsType} NOT NULL ${tsDefault}
      )
    `);
    await ctx.exec('CREATE INDEX idx_workflow_runs_ticket_status ON workflow_runs(ticket_id, status)');

    // step_runs
    await ctx.exec(`
      CREATE TABLE step_runs (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        result TEXT,
        output ${jsonType},
        next_edge_id TEXT,
        execution_id TEXT,
        started_at ${tsType},
        completed_at ${tsType},
        created_at ${tsType} NOT NULL ${tsDefault}
      )
    `);
    await ctx.exec('CREATE INDEX idx_step_runs_run_step ON step_runs(workflow_run_id, step_id)');

    // Supabase RLS (cf. CLAUDE.md)
    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_workflow_templates" ON workflow_templates FOR ALL USING (true) WITH CHECK (true)`);
      await ctx.exec('ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_workflow_runs" ON workflow_runs FOR ALL USING (true) WITH CHECK (true)`);
      await ctx.exec('ALTER TABLE step_runs ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_step_runs" ON step_runs FOR ALL USING (true) WITH CHECK (true)`);
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    await ctx.exec('DROP TABLE IF EXISTS step_runs');
    await ctx.exec('DROP TABLE IF EXISTS workflow_runs');
    await ctx.exec('DROP TABLE IF EXISTS workflow_templates');
  },
};

export default migration;
```

- [ ] **Step 3: Register the migration in the index**

Find `packages/server/src/infrastructure/migrations/migrations/index.ts` and add the import + entry, following the order of existing entries (016 → 017).

- [ ] **Step 4: Run migration tests**

Run: `bun run --cwd packages/server test -- --run migrations`
Expected: PASS — new tables created on SQLite test fixture.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/infrastructure/migrations/migrations/017_add_workflows.ts packages/server/src/infrastructure/migrations/migrations/index.ts
git commit -m "feat(server): migration 017 — workflow_templates, workflow_runs, step_runs"
```

---

### Task A.3: `WorkflowTemplateEntity`

**Files:**
- Create: `packages/server/src/domain/entities/workflow-template.entity.ts`
- Create: `packages/server/tests/unit/workflow-template.entity.test.ts`

- [ ] **Step 1: Write the failing test**

Write `packages/server/tests/unit/workflow-template.entity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';

describe('WorkflowTemplateEntity', () => {
  const validStep = {
    id: 'triage',
    name: 'Triage',
    executorType: 'agent' as const,
    executorRef: 'the-sentinel',
    position: { x: 0, y: 0 },
  };

  it('creates with required fields', () => {
    const t = WorkflowTemplateEntity.create({
      id: 'wf-1', name: 'Feature Delivery', slug: 'feature-delivery',
      steps: [validStep], edges: [], entryStepId: 'triage',
    });
    expect(t.name).toBe('Feature Delivery');
    expect(t.slug).toBe('feature-delivery');
    expect(t.enabled).toBe(true);
    expect(t.emoji).toBe('');
    expect(t.description).toBe('');
  });

  it('rejects when entryStepId is not in steps[]', () => {
    expect(() => WorkflowTemplateEntity.create({
      id: 'wf-1', name: 'X', slug: 'x',
      steps: [validStep], edges: [], entryStepId: 'nonexistent',
    })).toThrow(/entryStepId/);
  });

  it('rejects empty steps[]', () => {
    expect(() => WorkflowTemplateEntity.create({
      id: 'wf-1', name: 'X', slug: 'x',
      steps: [], edges: [], entryStepId: '',
    })).toThrow(/at least one step/);
  });

  it('rejects invalid slug', () => {
    expect(() => WorkflowTemplateEntity.create({
      id: 'wf-1', name: 'X', slug: 'INVALID Slug!',
      steps: [validStep], edges: [], entryStepId: 'triage',
    })).toThrow(/slug/);
  });

  it('rejects edges referencing nonexistent steps', () => {
    expect(() => WorkflowTemplateEntity.create({
      id: 'wf-1', name: 'X', slug: 'x',
      steps: [validStep], entryStepId: 'triage',
      edges: [{ id: 'e1', source: 'triage', target: 'missing', isDefault: true }],
    })).toThrow(/edge .* target/);
  });

  it('toDTO returns serializable shape', () => {
    const t = WorkflowTemplateEntity.create({
      id: 'wf-1', name: 'X', slug: 'x',
      steps: [validStep], edges: [], entryStepId: 'triage',
    });
    const dto = t.toDTO();
    expect(dto.id).toBe('wf-1');
    expect(typeof dto.createdAt).toBe('string');
  });

  it('update mutates and bumps updatedAt', async () => {
    const t = WorkflowTemplateEntity.create({
      id: 'wf-1', name: 'X', slug: 'x',
      steps: [validStep], edges: [], entryStepId: 'triage',
    });
    const before = t.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    t.update({ name: 'Y' });
    expect(t.name).toBe('Y');
    expect(t.updatedAt.getTime()).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/server test -- --run workflow-template.entity`
Expected: FAIL — `Cannot find module '../../src/domain/entities/workflow-template.entity.js'`

- [ ] **Step 3: Write the entity**

Write `packages/server/src/domain/entities/workflow-template.entity.ts`:

```ts
import type {
  WorkflowTemplate, WorkflowStep, WorkflowEdge,
} from '@fleex/shared';

const SLUG_PATTERN = /^[a-z0-9_-]+$/;

export class WorkflowTemplateEntity {
  constructor(
    public readonly id: string,
    public name: string,
    public slug: string,
    public emoji: string,
    public description: string,
    public steps: WorkflowStep[],
    public edges: WorkflowEdge[],
    public entryStepId: string,
    public enabled: boolean,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    id: string;
    name: string;
    slug: string;
    emoji?: string;
    description?: string;
    steps: WorkflowStep[];
    edges: WorkflowEdge[];
    entryStepId: string;
    enabled?: boolean;
  }): WorkflowTemplateEntity {
    WorkflowTemplateEntity.validate({
      slug: params.slug, steps: params.steps, edges: params.edges, entryStepId: params.entryStepId,
    });
    const now = new Date();
    return new WorkflowTemplateEntity(
      params.id,
      params.name,
      params.slug,
      params.emoji ?? '',
      params.description ?? '',
      params.steps,
      params.edges,
      params.entryStepId,
      params.enabled ?? true,
      now,
      now,
    );
  }

  static validate(input: {
    slug: string; steps: WorkflowStep[]; edges: WorkflowEdge[]; entryStepId: string;
  }): void {
    if (!SLUG_PATTERN.test(input.slug)) {
      throw new Error(`Invalid slug: must match ${SLUG_PATTERN}`);
    }
    if (input.steps.length === 0) {
      throw new Error('Workflow must have at least one step');
    }
    const stepIds = new Set(input.steps.map((s) => s.id));
    if (!stepIds.has(input.entryStepId)) {
      throw new Error(`entryStepId "${input.entryStepId}" not found in steps[]`);
    }
    for (const edge of input.edges) {
      if (!stepIds.has(edge.source)) {
        throw new Error(`edge ${edge.id} source "${edge.source}" not found in steps[]`);
      }
      if (!stepIds.has(edge.target)) {
        throw new Error(`edge ${edge.id} target "${edge.target}" not found in steps[]`);
      }
    }
    for (const step of input.steps) {
      if (step.executorType === 'human_gate') {
        if (!step.humanGateOutcomes || step.humanGateOutcomes.length === 0) {
          throw new Error(`step ${step.id}: human_gate must have at least one outcome`);
        }
      }
    }
  }

  update(changes: {
    name?: string;
    slug?: string;
    emoji?: string;
    description?: string;
    steps?: WorkflowStep[];
    edges?: WorkflowEdge[];
    entryStepId?: string;
    enabled?: boolean;
  }): void {
    const next = {
      slug: changes.slug ?? this.slug,
      steps: changes.steps ?? this.steps,
      edges: changes.edges ?? this.edges,
      entryStepId: changes.entryStepId ?? this.entryStepId,
    };
    WorkflowTemplateEntity.validate(next);
    if (changes.name !== undefined) this.name = changes.name;
    if (changes.slug !== undefined) this.slug = changes.slug;
    if (changes.emoji !== undefined) this.emoji = changes.emoji;
    if (changes.description !== undefined) this.description = changes.description;
    if (changes.steps !== undefined) this.steps = changes.steps;
    if (changes.edges !== undefined) this.edges = changes.edges;
    if (changes.entryStepId !== undefined) this.entryStepId = changes.entryStepId;
    if (changes.enabled !== undefined) this.enabled = changes.enabled;
    this.updatedAt = new Date();
  }

  toDTO(): WorkflowTemplate {
    return {
      id: this.id,
      name: this.name,
      slug: this.slug,
      emoji: this.emoji,
      description: this.description,
      steps: this.steps,
      edges: this.edges,
      entryStepId: this.entryStepId,
      enabled: this.enabled,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/server test -- --run workflow-template.entity`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domain/entities/workflow-template.entity.ts packages/server/tests/unit/workflow-template.entity.test.ts
git commit -m "feat(server): WorkflowTemplateEntity with validation"
```

---

### Task A.4: `WorkflowRunEntity`

**Files:**
- Create: `packages/server/src/domain/entities/workflow-run.entity.ts`
- Create: `packages/server/tests/unit/workflow-run.entity.test.ts`

- [ ] **Step 1: Write the failing test**

Write `packages/server/tests/unit/workflow-run.entity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';

describe('WorkflowRunEntity', () => {
  const snapshot = {
    name: 'Feature Delivery',
    emoji: '🏭',
    steps: [
      { id: 'triage', name: 'Triage', executorType: 'agent' as const, executorRef: 'the-sentinel', position: { x: 0, y: 0 } },
      { id: 'dev', name: 'Dev', executorType: 'agent' as const, executorRef: 'jeff', position: { x: 200, y: 0 } },
    ],
    edges: [{ id: 'e1', source: 'triage', target: 'dev', isDefault: true }],
    entryStepId: 'triage',
  };

  it('creates with status=running and currentStepId=entryStepId', () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', templateId: 'wf-1',
      templateSnapshot: snapshot, triggeredBy: '@john', triggeredFrom: 'comment:c-1',
    });
    expect(run.status).toBe('running');
    expect(run.currentStepId).toBe('triage');
    expect(run.completedAt).toBeNull();
  });

  it('advanceTo updates currentStepId and bumps updatedAt', async () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', templateId: 'wf-1',
      templateSnapshot: snapshot, triggeredBy: '@john', triggeredFrom: 'comment:c-1',
    });
    const before = run.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    run.advanceTo('dev');
    expect(run.currentStepId).toBe('dev');
    expect(run.status).toBe('running');
    expect(run.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it('block sets status=needs_review without clearing currentStepId', () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', templateId: 'wf-1',
      templateSnapshot: snapshot, triggeredBy: '@john', triggeredFrom: 'comment:c-1',
    });
    run.block();
    expect(run.status).toBe('needs_review');
    expect(run.currentStepId).toBe('triage');
  });

  it('complete sets status=completed, currentStepId=null, completedAt', () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', templateId: 'wf-1',
      templateSnapshot: snapshot, triggeredBy: '@john', triggeredFrom: 'comment:c-1',
    });
    run.complete();
    expect(run.status).toBe('completed');
    expect(run.currentStepId).toBeNull();
    expect(run.completedAt).not.toBeNull();
  });

  it('fail sets status=failed and completedAt', () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', templateId: 'wf-1',
      templateSnapshot: snapshot, triggeredBy: '@john', triggeredFrom: 'comment:c-1',
    });
    run.fail();
    expect(run.status).toBe('failed');
    expect(run.completedAt).not.toBeNull();
  });

  it('cancel sets status=cancelled and completedAt', () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', templateId: 'wf-1',
      templateSnapshot: snapshot, triggeredBy: '@john', triggeredFrom: 'comment:c-1',
    });
    run.cancel();
    expect(run.status).toBe('cancelled');
    expect(run.completedAt).not.toBeNull();
  });

  it('isActive returns true for running|blocked|needs_review', () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', templateId: 'wf-1',
      templateSnapshot: snapshot, triggeredBy: '@john', triggeredFrom: 'comment:c-1',
    });
    expect(run.isActive()).toBe(true);
    run.block();
    expect(run.isActive()).toBe(true);
    run.complete();
    expect(run.isActive()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/server test -- --run workflow-run.entity`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the entity**

Write `packages/server/src/domain/entities/workflow-run.entity.ts`:

```ts
import type {
  WorkflowRun, WorkflowRunStatus, WorkflowTemplateSnapshot,
} from '@fleex/shared';

const ACTIVE_STATUSES: WorkflowRunStatus[] = ['running', 'blocked', 'needs_review'];

export class WorkflowRunEntity {
  constructor(
    public readonly id: string,
    public readonly ticketId: string,
    public readonly templateId: string,
    public readonly templateSnapshot: WorkflowTemplateSnapshot,
    public status: WorkflowRunStatus,
    public currentStepId: string | null,
    public readonly triggeredBy: string,
    public readonly triggeredFrom: string,
    public readonly startedAt: Date,
    public completedAt: Date | null,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    id: string;
    ticketId: string;
    templateId: string;
    templateSnapshot: WorkflowTemplateSnapshot;
    triggeredBy: string;
    triggeredFrom: string;
  }): WorkflowRunEntity {
    const now = new Date();
    return new WorkflowRunEntity(
      params.id,
      params.ticketId,
      params.templateId,
      params.templateSnapshot,
      'running',
      params.templateSnapshot.entryStepId,
      params.triggeredBy,
      params.triggeredFrom,
      now,
      null,
      now,
      now,
    );
  }

  advanceTo(stepId: string): void {
    this.currentStepId = stepId;
    this.status = 'running';
    this.updatedAt = new Date();
  }

  block(): void {
    this.status = 'needs_review';
    this.updatedAt = new Date();
  }

  complete(): void {
    this.status = 'completed';
    this.currentStepId = null;
    this.completedAt = new Date();
    this.updatedAt = new Date();
  }

  fail(): void {
    this.status = 'failed';
    this.completedAt = new Date();
    this.updatedAt = new Date();
  }

  cancel(): void {
    this.status = 'cancelled';
    this.completedAt = new Date();
    this.updatedAt = new Date();
  }

  isActive(): boolean {
    return ACTIVE_STATUSES.includes(this.status);
  }

  findStep(stepId: string) {
    return this.templateSnapshot.steps.find((s) => s.id === stepId);
  }

  outgoingEdges(stepId: string) {
    return this.templateSnapshot.edges.filter((e) => e.source === stepId);
  }

  toDTO(): WorkflowRun {
    return {
      id: this.id,
      ticketId: this.ticketId,
      templateId: this.templateId,
      templateSnapshot: this.templateSnapshot,
      status: this.status,
      currentStepId: this.currentStepId,
      triggeredBy: this.triggeredBy,
      triggeredFrom: this.triggeredFrom,
      startedAt: this.startedAt.toISOString(),
      completedAt: this.completedAt?.toISOString() ?? null,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/server test -- --run workflow-run.entity`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domain/entities/workflow-run.entity.ts packages/server/tests/unit/workflow-run.entity.test.ts
git commit -m "feat(server): WorkflowRunEntity with state transitions"
```

---

### Task A.5: `StepRunEntity`

**Files:**
- Create: `packages/server/src/domain/entities/step-run.entity.ts`
- Create: `packages/server/tests/unit/step-run.entity.test.ts`

- [ ] **Step 1: Write the failing test**

Write `packages/server/tests/unit/step-run.entity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';

describe('StepRunEntity', () => {
  it('creates with attempt=1 status=queued by default', () => {
    const sr = StepRunEntity.create({
      id: 'sr-1', workflowRunId: 'run-1', stepId: 'triage',
    });
    expect(sr.attempt).toBe(1);
    expect(sr.status).toBe('queued');
    expect(sr.output).toBeNull();
  });

  it('start sets status=running and startedAt', () => {
    const sr = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'triage' });
    sr.start();
    expect(sr.status).toBe('running');
    expect(sr.startedAt).not.toBeNull();
  });

  it('complete with output and result sets status=completed', () => {
    const sr = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'triage' });
    sr.start();
    sr.complete({
      output: { schemaFields: { path: 'standard' }, result: 'ok' },
      nextEdgeId: 'e1',
      executionId: 'exec-1',
    });
    expect(sr.status).toBe('completed');
    expect(sr.result).toBe('ok');
    expect(sr.nextEdgeId).toBe('e1');
    expect(sr.executionId).toBe('exec-1');
    expect(sr.completedAt).not.toBeNull();
    expect(sr.output?.schemaFields.path).toBe('standard');
  });

  it('markNeedsReview sets status=needs_review and result=needs_review', () => {
    const sr = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'gate' });
    sr.start();
    sr.markNeedsReview({ output: { schemaFields: { outcomes: ['approve','reject'] }, result: 'needs_review' } });
    expect(sr.status).toBe('needs_review');
    expect(sr.result).toBe('needs_review');
  });

  it('fail sets status=failed and result=ko', () => {
    const sr = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'triage' });
    sr.start();
    sr.fail();
    expect(sr.status).toBe('failed');
    expect(sr.result).toBe('ko');
    expect(sr.completedAt).not.toBeNull();
  });

  it('resolveGate writes outcome to output.schemaFields', () => {
    const sr = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'gate' });
    sr.start();
    sr.markNeedsReview({ output: { schemaFields: { outcomes: ['approve'] }, result: 'needs_review' } });
    sr.resolveGate('approve', 'looks good');
    expect(sr.status).toBe('completed');
    expect(sr.result).toBe('ok');
    expect(sr.output?.schemaFields.outcome).toBe('approve');
    expect(sr.output?.schemaFields.notes).toBe('looks good');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/server test -- --run step-run.entity`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the entity**

Write `packages/server/src/domain/entities/step-run.entity.ts`:

```ts
import type { StepRun, StepRunStatus, StepRunResult, StepOutput } from '@fleex/shared';

export class StepRunEntity {
  constructor(
    public readonly id: string,
    public readonly workflowRunId: string,
    public readonly stepId: string,
    public attempt: number,
    public status: StepRunStatus,
    public result: StepRunResult | null,
    public output: StepOutput | null,
    public nextEdgeId: string | null,
    public executionId: string | null,
    public startedAt: Date | null,
    public completedAt: Date | null,
    public readonly createdAt: Date,
  ) {}

  static create(params: {
    id: string;
    workflowRunId: string;
    stepId: string;
    attempt?: number;
  }): StepRunEntity {
    return new StepRunEntity(
      params.id,
      params.workflowRunId,
      params.stepId,
      params.attempt ?? 1,
      'queued',
      null,
      null,
      null,
      null,
      null,
      null,
      new Date(),
    );
  }

  start(): void {
    this.status = 'running';
    this.startedAt = new Date();
  }

  complete(params: {
    output: StepOutput;
    nextEdgeId?: string | null;
    executionId?: string | null;
  }): void {
    this.status = 'completed';
    this.result = params.output.result;
    this.output = params.output;
    this.nextEdgeId = params.nextEdgeId ?? null;
    this.executionId = params.executionId ?? null;
    this.completedAt = new Date();
  }

  markNeedsReview(params: { output: StepOutput; executionId?: string | null }): void {
    this.status = 'needs_review';
    this.result = 'needs_review';
    this.output = params.output;
    this.executionId = params.executionId ?? null;
  }

  fail(error?: { message: string }): void {
    this.status = 'failed';
    this.result = 'ko';
    if (error && this.output) {
      this.output = { ...this.output, schemaFields: { ...this.output.schemaFields, error: error.message } };
    } else if (error) {
      this.output = { schemaFields: { error: error.message }, result: 'ko' };
    }
    this.completedAt = new Date();
  }

  cancel(): void {
    this.status = 'cancelled';
    this.completedAt = new Date();
  }

  resolveGate(outcome: string, notes?: string): void {
    const prev = this.output ?? { schemaFields: {}, result: 'needs_review' as const };
    this.output = {
      ...prev,
      schemaFields: { ...prev.schemaFields, outcome, ...(notes ? { notes } : {}) },
      outcome,
      result: 'ok',
    };
    this.status = 'completed';
    this.result = 'ok';
    this.completedAt = new Date();
  }

  toDTO(): StepRun {
    return {
      id: this.id,
      workflowRunId: this.workflowRunId,
      stepId: this.stepId,
      attempt: this.attempt,
      status: this.status,
      result: this.result,
      output: this.output,
      nextEdgeId: this.nextEdgeId,
      executionId: this.executionId,
      startedAt: this.startedAt?.toISOString() ?? null,
      completedAt: this.completedAt?.toISOString() ?? null,
      createdAt: this.createdAt.toISOString(),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/server test -- --run step-run.entity`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domain/entities/step-run.entity.ts packages/server/tests/unit/step-run.entity.test.ts
git commit -m "feat(server): StepRunEntity with retry-friendly append-only semantics"
```

---

### Task A.6: Store ports

**Files:**
- Create: `packages/server/src/application/ports/workflow-template-store.port.ts`
- Create: `packages/server/src/application/ports/workflow-run-store.port.ts`
- Create: `packages/server/src/application/ports/step-run-store.port.ts`

- [ ] **Step 1: Write `workflow-template-store.port.ts`**

```ts
import type { WorkflowTemplateEntity } from '../../domain/entities/workflow-template.entity.js';

export interface WorkflowTemplateStorePort {
  getAll(): Promise<WorkflowTemplateEntity[]>;
  getById(id: string): Promise<WorkflowTemplateEntity | null>;
  getBySlug(slug: string): Promise<WorkflowTemplateEntity | null>;
  getEnabled(): Promise<WorkflowTemplateEntity[]>;
  save(template: WorkflowTemplateEntity): Promise<void>;
  remove(id: string): Promise<void>;
}
```

- [ ] **Step 2: Write `workflow-run-store.port.ts`**

```ts
import type { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import type { WorkflowRunStatus } from '@fleex/shared';

export interface WorkflowRunStorePort {
  getById(id: string): Promise<WorkflowRunEntity | null>;
  getByTicket(ticketId: string): Promise<WorkflowRunEntity[]>;
  getActiveByTicket(ticketId: string): Promise<WorkflowRunEntity | null>;
  getByStatus(status: WorkflowRunStatus): Promise<WorkflowRunEntity[]>;
  save(run: WorkflowRunEntity): Promise<void>;
}
```

- [ ] **Step 3: Write `step-run-store.port.ts`**

```ts
import type { StepRunEntity } from '../../domain/entities/step-run.entity.js';

export interface StepRunStorePort {
  getById(id: string): Promise<StepRunEntity | null>;
  getByWorkflowRun(workflowRunId: string): Promise<StepRunEntity[]>;
  getLatestForStep(workflowRunId: string, stepId: string): Promise<StepRunEntity | null>;
  save(stepRun: StepRunEntity): Promise<void>;
}
```

- [ ] **Step 4: Typecheck**

Run: `bun run --cwd packages/server typecheck` (or `tsc --noEmit` per the package script)
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/application/ports/workflow-*.port.ts packages/server/src/application/ports/step-run-store.port.ts
git commit -m "feat(server): workflow store ports (template, run, step-run)"
```

---

### Task A.7: SQLite adapters for workflow stores

**Files:**
- Create: `packages/server/src/infrastructure/adapters/sqlite/sqlite-workflow-template-store.adapter.ts`
- Create: `packages/server/src/infrastructure/adapters/sqlite/sqlite-workflow-run-store.adapter.ts`
- Create: `packages/server/src/infrastructure/adapters/sqlite/sqlite-step-run-store.adapter.ts`

- [ ] **Step 1: Write `sqlite-workflow-template-store.adapter.ts`**

```ts
import { WorkflowTemplateEntity } from '../../../domain/entities/workflow-template.entity.js';
import type { WorkflowTemplateStorePort } from '../../../application/ports/workflow-template-store.port.js';
import type { SqliteConnection } from './connection.js';
import type { WorkflowStep, WorkflowEdge } from '@fleex/shared';

interface Row {
  id: string;
  name: string;
  slug: string;
  emoji: string;
  description: string;
  steps: string;
  edges: string;
  entry_step_id: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export class SqliteWorkflowTemplateStoreAdapter implements WorkflowTemplateStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getAll() {
    const rows = this.conn.db.prepare('SELECT * FROM workflow_templates ORDER BY name ASC').all() as Row[];
    return rows.map((r) => this.toEntity(r));
  }
  async getById(id: string) {
    const r = this.conn.db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(id) as Row | undefined;
    return r ? this.toEntity(r) : null;
  }
  async getBySlug(slug: string) {
    const r = this.conn.db.prepare('SELECT * FROM workflow_templates WHERE slug = ?').get(slug) as Row | undefined;
    return r ? this.toEntity(r) : null;
  }
  async getEnabled() {
    const rows = this.conn.db.prepare('SELECT * FROM workflow_templates WHERE enabled = 1 ORDER BY name ASC').all() as Row[];
    return rows.map((r) => this.toEntity(r));
  }
  async save(t: WorkflowTemplateEntity) {
    this.conn.db.prepare(`
      INSERT OR REPLACE INTO workflow_templates
        (id, name, slug, emoji, description, steps, edges, entry_step_id, enabled, created_at, updated_at)
      VALUES
        (@id, @name, @slug, @emoji, @description, @steps, @edges, @entry_step_id, @enabled, @created_at, @updated_at)
    `).run({
      id: t.id, name: t.name, slug: t.slug, emoji: t.emoji, description: t.description,
      steps: JSON.stringify(t.steps), edges: JSON.stringify(t.edges),
      entry_step_id: t.entryStepId, enabled: t.enabled ? 1 : 0,
      created_at: t.createdAt.toISOString(), updated_at: t.updatedAt.toISOString(),
    });
  }
  async remove(id: string) {
    this.conn.db.prepare('DELETE FROM workflow_templates WHERE id = ?').run(id);
  }

  private toEntity(r: Row): WorkflowTemplateEntity {
    return new WorkflowTemplateEntity(
      r.id, r.name, r.slug, r.emoji, r.description,
      JSON.parse(r.steps) as WorkflowStep[],
      JSON.parse(r.edges) as WorkflowEdge[],
      r.entry_step_id, r.enabled === 1,
      new Date(r.created_at), new Date(r.updated_at),
    );
  }
}
```

- [ ] **Step 2: Write `sqlite-workflow-run-store.adapter.ts`**

```ts
import { WorkflowRunEntity } from '../../../domain/entities/workflow-run.entity.js';
import type { WorkflowRunStorePort } from '../../../application/ports/workflow-run-store.port.js';
import type { SqliteConnection } from './connection.js';
import type { WorkflowRunStatus, WorkflowTemplateSnapshot } from '@fleex/shared';

const ACTIVE = "('running','blocked','needs_review')";

interface Row {
  id: string;
  ticket_id: string;
  template_id: string;
  template_snapshot: string;
  status: string;
  current_step_id: string | null;
  triggered_by: string;
  triggered_from: string;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export class SqliteWorkflowRunStoreAdapter implements WorkflowRunStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getById(id: string) {
    const r = this.conn.db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as Row | undefined;
    return r ? this.toEntity(r) : null;
  }
  async getByTicket(ticketId: string) {
    const rows = this.conn.db.prepare('SELECT * FROM workflow_runs WHERE ticket_id = ? ORDER BY started_at DESC').all(ticketId) as Row[];
    return rows.map((r) => this.toEntity(r));
  }
  async getActiveByTicket(ticketId: string) {
    const r = this.conn.db.prepare(`SELECT * FROM workflow_runs WHERE ticket_id = ? AND status IN ${ACTIVE} LIMIT 1`).get(ticketId) as Row | undefined;
    return r ? this.toEntity(r) : null;
  }
  async getByStatus(status: WorkflowRunStatus) {
    const rows = this.conn.db.prepare('SELECT * FROM workflow_runs WHERE status = ?').all(status) as Row[];
    return rows.map((r) => this.toEntity(r));
  }
  async save(run: WorkflowRunEntity) {
    this.conn.db.prepare(`
      INSERT OR REPLACE INTO workflow_runs
        (id, ticket_id, template_id, template_snapshot, status, current_step_id,
         triggered_by, triggered_from, started_at, completed_at, created_at, updated_at)
      VALUES
        (@id, @ticket_id, @template_id, @template_snapshot, @status, @current_step_id,
         @triggered_by, @triggered_from, @started_at, @completed_at, @created_at, @updated_at)
    `).run({
      id: run.id,
      ticket_id: run.ticketId,
      template_id: run.templateId,
      template_snapshot: JSON.stringify(run.templateSnapshot),
      status: run.status,
      current_step_id: run.currentStepId,
      triggered_by: run.triggeredBy,
      triggered_from: run.triggeredFrom,
      started_at: run.startedAt.toISOString(),
      completed_at: run.completedAt?.toISOString() ?? null,
      created_at: run.createdAt.toISOString(),
      updated_at: run.updatedAt.toISOString(),
    });
  }

  private toEntity(r: Row): WorkflowRunEntity {
    return new WorkflowRunEntity(
      r.id, r.ticket_id, r.template_id,
      JSON.parse(r.template_snapshot) as WorkflowTemplateSnapshot,
      r.status as WorkflowRunStatus,
      r.current_step_id,
      r.triggered_by, r.triggered_from,
      new Date(r.started_at),
      r.completed_at ? new Date(r.completed_at) : null,
      new Date(r.created_at), new Date(r.updated_at),
    );
  }
}
```

- [ ] **Step 3: Write `sqlite-step-run-store.adapter.ts`**

```ts
import { StepRunEntity } from '../../../domain/entities/step-run.entity.js';
import type { StepRunStorePort } from '../../../application/ports/step-run-store.port.js';
import type { SqliteConnection } from './connection.js';
import type { StepRunStatus, StepRunResult, StepOutput } from '@fleex/shared';

interface Row {
  id: string;
  workflow_run_id: string;
  step_id: string;
  attempt: number;
  status: string;
  result: string | null;
  output: string | null;
  next_edge_id: string | null;
  execution_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export class SqliteStepRunStoreAdapter implements StepRunStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getById(id: string) {
    const r = this.conn.db.prepare('SELECT * FROM step_runs WHERE id = ?').get(id) as Row | undefined;
    return r ? this.toEntity(r) : null;
  }
  async getByWorkflowRun(workflowRunId: string) {
    const rows = this.conn.db.prepare('SELECT * FROM step_runs WHERE workflow_run_id = ? ORDER BY created_at ASC, attempt ASC').all(workflowRunId) as Row[];
    return rows.map((r) => this.toEntity(r));
  }
  async getLatestForStep(workflowRunId: string, stepId: string) {
    const r = this.conn.db.prepare(`
      SELECT * FROM step_runs WHERE workflow_run_id = ? AND step_id = ?
      ORDER BY attempt DESC LIMIT 1
    `).get(workflowRunId, stepId) as Row | undefined;
    return r ? this.toEntity(r) : null;
  }
  async save(sr: StepRunEntity) {
    this.conn.db.prepare(`
      INSERT OR REPLACE INTO step_runs
        (id, workflow_run_id, step_id, attempt, status, result, output,
         next_edge_id, execution_id, started_at, completed_at, created_at)
      VALUES
        (@id, @workflow_run_id, @step_id, @attempt, @status, @result, @output,
         @next_edge_id, @execution_id, @started_at, @completed_at, @created_at)
    `).run({
      id: sr.id,
      workflow_run_id: sr.workflowRunId,
      step_id: sr.stepId,
      attempt: sr.attempt,
      status: sr.status,
      result: sr.result,
      output: sr.output ? JSON.stringify(sr.output) : null,
      next_edge_id: sr.nextEdgeId,
      execution_id: sr.executionId,
      started_at: sr.startedAt?.toISOString() ?? null,
      completed_at: sr.completedAt?.toISOString() ?? null,
      created_at: sr.createdAt.toISOString(),
    });
  }

  private toEntity(r: Row): StepRunEntity {
    return new StepRunEntity(
      r.id, r.workflow_run_id, r.step_id, r.attempt,
      r.status as StepRunStatus,
      (r.result as StepRunResult | null) ?? null,
      r.output ? JSON.parse(r.output) as StepOutput : null,
      r.next_edge_id, r.execution_id,
      r.started_at ? new Date(r.started_at) : null,
      r.completed_at ? new Date(r.completed_at) : null,
      new Date(r.created_at),
    );
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `bun run --cwd packages/server typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/infrastructure/adapters/sqlite/sqlite-workflow-*.ts packages/server/src/infrastructure/adapters/sqlite/sqlite-step-run-store.adapter.ts
git commit -m "feat(server): SQLite adapters for workflow stores"
```

---

### Task A.8: Supabase adapters for workflow stores

**Files:**
- Create: `packages/server/src/infrastructure/adapters/supabase/supabase-workflow-template-store.adapter.ts`
- Create: `packages/server/src/infrastructure/adapters/supabase/supabase-workflow-run-store.adapter.ts`
- Create: `packages/server/src/infrastructure/adapters/supabase/supabase-step-run-store.adapter.ts`

For each, follow the exact pattern of `supabase-skill-store.adapter.ts` (read it first to confirm the API shape used: `this.client.from('table').select/insert/upsert/delete...`).

- [ ] **Step 1: Read the existing Supabase adapter pattern**

Run: `head -80 packages/server/src/infrastructure/adapters/supabase/supabase-skill-store.adapter.ts`
Note: column names use snake_case, JSON columns stored as JSONB so no `JSON.stringify` needed on insert.

- [ ] **Step 2: Write `supabase-workflow-template-store.adapter.ts`**

```ts
import { WorkflowTemplateEntity } from '../../../domain/entities/workflow-template.entity.js';
import type { WorkflowTemplateStorePort } from '../../../application/ports/workflow-template-store.port.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkflowStep, WorkflowEdge } from '@fleex/shared';

interface Row {
  id: string;
  name: string;
  slug: string;
  emoji: string;
  description: string;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  entry_step_id: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export class SupabaseWorkflowTemplateStoreAdapter implements WorkflowTemplateStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async getAll() {
    const { data, error } = await this.client.from('workflow_templates').select('*').order('name');
    if (error) throw error;
    return (data ?? []).map((r) => this.toEntity(r as Row));
  }
  async getById(id: string) {
    const { data, error } = await this.client.from('workflow_templates').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? this.toEntity(data as Row) : null;
  }
  async getBySlug(slug: string) {
    const { data, error } = await this.client.from('workflow_templates').select('*').eq('slug', slug).maybeSingle();
    if (error) throw error;
    return data ? this.toEntity(data as Row) : null;
  }
  async getEnabled() {
    const { data, error } = await this.client.from('workflow_templates').select('*').eq('enabled', true).order('name');
    if (error) throw error;
    return (data ?? []).map((r) => this.toEntity(r as Row));
  }
  async save(t: WorkflowTemplateEntity) {
    const { error } = await this.client.from('workflow_templates').upsert({
      id: t.id, name: t.name, slug: t.slug, emoji: t.emoji, description: t.description,
      steps: t.steps, edges: t.edges, entry_step_id: t.entryStepId, enabled: t.enabled,
      created_at: t.createdAt.toISOString(), updated_at: t.updatedAt.toISOString(),
    });
    if (error) throw error;
  }
  async remove(id: string) {
    const { error } = await this.client.from('workflow_templates').delete().eq('id', id);
    if (error) throw error;
  }

  private toEntity(r: Row): WorkflowTemplateEntity {
    return new WorkflowTemplateEntity(
      r.id, r.name, r.slug, r.emoji, r.description,
      r.steps, r.edges, r.entry_step_id, r.enabled,
      new Date(r.created_at), new Date(r.updated_at),
    );
  }
}
```

- [ ] **Step 3: Write `supabase-workflow-run-store.adapter.ts`**

```ts
import { WorkflowRunEntity } from '../../../domain/entities/workflow-run.entity.js';
import type { WorkflowRunStorePort } from '../../../application/ports/workflow-run-store.port.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkflowRunStatus, WorkflowTemplateSnapshot } from '@fleex/shared';

interface Row {
  id: string;
  ticket_id: string;
  template_id: string;
  template_snapshot: WorkflowTemplateSnapshot;
  status: string;
  current_step_id: string | null;
  triggered_by: string;
  triggered_from: string;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

const ACTIVE: WorkflowRunStatus[] = ['running', 'blocked', 'needs_review'];

export class SupabaseWorkflowRunStoreAdapter implements WorkflowRunStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async getById(id: string) {
    const { data, error } = await this.client.from('workflow_runs').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? this.toEntity(data as Row) : null;
  }
  async getByTicket(ticketId: string) {
    const { data, error } = await this.client.from('workflow_runs').select('*').eq('ticket_id', ticketId).order('started_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => this.toEntity(r as Row));
  }
  async getActiveByTicket(ticketId: string) {
    const { data, error } = await this.client.from('workflow_runs').select('*').eq('ticket_id', ticketId).in('status', ACTIVE).limit(1).maybeSingle();
    if (error) throw error;
    return data ? this.toEntity(data as Row) : null;
  }
  async getByStatus(status: WorkflowRunStatus) {
    const { data, error } = await this.client.from('workflow_runs').select('*').eq('status', status);
    if (error) throw error;
    return (data ?? []).map((r) => this.toEntity(r as Row));
  }
  async save(run: WorkflowRunEntity) {
    const { error } = await this.client.from('workflow_runs').upsert({
      id: run.id, ticket_id: run.ticketId, template_id: run.templateId,
      template_snapshot: run.templateSnapshot,
      status: run.status, current_step_id: run.currentStepId,
      triggered_by: run.triggeredBy, triggered_from: run.triggeredFrom,
      started_at: run.startedAt.toISOString(),
      completed_at: run.completedAt?.toISOString() ?? null,
      created_at: run.createdAt.toISOString(), updated_at: run.updatedAt.toISOString(),
    });
    if (error) throw error;
  }

  private toEntity(r: Row): WorkflowRunEntity {
    return new WorkflowRunEntity(
      r.id, r.ticket_id, r.template_id, r.template_snapshot,
      r.status as WorkflowRunStatus, r.current_step_id,
      r.triggered_by, r.triggered_from,
      new Date(r.started_at),
      r.completed_at ? new Date(r.completed_at) : null,
      new Date(r.created_at), new Date(r.updated_at),
    );
  }
}
```

- [ ] **Step 4: Write `supabase-step-run-store.adapter.ts`**

```ts
import { StepRunEntity } from '../../../domain/entities/step-run.entity.js';
import type { StepRunStorePort } from '../../../application/ports/step-run-store.port.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StepRunStatus, StepRunResult, StepOutput } from '@fleex/shared';

interface Row {
  id: string;
  workflow_run_id: string;
  step_id: string;
  attempt: number;
  status: string;
  result: string | null;
  output: StepOutput | null;
  next_edge_id: string | null;
  execution_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export class SupabaseStepRunStoreAdapter implements StepRunStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async getById(id: string) {
    const { data, error } = await this.client.from('step_runs').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? this.toEntity(data as Row) : null;
  }
  async getByWorkflowRun(workflowRunId: string) {
    const { data, error } = await this.client.from('step_runs').select('*').eq('workflow_run_id', workflowRunId).order('created_at').order('attempt');
    if (error) throw error;
    return (data ?? []).map((r) => this.toEntity(r as Row));
  }
  async getLatestForStep(workflowRunId: string, stepId: string) {
    const { data, error } = await this.client.from('step_runs').select('*')
      .eq('workflow_run_id', workflowRunId).eq('step_id', stepId)
      .order('attempt', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data ? this.toEntity(data as Row) : null;
  }
  async save(sr: StepRunEntity) {
    const { error } = await this.client.from('step_runs').upsert({
      id: sr.id, workflow_run_id: sr.workflowRunId, step_id: sr.stepId, attempt: sr.attempt,
      status: sr.status, result: sr.result, output: sr.output,
      next_edge_id: sr.nextEdgeId, execution_id: sr.executionId,
      started_at: sr.startedAt?.toISOString() ?? null,
      completed_at: sr.completedAt?.toISOString() ?? null,
      created_at: sr.createdAt.toISOString(),
    });
    if (error) throw error;
  }

  private toEntity(r: Row): StepRunEntity {
    return new StepRunEntity(
      r.id, r.workflow_run_id, r.step_id, r.attempt,
      r.status as StepRunStatus,
      (r.result as StepRunResult | null) ?? null,
      r.output,
      r.next_edge_id, r.execution_id,
      r.started_at ? new Date(r.started_at) : null,
      r.completed_at ? new Date(r.completed_at) : null,
      new Date(r.created_at),
    );
  }
}
```

- [ ] **Step 5: Typecheck + commit**

```bash
bun run --cwd packages/server typecheck
git add packages/server/src/infrastructure/adapters/supabase/supabase-workflow-*.ts packages/server/src/infrastructure/adapters/supabase/supabase-step-run-store.adapter.ts
git commit -m "feat(server): Supabase adapters for workflow stores"
```

---

### Task A.9: Wire workflow stores into DI container

**Files:**
- Modify: `packages/server/src/infrastructure/container.ts` (or whichever file wires adapters — check pattern from skillStore)

- [ ] **Step 1: Locate the DI wiring for `skillStore`**

Run: `grep -rn "skillStore" packages/server/src/infrastructure/container.ts packages/server/src/infrastructure/server.ts 2>/dev/null | head -10`
Note the exact pattern: typically `const skillStore = new SqliteSkillStoreAdapter(conn)` or similar dispatched by adapter type.

- [ ] **Step 2: Add the 3 new stores to the container**

Add imports near the existing skill imports, then construct the stores using the same conditional adapter selection (`'sqlite' | 'supabase' | 'json'`). Add them to the exported container object as `workflowTemplateStore`, `workflowRunStore`, `stepRunStore`.

- [ ] **Step 3: Typecheck and start the server**

Run: `bun run --cwd packages/server typecheck && fleex restart`
Expected: server starts cleanly, no errors in logs.

- [ ] **Step 4: Smoke test the migration**

Run: `fleex logs server | grep -i "017_add_workflows\|workflow_templates"`
Expected: see migration execution log.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/infrastructure/container.ts
git commit -m "feat(server): wire workflow stores into DI container"
```

---

_End of Phase A._

---

## Phase B — Orchestrateur

### Task B.1: `EdgeEvaluator` — pure function

**Files:**
- Create: `packages/server/src/application/services/edge-evaluator.ts`
- Create: `packages/server/tests/unit/edge-evaluator.test.ts`

- [ ] **Step 1: Write the failing test**

Write `packages/server/tests/unit/edge-evaluator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EdgeEvaluator } from '../../src/application/services/edge-evaluator.js';
import type { WorkflowEdge } from '@fleex/shared';

const edge = (overrides: Partial<WorkflowEdge> & { id: string; source: string; target: string }): WorkflowEdge => ({
  isDefault: false, ...overrides,
});

describe('EdgeEvaluator', () => {
  it('returns null when no edges', () => {
    expect(EdgeEvaluator.resolve({ schemaFields: {}, result: 'ok' }, [])).toBeNull();
  });

  it('returns the matching conditional edge (eq)', () => {
    const edges = [
      edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'path', operator: 'eq', value: 'standard' } }),
      edge({ id: 'e2', source: 's', target: 't2', condition: { field: 'path', operator: 'eq', value: 'hotfix' } }),
    ];
    const out = { schemaFields: { path: 'hotfix' }, result: 'ok' as const };
    expect(EdgeEvaluator.resolve(out, edges)?.id).toBe('e2');
  });

  it('returns the default edge when no condition matches', () => {
    const edges = [
      edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'path', operator: 'eq', value: 'standard' } }),
      edge({ id: 'e2', source: 's', target: 't2', isDefault: true }),
    ];
    const out = { schemaFields: { path: 'unknown' }, result: 'ok' as const };
    expect(EdgeEvaluator.resolve(out, edges)?.id).toBe('e2');
  });

  it('returns null when no condition matches and no default', () => {
    const edges = [
      edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'path', operator: 'eq', value: 'standard' } }),
    ];
    const out = { schemaFields: { path: 'other' }, result: 'ok' as const };
    expect(EdgeEvaluator.resolve(out, edges)).toBeNull();
  });

  it('handles dotted paths (deliverable.status)', () => {
    const edges = [
      edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'deliverable.status', operator: 'eq', value: 'final' } }),
    ];
    const out = { deliverable: { status: 'final' as const, title: 'x', markdown: 'y', type: 'report' }, schemaFields: {}, result: 'ok' as const };
    expect(EdgeEvaluator.resolve(out, edges)?.id).toBe('e1');
  });

  it('operator neq', () => {
    const edges = [edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'x', operator: 'neq', value: '1' } })];
    expect(EdgeEvaluator.resolve({ schemaFields: { x: '2' }, result: 'ok' }, edges)?.id).toBe('e1');
    expect(EdgeEvaluator.resolve({ schemaFields: { x: '1' }, result: 'ok' }, edges)).toBeNull();
  });

  it('operator in', () => {
    const edges = [edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'p', operator: 'in', value: ['a','b'] } })];
    expect(EdgeEvaluator.resolve({ schemaFields: { p: 'b' }, result: 'ok' }, edges)?.id).toBe('e1');
    expect(EdgeEvaluator.resolve({ schemaFields: { p: 'c' }, result: 'ok' }, edges)).toBeNull();
  });

  it('operator gt/lt', () => {
    const edges = [edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'n', operator: 'gt', value: '5' } })];
    expect(EdgeEvaluator.resolve({ schemaFields: { n: 10 }, result: 'ok' }, edges)?.id).toBe('e1');
    expect(EdgeEvaluator.resolve({ schemaFields: { n: 3 }, result: 'ok' }, edges)).toBeNull();
    expect(EdgeEvaluator.resolve({ schemaFields: { n: 'NaN' }, result: 'ok' }, edges)).toBeNull();
  });

  it('operator contains', () => {
    const edges = [edge({ id: 'e1', source: 's', target: 't1', condition: { field: 's', operator: 'contains', value: 'foo' } })];
    expect(EdgeEvaluator.resolve({ schemaFields: { s: 'hello foobar' }, result: 'ok' }, edges)?.id).toBe('e1');
    expect(EdgeEvaluator.resolve({ schemaFields: { s: 'bye' }, result: 'ok' }, edges)).toBeNull();
  });

  it('outcome shorthand: edges can match on outcome top-level field', () => {
    const edges = [edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'outcome', operator: 'eq', value: 'approve' } })];
    const out = { schemaFields: {}, outcome: 'approve', result: 'ok' as const };
    expect(EdgeEvaluator.resolve(out, edges)?.id).toBe('e1');
  });

  it('stable order: first matching conditional wins', () => {
    const edges = [
      edge({ id: 'e1', source: 's', target: 't1', condition: { field: 'x', operator: 'eq', value: 'a' } }),
      edge({ id: 'e2', source: 's', target: 't2', condition: { field: 'x', operator: 'eq', value: 'a' } }),
    ];
    expect(EdgeEvaluator.resolve({ schemaFields: { x: 'a' }, result: 'ok' }, edges)?.id).toBe('e1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/server test -- --run edge-evaluator`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Write `packages/server/src/application/services/edge-evaluator.ts`:

```ts
import type { WorkflowEdge, StepOutput, EdgeOperator } from '@fleex/shared';

export const EdgeEvaluator = {
  resolve(output: StepOutput, edges: WorkflowEdge[]): WorkflowEdge | null {
    const conditional = edges.filter((e) => e.condition && !e.isDefault).sort((a, b) => a.id.localeCompare(b.id));
    const defaults = edges.filter((e) => e.isDefault).sort((a, b) => a.id.localeCompare(b.id));

    for (const edge of conditional) {
      if (!edge.condition) continue;
      const actual = getByPath(output, edge.condition.field);
      if (matches(actual, edge.condition.operator, edge.condition.value)) {
        return edge;
      }
    }
    return defaults[0] ?? null;
  },
};

function getByPath(output: StepOutput, path: string): unknown {
  // Merged view: schemaFields at top-level, plus standard fields
  const merged: Record<string, unknown> = {
    ...output.schemaFields,
    deliverable: output.deliverable,
    comment: output.comment,
    mentionStatus: output.mentionStatus,
    outcome: output.outcome,
    result: output.result,
  };
  const parts = path.split('.');
  let cur: unknown = merged;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as object)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function matches(actual: unknown, op: EdgeOperator, value: string | string[]): boolean {
  switch (op) {
    case 'eq':       return actual === value;
    case 'neq':      return actual !== value;
    case 'in':       return Array.isArray(value) && value.includes(String(actual));
    case 'gt': {
      const a = Number(actual), v = Number(value as string);
      return Number.isFinite(a) && Number.isFinite(v) && a > v;
    }
    case 'lt': {
      const a = Number(actual), v = Number(value as string);
      return Number.isFinite(a) && Number.isFinite(v) && a < v;
    }
    case 'contains': return typeof actual === 'string' && typeof value === 'string' && actual.includes(value);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/server test -- --run edge-evaluator`
Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/application/services/edge-evaluator.ts packages/server/tests/unit/edge-evaluator.test.ts
git commit -m "feat(server): EdgeEvaluator pure function with 6 operators"
```

---

### Task B.2: `mergeOutputSchemas` helper

**Files:**
- Create: `packages/server/src/application/utils/merge-output-schemas.ts`
- Create: `packages/server/tests/unit/merge-output-schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Write `packages/server/tests/unit/merge-output-schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeOutputSchemas, STANDARD_OUTPUT_SCHEMA } from '../../src/application/utils/merge-output-schemas.js';

describe('mergeOutputSchemas', () => {
  it('returns standard when custom is undefined', () => {
    const merged = mergeOutputSchemas(STANDARD_OUTPUT_SCHEMA, undefined);
    expect(merged).toEqual(STANDARD_OUTPUT_SCHEMA);
  });

  it('merges custom properties at top-level', () => {
    const custom = {
      type: 'object' as const,
      properties: { path: { type: 'string' as const, enum: ['standard','hotfix'] } },
      required: ['path'],
    };
    const merged = mergeOutputSchemas(STANDARD_OUTPUT_SCHEMA, custom);
    expect((merged.schema.properties as Record<string, unknown>).path).toEqual({ type: 'string', enum: ['standard','hotfix'] });
    expect((merged.schema.properties as Record<string, unknown>).deliverable).toBeDefined();
    expect(merged.schema.required).toContain('path');
    expect(merged.schema.required).toContain('deliverable');
  });

  it('custom required is added without removing standard required', () => {
    const merged = mergeOutputSchemas(STANDARD_OUTPUT_SCHEMA, {
      type: 'object', properties: { x: { type: 'string' } }, required: ['x'],
    });
    expect(merged.schema.required).toEqual(expect.arrayContaining(['x', 'deliverable', 'comment']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/server test -- --run merge-output-schemas`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

Write `packages/server/src/application/utils/merge-output-schemas.ts`:

```ts
import { DELIVERABLE_TYPES, DELIVERABLE_STATUSES } from '@fleex/shared';
import type { JsonSchema } from '@fleex/shared';

export const STANDARD_OUTPUT_SCHEMA = {
  type: 'json_schema' as const,
  schema: {
    type: 'object' as const,
    properties: {
      deliverable: {
        oneOf: [
          {
            type: 'object',
            properties: {
              title: { type: 'string' },
              markdown: { type: 'string' },
              type: { type: 'string', enum: [...DELIVERABLE_TYPES] },
              status: { type: 'string', enum: [...DELIVERABLE_STATUSES] },
            },
            required: ['title', 'markdown', 'type', 'status'],
          },
          { type: 'null' },
        ],
      },
      comment: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      mentionStatus: { type: 'string', enum: ['resolved', 'waiting_for_info'], default: 'resolved' },
    },
    required: ['deliverable', 'comment'],
  },
};

export function mergeOutputSchemas(
  standard: typeof STANDARD_OUTPUT_SCHEMA,
  custom: JsonSchema | undefined,
): typeof STANDARD_OUTPUT_SCHEMA {
  if (!custom) return standard;
  return {
    type: standard.type,
    schema: {
      type: 'object',
      properties: { ...standard.schema.properties, ...custom.properties },
      required: [...(standard.schema.required ?? []), ...(custom.required ?? [])],
    },
  } as typeof STANDARD_OUTPUT_SCHEMA;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/server test -- --run merge-output-schemas`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/application/utils/merge-output-schemas.ts packages/server/tests/unit/merge-output-schemas.test.ts
git commit -m "feat(server): mergeOutputSchemas helper + STANDARD_OUTPUT_SCHEMA extracted"
```

---

### Task B.3: Refactor — extract `OUTPUT_FORMAT_SCHEMA` const into shared helper

**Files:**
- Modify: `packages/server/src/application/use-cases/execute-agent.ts` (remove local OUTPUT_FORMAT_SCHEMA, import from helper)

- [ ] **Step 1: Replace the const definition**

In `packages/server/src/application/use-cases/execute-agent.ts:37-68`, delete the inline `OUTPUT_FORMAT_SCHEMA` constant and replace with an import at the top:

```ts
import { STANDARD_OUTPUT_SCHEMA as OUTPUT_FORMAT_SCHEMA } from '../utils/merge-output-schemas.js';
```

- [ ] **Step 2: Run existing tests to confirm no regression**

Run: `bun run --cwd packages/server test -- --run execute-agent`
Expected: existing tests still PASS (if any) ; otherwise typecheck succeeds.

- [ ] **Step 3: Typecheck**

Run: `bun run --cwd packages/server typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/application/use-cases/execute-agent.ts
git commit -m "refactor(server): use shared STANDARD_OUTPUT_SCHEMA in ExecuteAgentUseCase"
```

---

### Task B.4: `composeWorkflowContextPrompt` helper

**Files:**
- Create: `packages/server/src/application/utils/compose-workflow-context.ts`
- Create: `packages/server/tests/unit/compose-workflow-context.test.ts`

- [ ] **Step 1: Write the failing test**

Write `packages/server/tests/unit/compose-workflow-context.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { composeWorkflowContextPrompt } from '../../src/application/utils/compose-workflow-context.js';

describe('composeWorkflowContextPrompt', () => {
  it('renders workflow name + step + outputSchema + branches', () => {
    const out = composeWorkflowContextPrompt({
      workflowName: 'Feature Delivery',
      stepName: 'Triage',
      outputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', enum: ['standard','hotfix','doc_only'], description: 'Routing path' },
        },
        required: ['path'],
      },
      outgoingEdges: [
        { id: 'e1', label: 'standard', condition: { field: 'path', operator: 'eq', value: 'standard' }, targetName: 'Product Spec' },
        { id: 'e2', label: 'hotfix', condition: { field: 'path', operator: 'eq', value: 'hotfix' }, targetName: 'Development' },
      ],
      previousOutputs: {},
    });
    expect(out).toContain('Feature Delivery');
    expect(out).toContain('Triage');
    expect(out).toContain('path');
    expect(out).toContain('Routing path');
    expect(out).toContain('Product Spec');
    expect(out).toContain('Development');
  });

  it('renders previousOutputs when present', () => {
    const out = composeWorkflowContextPrompt({
      workflowName: 'X', stepName: 'Y',
      outputSchema: undefined,
      outgoingEdges: [],
      previousOutputs: { triage: { path: 'standard', priority: 'high' } },
    });
    expect(out).toContain('triage');
    expect(out).toContain('standard');
  });

  it('handles no outgoing edges (terminal step)', () => {
    const out = composeWorkflowContextPrompt({
      workflowName: 'X', stepName: 'Final',
      outputSchema: undefined, outgoingEdges: [], previousOutputs: {},
    });
    expect(out).toContain('terminal');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/server test -- --run compose-workflow-context`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

Write `packages/server/src/application/utils/compose-workflow-context.ts`:

```ts
import type { JsonSchema, WorkflowEdgeCondition } from '@fleex/shared';

export interface WorkflowContextInput {
  workflowName: string;
  stepName: string;
  outputSchema: JsonSchema | undefined;
  outgoingEdges: {
    id: string;
    label?: string;
    condition?: WorkflowEdgeCondition;
    targetName: string;
  }[];
  previousOutputs: Record<string, Record<string, unknown>>;
}

export function composeWorkflowContextPrompt(input: WorkflowContextInput): string {
  const parts: string[] = [];

  parts.push(`## Workflow Context`);
  parts.push('');
  parts.push(`You are executing step **${input.stepName}** of workflow **${input.workflowName}**.`);
  parts.push('');

  if (input.outputSchema && Object.keys(input.outputSchema.properties).length > 0) {
    parts.push(`**Expected output fields** (in addition to the standard \`deliverable\`/\`comment\`/\`mentionStatus\`):`);
    for (const [name, prop] of Object.entries(input.outputSchema.properties)) {
      const enumPart = prop.enum ? ` (enum: ${prop.enum.join(', ')})` : '';
      const descPart = prop.description ? ` — ${prop.description}` : '';
      parts.push(`- \`${name}\`${enumPart}${descPart}`);
    }
    parts.push('');
  }

  if (input.outgoingEdges.length === 0) {
    parts.push('This is a **terminal step** — the workflow will complete after your output.');
  } else {
    parts.push(`**Branching from this step**:`);
    for (const e of input.outgoingEdges) {
      if (e.condition) {
        const opSym = opSymbol(e.condition.operator);
        const value = Array.isArray(e.condition.value) ? JSON.stringify(e.condition.value) : `"${e.condition.value}"`;
        parts.push(`- If \`${e.condition.field}\` ${opSym} ${value} → next step: **${e.targetName}**${e.label ? ` (${e.label})` : ''}`);
      } else {
        parts.push(`- Default → next step: **${e.targetName}**${e.label ? ` (${e.label})` : ''}`);
      }
    }
  }
  parts.push('');

  const prevKeys = Object.keys(input.previousOutputs);
  if (prevKeys.length > 0) {
    parts.push(`**Previous step outputs** (read-only context):`);
    for (const k of prevKeys) {
      parts.push(`- ${k}: ${JSON.stringify(input.previousOutputs[k])}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

function opSymbol(op: string): string {
  switch (op) {
    case 'eq': return '==';
    case 'neq': return '!=';
    case 'in': return 'in';
    case 'gt': return '>';
    case 'lt': return '<';
    case 'contains': return 'contains';
    default: return op;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/server test -- --run compose-workflow-context`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/application/utils/compose-workflow-context.ts packages/server/tests/unit/compose-workflow-context.test.ts
git commit -m "feat(server): composeWorkflowContextPrompt for workflow-aware agents"
```

---

### Task B.5: `StepExecutor` interface + `StepExecutionInput`

**Files:**
- Create: `packages/server/src/application/services/step-executors/types.ts`

- [ ] **Step 1: Write the interface**

Write `packages/server/src/application/services/step-executors/types.ts`:

```ts
import type { WorkflowStep, StepOutput, WorkflowEdgeCondition } from '@fleex/shared';

export interface StepExecutionInput {
  ticketId: string;
  workflowRunId: string;
  stepRunId: string;
  step: WorkflowStep;
  workflowContext: {
    workflowName: string;
    stepName: string;
    outgoingEdges: {
      id: string;
      label?: string;
      condition?: WorkflowEdgeCondition;
      targetName: string;
    }[];
    previousOutputs: Record<string, Record<string, unknown>>;
  };
}

export interface StepExecutorResult {
  output: StepOutput;
  executionId?: string;
}

export interface StepExecutor {
  execute(input: StepExecutionInput): Promise<StepExecutorResult>;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run --cwd packages/server typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/application/services/step-executors/types.ts
git commit -m "feat(server): StepExecutor interface + StepExecutionInput types"
```

---

### Task B.6: `HumanGateStepExecutor`

**Files:**
- Create: `packages/server/src/application/services/step-executors/human-gate-step-executor.ts`
- Create: `packages/server/tests/unit/human-gate-step-executor.test.ts`

- [ ] **Step 1: Write the failing test**

Write `packages/server/tests/unit/human-gate-step-executor.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { HumanGateStepExecutor } from '../../src/application/services/step-executors/human-gate-step-executor.js';

const makeInput = (overrides: Partial<{ outcomes: string[] }> = {}) => ({
  ticketId: 't-1', workflowRunId: 'run-1', stepRunId: 'sr-1',
  step: {
    id: 'gate', name: 'Human Review', executorType: 'human_gate' as const,
    executorRef: '', position: { x: 0, y: 0 },
    humanGateOutcomes: overrides.outcomes ?? ['approve', 'reject'],
  },
  workflowContext: { workflowName: 'W', stepName: 'Human Review', outgoingEdges: [], previousOutputs: {} },
});

describe('HumanGateStepExecutor', () => {
  it('posts a comment and returns needs_review', async () => {
    const postComment = { execute: vi.fn().mockResolvedValue({ comment: { id: 'c-1' }, createdMentions: [] }) };
    const exec = new HumanGateStepExecutor(postComment as never);
    const r = await exec.execute(makeInput());
    expect(r.output.result).toBe('needs_review');
    expect((r.output.schemaFields as Record<string, unknown>).outcomes).toEqual(['approve', 'reject']);
    expect(postComment.execute).toHaveBeenCalledOnce();
  });

  it('throws if humanGateOutcomes is empty', async () => {
    const postComment = { execute: vi.fn() };
    const exec = new HumanGateStepExecutor(postComment as never);
    await expect(exec.execute(makeInput({ outcomes: [] }))).rejects.toThrow(/at least one outcome/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/server test -- --run human-gate-step-executor`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Write `packages/server/src/application/services/step-executors/human-gate-step-executor.ts`:

```ts
import type { PostCommentUseCase } from '../../use-cases/post-comment.js';
import type { StepExecutor, StepExecutionInput, StepExecutorResult } from './types.js';

export class HumanGateStepExecutor implements StepExecutor {
  constructor(private readonly postComment: PostCommentUseCase) {}

  async execute(input: StepExecutionInput): Promise<StepExecutorResult> {
    const outcomes = input.step.humanGateOutcomes ?? [];
    if (outcomes.length === 0) {
      throw new Error(`human_gate step ${input.step.id}: must have at least one outcome`);
    }

    const body = [
      `🚪 **Human Gate** — workflow "${input.workflowContext.workflowName}" is awaiting your decision on step **${input.step.name}**.`,
      ``,
      `Available outcomes: ${outcomes.map((o) => `\`${o}\``).join(' · ')}`,
      ``,
      `_Resolve this gate from the Workflow tab on this ticket._`,
    ].join('\n');

    await this.postComment.execute({
      ticketId: input.ticketId,
      body,
      authorName: 'workflow',
      authorType: 'agent',
      humanMentionNames: [],
    });

    return {
      output: {
        schemaFields: { outcomes },
        result: 'needs_review',
      },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/server test -- --run human-gate-step-executor`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/application/services/step-executors/human-gate-step-executor.ts packages/server/tests/unit/human-gate-step-executor.test.ts
git commit -m "feat(server): HumanGateStepExecutor — posts comment, returns needs_review"
```

---

### Task B.7: `AgentStepExecutor`

**Files:**
- Create: `packages/server/src/application/services/step-executors/agent-step-executor.ts`
- Create: `packages/server/tests/unit/agent-step-executor.test.ts`
- Modify: `packages/server/src/application/use-cases/execute-agent.ts` (add `executeForWorkflowStep` method)

This task **requires extending `ExecuteAgentUseCase`** with a new entry point. The new method takes `(personaName, ticketId, opts)` where opts include `outputFormat` (merged schema) and `workflowContext` (injected into user prompt). It returns the parsed structured output AND the executionId.

- [ ] **Step 1: Add `executeForWorkflowStep` to ExecuteAgentUseCase**

Add a new method to `packages/server/src/application/use-cases/execute-agent.ts` (after `executeForSkill`, before `composeSkillUserPrompt`):

```ts
/**
 * Execute an agent as part of a workflow step.
 * Unlike `execute()` this does not consume a pending mention — the workflow
 * orchestrator drives execution and persists output to step_runs.
 *
 * Returns the parsed structured output (with custom schema fields merged at
 * top-level) and the executionId for audit linking.
 */
async executeForWorkflowStep(params: {
  personaName: string;
  ticketId: string;
  outputFormat: typeof OUTPUT_FORMAT_SCHEMA;
  workflowContextPrompt: string;
  mode: MentionExecutionMode;
}): Promise<{
  structuredOutput: Record<string, unknown> | null;
  rawText: string;
  executionId: string;
}> {
  const persona = await this.personaStore.getByName(params.personaName);
  if (!persona) throw new AgentPersonaNotFoundError(params.personaName);

  const executionId = randomUUID();
  const abortController = new AbortController();
  const humanName = this.resolveHumanMentionName(persona);

  // Effective mode: respect persona ceiling
  const effectiveMode: MentionExecutionMode = persona.executionMode === 'message' ? 'talk' : params.mode;

  // Worktree if needed (same as executeForMention)
  let worktreePath: string | null = null;
  if (effectiveMode !== 'talk') {
    worktreePath = await this.ensureWorktree(params.ticketId);
  }

  // Start tracking
  await this.agentEventStore.startExecution({
    executionId, personaId: persona.id, ticketId: params.ticketId, mentionId: `workflow:${executionId}`,
  });

  // Compose prompts
  const systemPrompt = this.composeSystemPrompt(persona, humanName, worktreePath);
  const context = await this.getTicketContext.execute({ ticketId: params.ticketId, agentName: persona.name });
  const userPromptBlocks = await this.composeWorkflowUserPrompt(context, params.workflowContextPrompt);
  const userPromptText = userPromptBlocks.map((b) => b.type === 'text' ? b.text : '').join('');

  let sequence = 0;
  const emitEvent = async (eventType: AgentEventType, data: unknown) => {
    const event = AgentEventEntity.create({ executionId, eventType, data, sequence: sequence++ });
    await this.agentEventStore.appendEvent(event);
    this.onEvent?.(event);
  };

  await emitEvent('execution_start', {
    executionId, personaId: persona.id, personaName: persona.name, ticketId: params.ticketId,
    model: persona.model, effectiveMode, worktreePath,
    context: {
      systemPromptSections: ['workflow_step'],
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPromptText.length,
    },
  });

  // SDK query
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const queryOptions = buildSdkOptions(effectiveMode, {
    model: persona.model, systemPrompt, cwd: worktreePath,
    outputFormat: params.outputFormat,
  });

  let sdkSessionId: string | undefined;
  let resultText = '';
  let structuredOutput: Record<string, unknown> | null = null;
  const hasImages = userPromptBlocks.some((b) => b.type === 'image');
  const promptArg = hasImages
    ? (async function* () { yield { type: 'user' as const, message: { role: 'user' as const, content: userPromptBlocks }, parent_tool_use_id: null, session_id: '' }; })()
    : userPromptText;

  for await (const message of query({ prompt: promptArg, options: queryOptions as Parameters<typeof query>[0]['options'] })) {
    if (abortController.signal.aborted) break;
    const msg = message as Record<string, unknown>;
    if (msg['type'] === 'system' && msg['subtype'] === 'init' && msg['session_id']) {
      sdkSessionId = msg['session_id'] as string;
      await emitEvent('turn_start', { sessionId: sdkSessionId });
    }
    if ('result' in message) {
      resultText = (message as { result: string }).result;
      if (msg['structured_output']) {
        structuredOutput = msg['structured_output'] as Record<string, unknown>;
      }
      await emitEvent('message_stop', { result: resultText, subtype: msg['subtype'] as string | undefined });
    } else {
      await emitEvent('content_block_delta', msg);
    }
  }

  await emitEvent('execution_end', { status: 'completed', ticketId: params.ticketId, resultLength: resultText.length });
  await this.agentEventStore.completeExecution(executionId, 'completed');

  return { structuredOutput, rawText: resultText, executionId };
}

private async composeWorkflowUserPrompt(
  context: Awaited<ReturnType<GetTicketContextUseCase['execute']>>,
  workflowContextPrompt: string,
): Promise<PromptContentBlock[]> {
  const blocks: PromptContentBlock[] = [];
  const pushText = (text: string) => blocks.push({ type: 'text', text });

  pushText(`# Ticket: ${context.ticket.title}\nStatus: ${context.ticket.status} | Priority: ${context.ticket.priority}`);
  if (context.ticket.description) {
    blocks.push(...await this.resolveText(`\n## Description\n\n${context.ticket.description}`));
  }
  if (context.comments.length > 0) {
    pushText('\n## Comments\n');
    for (const c of context.comments) {
      blocks.push(...await this.resolveText(`**${c.authorName}** (${c.authorType}):\n${c.body}\n`));
    }
  }
  if (context.deliverables.length > 0) {
    pushText('\n## Deliverables\n');
    for (const d of context.deliverables) {
      pushText(`### [${d.status}] ${d.title} (${d.type})\n${d.content ?? ''}\n`);
    }
  }
  pushText('\n---\n\n' + workflowContextPrompt);
  return blocks;
}
```

- [ ] **Step 2: Write the AgentStepExecutor test**

Write `packages/server/tests/unit/agent-step-executor.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { AgentStepExecutor } from '../../src/application/services/step-executors/agent-step-executor.js';

describe('AgentStepExecutor', () => {
  it('calls executeForWorkflowStep and maps result to StepOutput', async () => {
    const executeAgent = {
      executeForWorkflowStep: vi.fn().mockResolvedValue({
        structuredOutput: { deliverable: null, comment: 'Triaged', path: 'standard', priority: 'high' },
        rawText: '',
        executionId: 'exec-1',
      }),
    };
    const exec = new AgentStepExecutor(executeAgent as never);
    const r = await exec.execute({
      ticketId: 't-1', workflowRunId: 'r-1', stepRunId: 'sr-1',
      step: { id: 's1', name: 'Triage', executorType: 'agent', executorRef: 'the-sentinel', mode: 'plan',
              outputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
              position: { x: 0, y: 0 } },
      workflowContext: { workflowName: 'W', stepName: 'Triage', outgoingEdges: [], previousOutputs: {} },
    });
    expect(r.executionId).toBe('exec-1');
    expect(r.output.comment).toBe('Triaged');
    expect(r.output.schemaFields.path).toBe('standard');
    expect(r.output.schemaFields.priority).toBe('high');
    expect(r.output.result).toBe('ok');
  });

  it('marks result=needs_review when mentionStatus=waiting_for_info', async () => {
    const executeAgent = {
      executeForWorkflowStep: vi.fn().mockResolvedValue({
        structuredOutput: { deliverable: null, comment: 'I need clarification', mentionStatus: 'waiting_for_info' },
        rawText: '', executionId: 'exec-2',
      }),
    };
    const exec = new AgentStepExecutor(executeAgent as never);
    const r = await exec.execute({
      ticketId: 't-1', workflowRunId: 'r-1', stepRunId: 'sr-1',
      step: { id: 's1', name: 'X', executorType: 'agent', executorRef: 'p', position: { x: 0, y: 0 } },
      workflowContext: { workflowName: 'W', stepName: 'X', outgoingEdges: [], previousOutputs: {} },
    });
    expect(r.output.result).toBe('needs_review');
  });

  it('marks result=ko when SDK returns no structured output', async () => {
    const executeAgent = {
      executeForWorkflowStep: vi.fn().mockResolvedValue({
        structuredOutput: null, rawText: 'plain text fallback', executionId: 'exec-3',
      }),
    };
    const exec = new AgentStepExecutor(executeAgent as never);
    const r = await exec.execute({
      ticketId: 't-1', workflowRunId: 'r-1', stepRunId: 'sr-1',
      step: { id: 's1', name: 'X', executorType: 'agent', executorRef: 'p', position: { x: 0, y: 0 } },
      workflowContext: { workflowName: 'W', stepName: 'X', outgoingEdges: [], previousOutputs: {} },
    });
    expect(r.output.result).toBe('ko');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run --cwd packages/server test -- --run agent-step-executor`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the AgentStepExecutor**

Write `packages/server/src/application/services/step-executors/agent-step-executor.ts`:

```ts
import type { ExecuteAgentUseCase } from '../../use-cases/execute-agent.js';
import { mergeOutputSchemas, STANDARD_OUTPUT_SCHEMA } from '../../utils/merge-output-schemas.js';
import { composeWorkflowContextPrompt } from '../../utils/compose-workflow-context.js';
import type { StepExecutor, StepExecutionInput, StepExecutorResult } from './types.js';
import type { StepOutput, MentionExecutionMode } from '@fleex/shared';

const STANDARD_KEYS = new Set(['deliverable', 'comment', 'mentionStatus']);

export class AgentStepExecutor implements StepExecutor {
  constructor(private readonly executeAgent: ExecuteAgentUseCase) {}

  async execute(input: StepExecutionInput): Promise<StepExecutorResult> {
    const outputFormat = mergeOutputSchemas(STANDARD_OUTPUT_SCHEMA, input.step.outputSchema);
    const workflowContextPrompt = composeWorkflowContextPrompt({
      workflowName: input.workflowContext.workflowName,
      stepName: input.workflowContext.stepName,
      outputSchema: input.step.outputSchema,
      outgoingEdges: input.workflowContext.outgoingEdges,
      previousOutputs: input.workflowContext.previousOutputs,
    });

    const mode: MentionExecutionMode = input.step.mode ?? 'edit';

    const { structuredOutput, rawText, executionId } = await this.executeAgent.executeForWorkflowStep({
      personaName: input.step.executorRef,
      ticketId: input.ticketId,
      outputFormat,
      workflowContextPrompt,
      mode,
    });

    return { output: this.toStepOutput(structuredOutput, rawText), executionId };
  }

  private toStepOutput(so: Record<string, unknown> | null, _rawText: string): StepOutput {
    if (!so) {
      return { schemaFields: {}, result: 'ko' };
    }
    const schemaFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(so)) {
      if (!STANDARD_KEYS.has(k)) schemaFields[k] = v;
    }
    const mentionStatus = so['mentionStatus'] as 'resolved' | 'waiting_for_info' | undefined;
    const result = mentionStatus === 'waiting_for_info' ? 'needs_review' : 'ok';
    return {
      deliverable: (so['deliverable'] as StepOutput['deliverable']) ?? null,
      comment: (so['comment'] as string | null) ?? null,
      mentionStatus,
      schemaFields,
      result,
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run --cwd packages/server test -- --run agent-step-executor`
Expected: PASS — 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/application/services/step-executors/agent-step-executor.ts packages/server/src/application/use-cases/execute-agent.ts packages/server/tests/unit/agent-step-executor.test.ts
git commit -m "feat(server): AgentStepExecutor + executeForWorkflowStep entry on ExecuteAgentUseCase"
```

---

### Task B.8: `SkillStepExecutor`

**Files:**
- Create: `packages/server/src/application/services/step-executors/skill-step-executor.ts`
- Create: `packages/server/tests/unit/skill-step-executor.test.ts`
- Modify: `packages/server/src/application/use-cases/execute-agent.ts` (extend `executeForSkill` to accept `outputFormatOverride` + `workflowContextPrompt`)

- [ ] **Step 1: Extend `executeForSkill` signature**

In `packages/server/src/application/use-cases/execute-agent.ts`, modify the `executeForSkill` signature to add optional params:

```ts
async executeForSkill(skillId: string, ticketId: string, opts?: {
  commentBody?: string;
  mentionId?: string;
  outputFormatOverride?: typeof OUTPUT_FORMAT_SCHEMA;       // NEW
  workflowContextPrompt?: string;                            // NEW
  returnStructured?: boolean;                                // NEW — if true, return parsed output instead of side-effecting
}): Promise<{ structuredOutput: Record<string, unknown> | null; rawText: string; executionId: string } | void> {
```

In the body, when `opts?.outputFormatOverride` is provided, use it in `buildSdkOptions(... outputFormat: opts.outputFormatOverride ?? OUTPUT_FORMAT_SCHEMA ...)`.

When `opts?.workflowContextPrompt` is set, append it to the composed skill user prompt.

When `opts?.returnStructured === true`, skip the comment/deliverable post-effects and return `{ structuredOutput, rawText, executionId }` instead.

- [ ] **Step 2: Write the failing test**

Write `packages/server/tests/unit/skill-step-executor.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { SkillStepExecutor } from '../../src/application/services/step-executors/skill-step-executor.js';

describe('SkillStepExecutor', () => {
  it('resolves skill by commandName and maps result to StepOutput', async () => {
    const skillStore = {
      getByCommandName: vi.fn().mockResolvedValue({ id: 'sk-1', commandName: 'doc-writer' }),
    };
    const executeAgent = {
      executeForSkill: vi.fn().mockResolvedValue({
        structuredOutput: { deliverable: { title: 'Doc', markdown: '...', type: 'spec', status: 'final' }, comment: null },
        rawText: '', executionId: 'exec-1',
      }),
    };
    const exec = new SkillStepExecutor(executeAgent as never, skillStore as never);
    const r = await exec.execute({
      ticketId: 't-1', workflowRunId: 'r-1', stepRunId: 'sr-1',
      step: { id: 's1', name: 'Doc Update', executorType: 'skill', executorRef: 'doc-writer', position: { x: 0, y: 0 } },
      workflowContext: { workflowName: 'W', stepName: 'Doc Update', outgoingEdges: [], previousOutputs: {} },
    });
    expect(skillStore.getByCommandName).toHaveBeenCalledWith('doc-writer');
    expect(r.output.deliverable?.title).toBe('Doc');
    expect(r.output.result).toBe('ok');
  });

  it('throws when skill is not found', async () => {
    const skillStore = { getByCommandName: vi.fn().mockResolvedValue(null) };
    const exec = new SkillStepExecutor({} as never, skillStore as never);
    await expect(exec.execute({
      ticketId: 't-1', workflowRunId: 'r-1', stepRunId: 'sr-1',
      step: { id: 's1', name: 'X', executorType: 'skill', executorRef: 'missing', position: { x: 0, y: 0 } },
      workflowContext: { workflowName: 'W', stepName: 'X', outgoingEdges: [], previousOutputs: {} },
    })).rejects.toThrow(/skill .* not found/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run --cwd packages/server test -- --run skill-step-executor`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the executor**

Write `packages/server/src/application/services/step-executors/skill-step-executor.ts`:

```ts
import type { ExecuteAgentUseCase } from '../../use-cases/execute-agent.js';
import type { SkillStorePort } from '../../ports/skill-store.port.js';
import { mergeOutputSchemas, STANDARD_OUTPUT_SCHEMA } from '../../utils/merge-output-schemas.js';
import { composeWorkflowContextPrompt } from '../../utils/compose-workflow-context.js';
import type { StepExecutor, StepExecutionInput, StepExecutorResult } from './types.js';
import type { StepOutput } from '@fleex/shared';

const STANDARD_KEYS = new Set(['deliverable', 'comment', 'mentionStatus']);

export class SkillStepExecutor implements StepExecutor {
  constructor(
    private readonly executeAgent: ExecuteAgentUseCase,
    private readonly skillStore: SkillStorePort,
  ) {}

  async execute(input: StepExecutionInput): Promise<StepExecutorResult> {
    const skill = await this.skillStore.getByCommandName(input.step.executorRef);
    if (!skill) throw new Error(`skill "${input.step.executorRef}" not found`);

    const outputFormat = mergeOutputSchemas(STANDARD_OUTPUT_SCHEMA, input.step.outputSchema);
    const workflowContextPrompt = composeWorkflowContextPrompt({
      workflowName: input.workflowContext.workflowName,
      stepName: input.workflowContext.stepName,
      outputSchema: input.step.outputSchema,
      outgoingEdges: input.workflowContext.outgoingEdges,
      previousOutputs: input.workflowContext.previousOutputs,
    });

    const result = await this.executeAgent.executeForSkill(skill.id, input.ticketId, {
      outputFormatOverride: outputFormat,
      workflowContextPrompt,
      returnStructured: true,
    });

    if (!result || !('structuredOutput' in result)) {
      throw new Error('executeForSkill did not return structured output (returnStructured flag ignored?)');
    }

    return { output: this.toStepOutput(result.structuredOutput), executionId: result.executionId };
  }

  private toStepOutput(so: Record<string, unknown> | null): StepOutput {
    if (!so) return { schemaFields: {}, result: 'ko' };
    const schemaFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(so)) {
      if (!STANDARD_KEYS.has(k)) schemaFields[k] = v;
    }
    const mentionStatus = so['mentionStatus'] as 'resolved' | 'waiting_for_info' | undefined;
    return {
      deliverable: (so['deliverable'] as StepOutput['deliverable']) ?? null,
      comment: (so['comment'] as string | null) ?? null,
      mentionStatus,
      schemaFields,
      result: mentionStatus === 'waiting_for_info' ? 'needs_review' : 'ok',
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run --cwd packages/server test -- --run skill-step-executor`
Expected: PASS — 2 tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/application/services/step-executors/skill-step-executor.ts packages/server/tests/unit/skill-step-executor.test.ts packages/server/src/application/use-cases/execute-agent.ts
git commit -m "feat(server): SkillStepExecutor + extend executeForSkill with outputFormat/context overrides"
```

---

### Task B.9: `PanelStepExecutor`

**Files:**
- Create: `packages/server/src/application/services/step-executors/panel-step-executor.ts`
- Create: `packages/server/tests/unit/panel-step-executor.test.ts`
- Modify: `packages/server/src/application/use-cases/run-panel.ts` (add `extraContextPrompt` optional param + return structured aggregate)

This task assumes `RunPanelUseCase` has an `execute(params)` method with a `panelName` arg. The new optional `extraContextPrompt` parameter is appended to each agent in the panel's user prompt. The return value is extended to include the orchestrator's structured output for downstream consumption.

- [ ] **Step 1: Extend `RunPanelUseCase.execute`**

In `packages/server/src/application/use-cases/run-panel.ts`, find the `execute(params)` signature and add:

```ts
async execute(params: {
  panelName: string;
  ticketId: string;
  mentionId?: string;
  extraContextPrompt?: string;                                 // NEW
  outputFormatOverride?: typeof OUTPUT_FORMAT_SCHEMA;          // NEW
  returnStructured?: boolean;                                  // NEW
}): Promise<{ structuredOutput: Record<string, unknown> | null; executionId: string } | void> {
```

When `extraContextPrompt` is set, prepend it to the orchestrator's user prompt.
When `outputFormatOverride` is set, use it for the orchestrator's SDK call.
When `returnStructured`, return the orchestrator's parsed output + executionId.

- [ ] **Step 2: Write the failing test**

Write `packages/server/tests/unit/panel-step-executor.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { PanelStepExecutor } from '../../src/application/services/step-executors/panel-step-executor.js';

describe('PanelStepExecutor', () => {
  it('calls runPanel with extra context + structured return', async () => {
    const runPanel = {
      execute: vi.fn().mockResolvedValue({
        structuredOutput: { deliverable: { title: 'Spec', markdown: '...', type: 'spec', status: 'final' }, comment: 'Approved by panel' },
        executionId: 'exec-1',
      }),
    };
    const exec = new PanelStepExecutor(runPanel as never);
    const r = await exec.execute({
      ticketId: 't-1', workflowRunId: 'r-1', stepRunId: 'sr-1',
      step: { id: 's1', name: 'Spec Panel', executorType: 'panel', executorRef: 'les-big-tech', position: { x: 0, y: 0 } },
      workflowContext: { workflowName: 'W', stepName: 'Spec Panel', outgoingEdges: [], previousOutputs: {} },
    });
    expect(runPanel.execute).toHaveBeenCalledWith(expect.objectContaining({
      panelName: 'les-big-tech', ticketId: 't-1', returnStructured: true,
    }));
    expect(r.output.deliverable?.title).toBe('Spec');
    expect(r.output.result).toBe('ok');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run --cwd packages/server test -- --run panel-step-executor`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the executor**

Write `packages/server/src/application/services/step-executors/panel-step-executor.ts`:

```ts
import type { RunPanelUseCase } from '../../use-cases/run-panel.js';
import { mergeOutputSchemas, STANDARD_OUTPUT_SCHEMA } from '../../utils/merge-output-schemas.js';
import { composeWorkflowContextPrompt } from '../../utils/compose-workflow-context.js';
import type { StepExecutor, StepExecutionInput, StepExecutorResult } from './types.js';
import type { StepOutput } from '@fleex/shared';

const STANDARD_KEYS = new Set(['deliverable', 'comment', 'mentionStatus']);

export class PanelStepExecutor implements StepExecutor {
  constructor(private readonly runPanel: RunPanelUseCase) {}

  async execute(input: StepExecutionInput): Promise<StepExecutorResult> {
    const outputFormat = mergeOutputSchemas(STANDARD_OUTPUT_SCHEMA, input.step.outputSchema);
    const ctxPrompt = composeWorkflowContextPrompt({
      workflowName: input.workflowContext.workflowName,
      stepName: input.workflowContext.stepName,
      outputSchema: input.step.outputSchema,
      outgoingEdges: input.workflowContext.outgoingEdges,
      previousOutputs: input.workflowContext.previousOutputs,
    });

    const result = await this.runPanel.execute({
      panelName: input.step.executorRef,
      ticketId: input.ticketId,
      extraContextPrompt: ctxPrompt,
      outputFormatOverride: outputFormat,
      returnStructured: true,
    });

    if (!result || !('structuredOutput' in result)) {
      throw new Error('runPanel did not return structured output (returnStructured flag ignored?)');
    }

    return { output: this.toStepOutput(result.structuredOutput), executionId: result.executionId };
  }

  private toStepOutput(so: Record<string, unknown> | null): StepOutput {
    if (!so) return { schemaFields: {}, result: 'ko' };
    const schemaFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(so)) {
      if (!STANDARD_KEYS.has(k)) schemaFields[k] = v;
    }
    return {
      deliverable: (so['deliverable'] as StepOutput['deliverable']) ?? null,
      comment: (so['comment'] as string | null) ?? null,
      schemaFields,
      result: 'ok',
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run --cwd packages/server test -- --run panel-step-executor`
Expected: PASS — 1 test green.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/application/services/step-executors/panel-step-executor.ts packages/server/tests/unit/panel-step-executor.test.ts packages/server/src/application/use-cases/run-panel.ts
git commit -m "feat(server): PanelStepExecutor + extend RunPanelUseCase with extra context / output override"
```

---

### Task B.10: `CreateWorkflowRunUseCase`

**Files:**
- Create: `packages/server/src/application/use-cases/create-workflow-run.ts`
- Create: `packages/server/tests/unit/create-workflow-run.test.ts`
- Create: `packages/server/src/domain/errors.ts` (add `WorkflowRunAlreadyActiveError`)

- [ ] **Step 1: Add the new error class**

Find `packages/server/src/domain/errors.ts` and add at the bottom:

```ts
export class WorkflowRunAlreadyActiveError extends Error {
  constructor(ticketId: string) {
    super(`A workflow run is already active on ticket ${ticketId}`);
    this.name = 'WorkflowRunAlreadyActiveError';
  }
}

export class WorkflowTemplateNotFoundError extends Error {
  constructor(slugOrId: string) {
    super(`Workflow template not found: ${slugOrId}`);
    this.name = 'WorkflowTemplateNotFoundError';
  }
}

export class WorkflowRunNotFoundError extends Error {
  constructor(id: string) {
    super(`Workflow run not found: ${id}`);
    this.name = 'WorkflowRunNotFoundError';
  }
}

export class StepRunNotFoundError extends Error {
  constructor(id: string) {
    super(`Step run not found: ${id}`);
    this.name = 'StepRunNotFoundError';
  }
}

export class InvalidGateOutcomeError extends Error {
  constructor(outcome: string, allowed: string[]) {
    super(`Invalid gate outcome "${outcome}". Allowed: ${allowed.join(', ')}`);
    this.name = 'InvalidGateOutcomeError';
  }
}
```

- [ ] **Step 2: Write the failing test**

Write `packages/server/tests/unit/create-workflow-run.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { CreateWorkflowRunUseCase } from '../../src/application/use-cases/create-workflow-run.js';
import { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { WorkflowRunAlreadyActiveError, WorkflowTemplateNotFoundError } from '../../src/domain/errors.js';

const template = WorkflowTemplateEntity.create({
  id: 'tmpl-1', name: 'X', slug: 'x',
  steps: [{ id: 'triage', name: 'Triage', executorType: 'agent', executorRef: 'p', position: { x: 0, y: 0 } }],
  edges: [], entryStepId: 'triage',
});

describe('CreateWorkflowRunUseCase', () => {
  it('creates a run from a template by id and enqueues first step', async () => {
    const templateStore = { getById: vi.fn().mockResolvedValue(template) };
    const runStore = { getActiveByTicket: vi.fn().mockResolvedValue(null), save: vi.fn() };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };
    const uc = new CreateWorkflowRunUseCase(templateStore as never, runStore as never, orchestrator as never, eventBus as never);

    const run = await uc.execute({ ticketId: 't-1', templateId: 'tmpl-1', triggeredBy: '@john', triggeredFrom: 'comment:c-1' });

    expect(run).toBeInstanceOf(WorkflowRunEntity);
    expect(run.status).toBe('running');
    expect(run.currentStepId).toBe('triage');
    expect(runStore.save).toHaveBeenCalledOnce();
    expect(orchestrator.runStep).toHaveBeenCalledWith(run.id, 'triage');
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.run_created' }));
  });

  it('throws WorkflowRunAlreadyActiveError if a run is active', async () => {
    const templateStore = { getById: vi.fn().mockResolvedValue(template) };
    const runStore = { getActiveByTicket: vi.fn().mockResolvedValue({ id: 'existing' }), save: vi.fn() };
    const uc = new CreateWorkflowRunUseCase(templateStore as never, runStore as never, { runStep: vi.fn() } as never, { emit: vi.fn() } as never);

    await expect(uc.execute({ ticketId: 't-1', templateId: 'tmpl-1', triggeredBy: '@john', triggeredFrom: 'x' }))
      .rejects.toBeInstanceOf(WorkflowRunAlreadyActiveError);
  });

  it('throws WorkflowTemplateNotFoundError if template missing', async () => {
    const templateStore = { getById: vi.fn().mockResolvedValue(null) };
    const runStore = { getActiveByTicket: vi.fn().mockResolvedValue(null), save: vi.fn() };
    const uc = new CreateWorkflowRunUseCase(templateStore as never, runStore as never, { runStep: vi.fn() } as never, { emit: vi.fn() } as never);

    await expect(uc.execute({ ticketId: 't-1', templateId: 'missing', triggeredBy: '@john', triggeredFrom: 'x' }))
      .rejects.toBeInstanceOf(WorkflowTemplateNotFoundError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run --cwd packages/server test -- --run create-workflow-run`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the use case**

Write `packages/server/src/application/use-cases/create-workflow-run.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import { WorkflowRunAlreadyActiveError, WorkflowTemplateNotFoundError } from '../../domain/errors.js';
import type { WorkflowTemplateStorePort } from '../ports/workflow-template-store.port.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { EventBus } from '../event-bus.js';

export interface OrchestratorPort {
  runStep(workflowRunId: string, stepId: string): void;
}

export class CreateWorkflowRunUseCase {
  constructor(
    private readonly templateStore: WorkflowTemplateStorePort,
    private readonly runStore: WorkflowRunStorePort,
    private readonly orchestrator: OrchestratorPort,
    private readonly eventBus: EventBus,
  ) {}

  async execute(params: {
    ticketId: string;
    templateId: string;
    triggeredBy: string;
    triggeredFrom: string;
  }): Promise<WorkflowRunEntity> {
    const existing = await this.runStore.getActiveByTicket(params.ticketId);
    if (existing) throw new WorkflowRunAlreadyActiveError(params.ticketId);

    const template = await this.templateStore.getById(params.templateId);
    if (!template) throw new WorkflowTemplateNotFoundError(params.templateId);

    const run = WorkflowRunEntity.create({
      id: randomUUID(),
      ticketId: params.ticketId,
      templateId: template.id,
      templateSnapshot: {
        name: template.name,
        emoji: template.emoji,
        steps: template.steps,
        edges: template.edges,
        entryStepId: template.entryStepId,
      },
      triggeredBy: params.triggeredBy,
      triggeredFrom: params.triggeredFrom,
    });

    await this.runStore.save(run);
    this.eventBus.emit({
      type: 'workflow.run_created',
      workflowRunId: run.id,
      ticketId: run.ticketId,
      templateId: run.templateId,
      occurredAt: new Date(),
    });

    this.orchestrator.runStep(run.id, run.currentStepId!);
    return run;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run --cwd packages/server test -- --run create-workflow-run`
Expected: PASS — 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/application/use-cases/create-workflow-run.ts packages/server/tests/unit/create-workflow-run.test.ts packages/server/src/domain/errors.ts
git commit -m "feat(server): CreateWorkflowRunUseCase + domain errors"
```

---

### Task B.11: `RunWorkflowStepUseCase`

**Files:**
- Create: `packages/server/src/application/use-cases/run-workflow-step.ts`
- Create: `packages/server/tests/unit/run-workflow-step.test.ts`

- [ ] **Step 1: Write the failing test**

Write `packages/server/tests/unit/run-workflow-step.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { RunWorkflowStepUseCase } from '../../src/application/use-cases/run-workflow-step.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';

const makeRun = () => WorkflowRunEntity.create({
  id: 'run-1', ticketId: 't-1', templateId: 'tmpl-1',
  templateSnapshot: {
    name: 'W', emoji: '🔧',
    steps: [
      { id: 'a', name: 'A', executorType: 'agent', executorRef: 'p1', position: { x: 0, y: 0 } },
      { id: 'b', name: 'B', executorType: 'agent', executorRef: 'p2', position: { x: 200, y: 0 } },
    ],
    edges: [{ id: 'e1', source: 'a', target: 'b', isDefault: true }],
    entryStepId: 'a',
  },
  triggeredBy: '@john', triggeredFrom: 'x',
});

describe('RunWorkflowStepUseCase', () => {
  it('executes step, persists step_run with output, advances to next step', async () => {
    const run = makeRun();
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { save: vi.fn() };
    const agentExecutor = { execute: vi.fn().mockResolvedValue({
      output: { schemaFields: {}, result: 'ok' }, executionId: 'exec-1',
    }) };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };

    const uc = new RunWorkflowStepUseCase({
      runStore: runStore as never,
      stepRunStore: stepRunStore as never,
      orchestrator: orchestrator as never,
      eventBus: eventBus as never,
      executors: {
        agent: agentExecutor as never,
        skill: { execute: vi.fn() } as never,
        panel: { execute: vi.fn() } as never,
        human_gate: { execute: vi.fn() } as never,
      },
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(agentExecutor.execute).toHaveBeenCalledOnce();
    expect(stepRunStore.save).toHaveBeenCalled();
    expect(run.currentStepId).toBe('b');
    expect(orchestrator.runStep).toHaveBeenCalledWith('run-1', 'b');
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.step_started' }));
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.step_completed' }));
  });

  it('completes the run when no outgoing edges match', async () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', templateId: 'tmpl-1',
      templateSnapshot: { name: 'W', emoji: '', steps: [{ id: 'final', name: 'F', executorType: 'agent', executorRef: 'p', position: { x: 0, y: 0 } }], edges: [], entryStepId: 'final' },
      triggeredBy: '@john', triggeredFrom: 'x',
    });
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { save: vi.fn() };
    const agentExecutor = { execute: vi.fn().mockResolvedValue({ output: { schemaFields: {}, result: 'ok' }, executionId: 'e' }) };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };

    const uc = new RunWorkflowStepUseCase({
      runStore: runStore as never, stepRunStore: stepRunStore as never,
      orchestrator: orchestrator as never, eventBus: eventBus as never,
      executors: { agent: agentExecutor as never, skill: {} as never, panel: {} as never, human_gate: {} as never },
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'final' });

    expect(run.status).toBe('completed');
    expect(orchestrator.runStep).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.run_completed' }));
  });

  it('marks run needs_review when step returns result=needs_review', async () => {
    const run = makeRun();
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { save: vi.fn() };
    const humanGate = { execute: vi.fn().mockResolvedValue({ output: { schemaFields: { outcomes: ['approve'] }, result: 'needs_review' } }) };
    run.templateSnapshot.steps[0]!.executorType = 'human_gate';
    run.templateSnapshot.steps[0]!.humanGateOutcomes = ['approve'];

    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };

    const uc = new RunWorkflowStepUseCase({
      runStore: runStore as never, stepRunStore: stepRunStore as never,
      orchestrator: orchestrator as never, eventBus: eventBus as never,
      executors: { agent: {} as never, skill: {} as never, panel: {} as never, human_gate: humanGate as never },
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(run.status).toBe('needs_review');
    expect(orchestrator.runStep).not.toHaveBeenCalled();
  });

  it('fails the run when executor throws', async () => {
    const run = makeRun();
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { save: vi.fn() };
    const failing = { execute: vi.fn().mockRejectedValue(new Error('boom')) };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };

    const uc = new RunWorkflowStepUseCase({
      runStore: runStore as never, stepRunStore: stepRunStore as never,
      orchestrator: orchestrator as never, eventBus: eventBus as never,
      executors: { agent: failing as never, skill: {} as never, panel: {} as never, human_gate: {} as never },
    });

    await uc.execute({ workflowRunId: 'run-1', stepId: 'a' });

    expect(run.status).toBe('failed');
    expect(orchestrator.runStep).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'workflow.run_failed' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/server test -- --run run-workflow-step`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the use case**

Write `packages/server/src/application/use-cases/run-workflow-step.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { StepRunEntity } from '../../domain/entities/step-run.entity.js';
import { EdgeEvaluator } from '../services/edge-evaluator.js';
import { WorkflowRunNotFoundError } from '../../domain/errors.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../ports/step-run-store.port.js';
import type { StepExecutor, StepExecutionInput } from '../services/step-executors/types.js';
import type { OrchestratorPort } from './create-workflow-run.js';
import type { EventBus } from '../event-bus.js';
import type { WorkflowExecutorType } from '@fleex/shared';

export interface RunWorkflowStepDeps {
  runStore: WorkflowRunStorePort;
  stepRunStore: StepRunStorePort;
  orchestrator: OrchestratorPort;
  eventBus: EventBus;
  executors: Record<WorkflowExecutorType, StepExecutor>;
}

export class RunWorkflowStepUseCase {
  constructor(private readonly deps: RunWorkflowStepDeps) {}

  async execute(params: { workflowRunId: string; stepId: string }): Promise<void> {
    const run = await this.deps.runStore.getById(params.workflowRunId);
    if (!run) throw new WorkflowRunNotFoundError(params.workflowRunId);

    const step = run.findStep(params.stepId);
    if (!step) throw new Error(`step "${params.stepId}" not found in run snapshot`);

    // 1. Compute attempt number
    const latest = await this.deps.stepRunStore.getLatestForStep(run.id, step.id);
    const attempt = (latest?.attempt ?? 0) + 1;

    // 2. Create and start step_run
    const stepRun = StepRunEntity.create({ id: randomUUID(), workflowRunId: run.id, stepId: step.id, attempt });
    stepRun.start();
    await this.deps.stepRunStore.save(stepRun);
    this.deps.eventBus.emit({
      type: 'workflow.step_started', workflowRunId: run.id, stepRunId: stepRun.id, stepId: step.id,
      ticketId: run.ticketId, occurredAt: new Date(),
    });

    // 3. Build workflow context (previousOutputs from prior step_runs)
    const allStepRuns = await this.deps.stepRunStore.getByWorkflowRun(run.id);
    const previousOutputs: Record<string, Record<string, unknown>> = {};
    for (const sr of allStepRuns) {
      if (sr.id === stepRun.id) continue;
      if (sr.status === 'completed' && sr.output) {
        previousOutputs[sr.stepId] = (sr.output.schemaFields as Record<string, unknown>) ?? {};
      }
    }

    const outgoingEdges = run.outgoingEdges(step.id).map((e) => {
      const target = run.findStep(e.target);
      return {
        id: e.id, label: e.label, condition: e.condition,
        targetName: target?.name ?? e.target,
      };
    });

    const input: StepExecutionInput = {
      ticketId: run.ticketId, workflowRunId: run.id, stepRunId: stepRun.id, step,
      workflowContext: {
        workflowName: run.templateSnapshot.name, stepName: step.name,
        outgoingEdges, previousOutputs,
      },
    };

    // 4. Dispatch to executor
    let executionId: string | undefined;
    try {
      const executor = this.deps.executors[step.executorType];
      if (!executor) throw new Error(`No executor registered for type "${step.executorType}"`);
      const result = await executor.execute(input);
      executionId = result.executionId;

      // 5. Handle result
      if (result.output.result === 'needs_review') {
        stepRun.markNeedsReview({ output: result.output, executionId });
        run.block();
        await this.deps.stepRunStore.save(stepRun);
        await this.deps.runStore.save(run);
        this.deps.eventBus.emit({
          type: 'workflow.needs_review', workflowRunId: run.id, stepRunId: stepRun.id, stepId: step.id,
          ticketId: run.ticketId, occurredAt: new Date(),
        });
        return;
      }

      // 6. Resolve edges
      const edges = run.outgoingEdges(step.id);
      const nextEdge = EdgeEvaluator.resolve(result.output, edges);
      stepRun.complete({ output: result.output, nextEdgeId: nextEdge?.id ?? null, executionId });
      await this.deps.stepRunStore.save(stepRun);
      this.deps.eventBus.emit({
        type: 'workflow.step_completed', workflowRunId: run.id, stepRunId: stepRun.id, stepId: step.id,
        ticketId: run.ticketId, nextEdgeId: nextEdge?.id ?? null, occurredAt: new Date(),
      });

      // 7. Advance or complete
      if (nextEdge) {
        run.advanceTo(nextEdge.target);
        await this.deps.runStore.save(run);
        this.deps.orchestrator.runStep(run.id, nextEdge.target);
      } else {
        run.complete();
        await this.deps.runStore.save(run);
        this.deps.eventBus.emit({
          type: 'workflow.run_completed', workflowRunId: run.id, ticketId: run.ticketId, occurredAt: new Date(),
        });
      }
    } catch (err) {
      stepRun.fail({ message: err instanceof Error ? err.message : String(err) });
      run.fail();
      await this.deps.stepRunStore.save(stepRun);
      await this.deps.runStore.save(run);
      this.deps.eventBus.emit({
        type: 'workflow.run_failed', workflowRunId: run.id, stepRunId: stepRun.id, stepId: step.id,
        ticketId: run.ticketId, error: err instanceof Error ? err.message : String(err), occurredAt: new Date(),
      });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/server test -- --run run-workflow-step`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/application/use-cases/run-workflow-step.ts packages/server/tests/unit/run-workflow-step.test.ts
git commit -m "feat(server): RunWorkflowStepUseCase orchestrates step exec, edge resolution, advance/complete"
```

---

### Task B.12: `WorkflowOrchestrator` queue service

**Files:**
- Create: `packages/server/src/application/services/workflow-orchestrator.ts`

The orchestrator queues `runStep(runId, stepId)` calls and drains them sequentially. Wraps `RunWorkflowStepUseCase` so the rest of the codebase only depends on `OrchestratorPort.runStep`.

- [ ] **Step 1: Write the orchestrator**

Write `packages/server/src/application/services/workflow-orchestrator.ts`:

```ts
import type { RunWorkflowStepUseCase } from '../use-cases/run-workflow-step.js';
import type { OrchestratorPort } from '../use-cases/create-workflow-run.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class WorkflowOrchestrator implements OrchestratorPort {
  private queue: { runId: string; stepId: string }[] = [];
  private running = false;

  constructor(
    private readonly runStepUseCase: RunWorkflowStepUseCase,
    private readonly logger: LoggerPort,
  ) {}

  runStep(workflowRunId: string, stepId: string): void {
    this.queue.push({ runId: workflowRunId, stepId });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        try {
          await this.runStepUseCase.execute({ workflowRunId: item.runId, stepId: item.stepId });
        } catch (err) {
          this.logger.error('Workflow step execution crashed', {
            workflowRunId: item.runId, stepId: item.stepId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run --cwd packages/server typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/application/services/workflow-orchestrator.ts
git commit -m "feat(server): WorkflowOrchestrator queueing service"
```

---

### Task B.13: `ResolveHumanGateUseCase`

**Files:**
- Create: `packages/server/src/application/use-cases/resolve-human-gate.ts`
- Create: `packages/server/tests/unit/resolve-human-gate.test.ts`

- [ ] **Step 1: Write the failing test**

Write `packages/server/tests/unit/resolve-human-gate.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ResolveHumanGateUseCase } from '../../src/application/use-cases/resolve-human-gate.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';
import { InvalidGateOutcomeError, StepRunNotFoundError } from '../../src/domain/errors.js';

const makeRun = () => WorkflowRunEntity.create({
  id: 'run-1', ticketId: 't-1', templateId: 'tmpl-1',
  templateSnapshot: {
    name: 'W', emoji: '',
    steps: [
      { id: 'gate', name: 'Gate', executorType: 'human_gate', executorRef: '', humanGateOutcomes: ['approve','reject'], position: { x: 0, y: 0 } },
      { id: 'after', name: 'After', executorType: 'agent', executorRef: 'p', position: { x: 200, y: 0 } },
    ],
    edges: [{ id: 'e1', source: 'gate', target: 'after', condition: { field: 'outcome', operator: 'eq', value: 'approve' } }],
    entryStepId: 'gate',
  },
  triggeredBy: '@x', triggeredFrom: 'x',
});

describe('ResolveHumanGateUseCase', () => {
  it('writes outcome+notes, completes step_run, resumes orchestrator', async () => {
    const run = makeRun();
    run.block();
    const stepRun = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'gate' });
    stepRun.start();
    stepRun.markNeedsReview({ output: { schemaFields: { outcomes: ['approve','reject'] }, result: 'needs_review' } });

    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn() };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };
    const uc = new ResolveHumanGateUseCase(runStore as never, stepRunStore as never, orchestrator as never, eventBus as never);

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'approve', notes: 'LGTM' });

    expect(stepRun.status).toBe('completed');
    expect(stepRun.output?.schemaFields.outcome).toBe('approve');
    expect(stepRun.output?.schemaFields.notes).toBe('LGTM');
    expect(stepRun.nextEdgeId).toBe('e1');
    expect(run.currentStepId).toBe('after');
    expect(run.status).toBe('running');
    expect(orchestrator.runStep).toHaveBeenCalledWith('run-1', 'after');
  });

  it('rejects unknown outcome', async () => {
    const run = makeRun(); run.block();
    const stepRun = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'gate' });
    stepRun.markNeedsReview({ output: { schemaFields: { outcomes: ['approve','reject'] }, result: 'needs_review' } });
    const uc = new ResolveHumanGateUseCase(
      { getById: vi.fn().mockResolvedValue(run), save: vi.fn() } as never,
      { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn() } as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
    );
    await expect(uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'unknown' }))
      .rejects.toBeInstanceOf(InvalidGateOutcomeError);
  });

  it('completes the run when outcome matches no edge', async () => {
    const run = makeRun(); run.block();
    const stepRun = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'gate' });
    stepRun.markNeedsReview({ output: { schemaFields: { outcomes: ['approve','reject'] }, result: 'needs_review' } });
    const runStore = { getById: vi.fn().mockResolvedValue(run), save: vi.fn() };
    const stepRunStore = { getById: vi.fn().mockResolvedValue(stepRun), save: vi.fn() };
    const orchestrator = { runStep: vi.fn() };
    const eventBus = { emit: vi.fn() };
    const uc = new ResolveHumanGateUseCase(runStore as never, stepRunStore as never, orchestrator as never, eventBus as never);

    await uc.execute({ workflowRunId: 'run-1', stepRunId: 'sr-1', outcome: 'reject' });

    expect(run.status).toBe('completed');
    expect(orchestrator.runStep).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/server test -- --run resolve-human-gate`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the use case**

Write `packages/server/src/application/use-cases/resolve-human-gate.ts`:

```ts
import { EdgeEvaluator } from '../services/edge-evaluator.js';
import {
  WorkflowRunNotFoundError, StepRunNotFoundError, InvalidGateOutcomeError,
} from '../../domain/errors.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../ports/step-run-store.port.js';
import type { OrchestratorPort } from './create-workflow-run.js';
import type { EventBus } from '../event-bus.js';

export class ResolveHumanGateUseCase {
  constructor(
    private readonly runStore: WorkflowRunStorePort,
    private readonly stepRunStore: StepRunStorePort,
    private readonly orchestrator: OrchestratorPort,
    private readonly eventBus: EventBus,
  ) {}

  async execute(params: {
    workflowRunId: string;
    stepRunId: string;
    outcome: string;
    notes?: string;
  }): Promise<void> {
    const run = await this.runStore.getById(params.workflowRunId);
    if (!run) throw new WorkflowRunNotFoundError(params.workflowRunId);

    const stepRun = await this.stepRunStore.getById(params.stepRunId);
    if (!stepRun) throw new StepRunNotFoundError(params.stepRunId);

    const step = run.findStep(stepRun.stepId);
    if (!step || step.executorType !== 'human_gate') {
      throw new Error(`step "${stepRun.stepId}" is not a human_gate`);
    }

    const allowed = step.humanGateOutcomes ?? [];
    if (!allowed.includes(params.outcome)) {
      throw new InvalidGateOutcomeError(params.outcome, allowed);
    }

    stepRun.resolveGate(params.outcome, params.notes);

    const edges = run.outgoingEdges(step.id);
    const nextEdge = EdgeEvaluator.resolve(stepRun.output!, edges);
    stepRun.nextEdgeId = nextEdge?.id ?? null;
    await this.stepRunStore.save(stepRun);

    this.eventBus.emit({
      type: 'workflow.step_completed', workflowRunId: run.id, stepRunId: stepRun.id,
      stepId: step.id, ticketId: run.ticketId, nextEdgeId: nextEdge?.id ?? null, occurredAt: new Date(),
    });

    if (nextEdge) {
      run.advanceTo(nextEdge.target);
      await this.runStore.save(run);
      this.orchestrator.runStep(run.id, nextEdge.target);
    } else {
      run.complete();
      await this.runStore.save(run);
      this.eventBus.emit({
        type: 'workflow.run_completed', workflowRunId: run.id, ticketId: run.ticketId, occurredAt: new Date(),
      });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/server test -- --run resolve-human-gate`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/application/use-cases/resolve-human-gate.ts packages/server/tests/unit/resolve-human-gate.test.ts
git commit -m "feat(server): ResolveHumanGateUseCase advances after human decision"
```

---

### Task B.14: `RetryStepUseCase` + `CancelWorkflowRunUseCase`

**Files:**
- Create: `packages/server/src/application/use-cases/retry-step.ts`
- Create: `packages/server/src/application/use-cases/cancel-workflow-run.ts`

- [ ] **Step 1: Write `retry-step.ts`**

```ts
import { WorkflowRunNotFoundError, StepRunNotFoundError } from '../../domain/errors.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../ports/step-run-store.port.js';
import type { OrchestratorPort } from './create-workflow-run.js';

export class RetryStepUseCase {
  constructor(
    private readonly runStore: WorkflowRunStorePort,
    private readonly stepRunStore: StepRunStorePort,
    private readonly orchestrator: OrchestratorPort,
  ) {}

  async execute(params: { workflowRunId: string; stepRunId: string }): Promise<void> {
    const run = await this.runStore.getById(params.workflowRunId);
    if (!run) throw new WorkflowRunNotFoundError(params.workflowRunId);

    const stepRun = await this.stepRunStore.getById(params.stepRunId);
    if (!stepRun) throw new StepRunNotFoundError(params.stepRunId);

    // The orchestrator will create a new step_run with attempt+1
    run.advanceTo(stepRun.stepId);
    await this.runStore.save(run);
    this.orchestrator.runStep(run.id, stepRun.stepId);
  }
}
```

- [ ] **Step 2: Write `cancel-workflow-run.ts`**

```ts
import { WorkflowRunNotFoundError } from '../../domain/errors.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { EventBus } from '../event-bus.js';

export class CancelWorkflowRunUseCase {
  constructor(
    private readonly runStore: WorkflowRunStorePort,
    private readonly eventBus: EventBus,
  ) {}

  async execute(workflowRunId: string): Promise<void> {
    const run = await this.runStore.getById(workflowRunId);
    if (!run) throw new WorkflowRunNotFoundError(workflowRunId);
    if (!run.isActive()) return; // idempotent
    run.cancel();
    await this.runStore.save(run);
    this.eventBus.emit({
      type: 'workflow.run_cancelled',
      workflowRunId: run.id, ticketId: run.ticketId, occurredAt: new Date(),
    });
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run --cwd packages/server typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/application/use-cases/retry-step.ts packages/server/src/application/use-cases/cancel-workflow-run.ts
git commit -m "feat(server): RetryStepUseCase + CancelWorkflowRunUseCase"
```

---

### Task B.15: Wire Phase B into DI container + event bus types

**Files:**
- Modify: `packages/server/src/application/event-bus.ts` (add new event types)
- Modify: `packages/server/src/infrastructure/container.ts` (instantiate executors, orchestrator, use cases)

- [ ] **Step 1: Extend event bus types**

In `packages/server/src/application/event-bus.ts`, add to the union of domain events:

```ts
export type WorkflowRunCreatedEvent = {
  type: 'workflow.run_created';
  workflowRunId: string; ticketId: string; templateId: string; occurredAt: Date;
};

export type WorkflowStepStartedEvent = {
  type: 'workflow.step_started';
  workflowRunId: string; stepRunId: string; stepId: string; ticketId: string; occurredAt: Date;
};

export type WorkflowStepCompletedEvent = {
  type: 'workflow.step_completed';
  workflowRunId: string; stepRunId: string; stepId: string; ticketId: string;
  nextEdgeId: string | null; occurredAt: Date;
};

export type WorkflowNeedsReviewEvent = {
  type: 'workflow.needs_review';
  workflowRunId: string; stepRunId: string; stepId: string; ticketId: string; occurredAt: Date;
};

export type WorkflowRunCompletedEvent = {
  type: 'workflow.run_completed';
  workflowRunId: string; ticketId: string; occurredAt: Date;
};

export type WorkflowRunFailedEvent = {
  type: 'workflow.run_failed';
  workflowRunId: string; stepRunId: string; stepId: string; ticketId: string; error: string; occurredAt: Date;
};

export type WorkflowRunCancelledEvent = {
  type: 'workflow.run_cancelled';
  workflowRunId: string; ticketId: string; occurredAt: Date;
};
```

Add all to the `DomainEvent` union at the bottom of the file.

- [ ] **Step 2: Wire executors + orchestrator + use cases in the container**

In `packages/server/src/infrastructure/container.ts`, after the existing use case wiring, add:

```ts
import { AgentStepExecutor } from '../application/services/step-executors/agent-step-executor.js';
import { SkillStepExecutor } from '../application/services/step-executors/skill-step-executor.js';
import { PanelStepExecutor } from '../application/services/step-executors/panel-step-executor.js';
import { HumanGateStepExecutor } from '../application/services/step-executors/human-gate-step-executor.js';
import { WorkflowOrchestrator } from '../application/services/workflow-orchestrator.js';
import { RunWorkflowStepUseCase } from '../application/use-cases/run-workflow-step.js';
import { CreateWorkflowRunUseCase } from '../application/use-cases/create-workflow-run.js';
import { ResolveHumanGateUseCase } from '../application/use-cases/resolve-human-gate.js';
import { RetryStepUseCase } from '../application/use-cases/retry-step.js';
import { CancelWorkflowRunUseCase } from '../application/use-cases/cancel-workflow-run.js';

// ... after executeAgent and runPanel are constructed:

const executors = {
  agent: new AgentStepExecutor(executeAgent),
  skill: new SkillStepExecutor(executeAgent, skillStore),
  panel: new PanelStepExecutor(runPanel),
  human_gate: new HumanGateStepExecutor(postComment),
};

const runWorkflowStep = new RunWorkflowStepUseCase({
  runStore: workflowRunStore,
  stepRunStore,
  orchestrator: null as never,  // wired below
  eventBus,
  executors,
});

const workflowOrchestrator = new WorkflowOrchestrator(runWorkflowStep, logger);
// resolve circular ref
(runWorkflowStep as unknown as { deps: { orchestrator: WorkflowOrchestrator } }).deps.orchestrator = workflowOrchestrator;

const createWorkflowRun = new CreateWorkflowRunUseCase(workflowTemplateStore, workflowRunStore, workflowOrchestrator, eventBus);
const resolveHumanGate = new ResolveHumanGateUseCase(workflowRunStore, stepRunStore, workflowOrchestrator, eventBus);
const retryStep = new RetryStepUseCase(workflowRunStore, stepRunStore, workflowOrchestrator);
const cancelWorkflowRun = new CancelWorkflowRunUseCase(workflowRunStore, eventBus);
```

Add these to the exported container object.

- [ ] **Step 3: Start server, verify wiring**

Run: `fleex restart && fleex logs server | tail -50`
Expected: server starts cleanly, no DI errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/application/event-bus.ts packages/server/src/infrastructure/container.ts
git commit -m "feat(server): wire workflow orchestrator + use cases + event types into container"
```

---

_End of Phase B._

---

## Phase C — Trigger

### Task C.1: Workflow mention pattern in `ticket-comment.entity.ts`

**Files:**
- Modify: `packages/server/src/domain/entities/ticket-comment.entity.ts`
- Modify: `packages/server/tests/unit/ticket-comment.entity.test.ts` (or create if missing)

- [ ] **Step 1: Write the failing test**

If `packages/server/tests/unit/ticket-comment.entity.test.ts` exists, append; otherwise create it:

```ts
import { describe, it, expect } from 'vitest';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';

describe('TicketCommentEntity.extractWorkflowMentions', () => {
  it('extracts @workflow:slug mentions', () => {
    const out = TicketCommentEntity.extractWorkflowMentions('Hello @workflow:feature-delivery and @workflow:bug-fix');
    expect(out).toEqual(['feature-delivery', 'bug-fix']);
  });

  it('deduplicates', () => {
    expect(TicketCommentEntity.extractWorkflowMentions('@workflow:x @workflow:x')).toEqual(['x']);
  });

  it('skips struck-through mentions', () => {
    expect(TicketCommentEntity.extractWorkflowMentions('~~@workflow:cancelled~~ and @workflow:active')).toEqual(['active']);
  });

  it('does not match @workflow without colon', () => {
    expect(TicketCommentEntity.extractWorkflowMentions('plain @workflow text')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/server test -- --run ticket-comment.entity`
Expected: FAIL — `extractWorkflowMentions is not a function`.

- [ ] **Step 3: Add the pattern + extractor**

In `packages/server/src/domain/entities/ticket-comment.entity.ts`, after line 5 (SKILL_MENTION_PATTERN), add:

```ts
const WORKFLOW_MENTION_PATTERN = /@workflow:([a-zA-Z0-9_-]+)/g;
```

And after `extractSkillMentions` add:

```ts
static extractWorkflowMentions(body: string): string[] {
  const matches = new Set<string>();
  for (const match of body.matchAll(WORKFLOW_MENTION_PATTERN)) {
    const prefix = match.index! >= 2 ? body.substring(match.index! - 2, match.index!) : '';
    if (prefix === '~~') continue;
    matches.add(match[1]!);
  }
  return Array.from(matches);
}
```

Also update `extractHumanMentions` to skip `@workflow:` prefix collisions (line 91):

```ts
if (prefix.endsWith('agent:') || prefix.endsWith('panel:') || prefix.endsWith('skill:') || prefix.endsWith('orkflow:')) continue;
```

(Note: `orkflow:` is `workflow:` with the leading `w` already consumed by the `@` match — slice the last 7 chars but `workflow:` is 9 chars including `@` ; using `endsWith('orkflow:')` works because we slice `Math.max(0, match.index - 6)` to `match.index`. To be safe, increase the slice window to 9.)

Adjust the `prefix` lookup to use 9 chars instead of 6:

```ts
const prefix = body.substring(Math.max(0, match.index! - 9), match.index!);
if (prefix.endsWith('@agent:') || prefix.endsWith('@panel:') || prefix.endsWith('@skill:') || prefix.endsWith('@workflow:')) continue;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/server test -- --run ticket-comment.entity`
Expected: PASS — all 4 tests green, no regression on existing extractors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domain/entities/ticket-comment.entity.ts packages/server/tests/unit/ticket-comment.entity.test.ts
git commit -m "feat(server): @workflow:slug mention pattern in ticket-comment entity"
```

---

### Task C.2: Plumb `targetType='workflow'` through mention creation

**Files:**
- Modify: `packages/server/src/application/use-cases/post-comment.ts` (extract workflow mentions and create mentions with type='workflow')

- [ ] **Step 1: Locate the mention creation in PostCommentUseCase**

Run: `grep -n "extractSkillMentions\|extractAgentMentions\|extractPanelMentions" packages/server/src/application/use-cases/post-comment.ts`
Expected: find the block where each mention type is extracted and `TicketMentionEntity.create` is called.

- [ ] **Step 2: Add workflow extraction parallel to skill/panel/agent**

In the matched block, add the same pattern for workflows:

```ts
const workflowSlugs = TicketCommentEntity.extractWorkflowMentions(body);
for (const slug of workflowSlugs) {
  const m = TicketMentionEntity.create({
    id: randomUUID(),
    ticketId: params.ticketId,
    commentId: comment.id,
    targetAgent: slug,
    targetType: 'workflow',
    sourceAgent: params.authorName,
    executionMode: 'talk',
  });
  await this.mentionStore.save(m);
  createdMentions.push(m);
}
```

(Adjust to the exact pattern of the existing code — variable names, executionMode handling, etc.)

- [ ] **Step 3: Typecheck**

Run: `bun run --cwd packages/server typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/application/use-cases/post-comment.ts
git commit -m "feat(server): create workflow-typed mentions from @workflow:slug"
```

---

### Task C.3: `handleAutoTriggerWorkflow` in `domain-event-listener.ts`

**Files:**
- Modify: `packages/server/src/application/domain-event-listener.ts`

- [ ] **Step 1: Add the handler registration**

In `packages/server/src/application/domain-event-listener.ts`, near line 165 (after `handleAutoTriggerSkill` registration) add:

```ts
bus.on('mention.created', (e) => this.handleAutoTriggerWorkflow(e as MentionCreatedEvent));
```

- [ ] **Step 2: Add the handler method**

After `handleAutoTriggerSkill` (around line 264), add:

```ts
private async handleAutoTriggerWorkflow(event: MentionCreatedEvent): Promise<void> {
  if (event.targetType !== 'workflow') return;

  const template = await this.deps.workflowTemplateStore.getBySlug(event.targetAgent);
  if (!template || !template.enabled) {
    const mention = await this.deps.mentionStore.getById(event.mentionId);
    if (mention && mention.status !== 'resolved') {
      mention.resolve();
      await this.deps.mentionStore.save(mention);
    }
    return;
  }

  // Fire and forget
  this.deps.createWorkflowRun.execute({
    ticketId: event.ticketId,
    templateId: template.id,
    triggeredBy: event.sourceAgent,
    triggeredFrom: `comment:${(event as MentionCreatedEvent & { commentId?: string }).commentId ?? 'unknown'}`,
  }).then(async () => {
    const mention = await this.deps.mentionStore.getById(event.mentionId);
    if (mention && mention.status !== 'resolved') {
      mention.resolve();
      await this.deps.mentionStore.save(mention);
    }
  }).catch((err) => {
    this.deps.logger.error('Workflow auto-trigger failed', {
      slug: event.targetAgent, ticketId: event.ticketId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
```

- [ ] **Step 3: Add the new deps to the listener constructor**

Update the `deps` interface of `DomainEventListener` to include `workflowTemplateStore` and `createWorkflowRun`. Update the container wiring to pass them.

- [ ] **Step 4: Start server smoke test**

Run: `fleex restart`. Then in another shell post a comment with `@workflow:nonexistent` via the API or UI — verify the mention is resolved silently and no error in logs.

Run: `fleex logs server | tail -20`

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/application/domain-event-listener.ts packages/server/src/infrastructure/container.ts
git commit -m "feat(server): handleAutoTriggerWorkflow creates runs from @workflow: mentions"
```

---

### Task C.4: HTTP routes — `/api/workflows/templates`

**Files:**
- Create: `packages/server/src/infrastructure/http/workflow-template.routes.ts`
- Modify: `packages/server/src/infrastructure/http/index.ts` (register routes)

- [ ] **Step 1: Read existing routes pattern**

Run: `head -80 packages/server/src/infrastructure/http/skill.routes.ts`
Note the Fastify pattern: schema, handlers, error mapping.

- [ ] **Step 2: Write the routes**

Write `packages/server/src/infrastructure/http/workflow-template.routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { WorkflowTemplateEntity } from '../../domain/entities/workflow-template.entity.js';
import type { WorkflowTemplateStorePort } from '../../application/ports/workflow-template-store.port.js';

const stepSchema = z.object({
  id: z.string(),
  name: z.string(),
  executorType: z.enum(['agent', 'skill', 'panel', 'human_gate']),
  executorRef: z.string(),
  mode: z.enum(['talk', 'plan', 'edit']).optional(),
  outputSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.string(), z.object({
      type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
      enum: z.array(z.string()).optional(),
      description: z.string().optional(),
    })),
    required: z.array(z.string()).optional(),
  }).optional(),
  humanGateOutcomes: z.array(z.string()).optional(),
  position: z.object({ x: z.number(), y: z.number() }),
});

const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  isDefault: z.boolean(),
  condition: z.object({
    field: z.string(),
    operator: z.enum(['eq', 'neq', 'in', 'gt', 'lt', 'contains']),
    value: z.union([z.string(), z.array(z.string())]),
  }).optional(),
  label: z.string().optional(),
});

const templateBodySchema = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9_-]+$/),
  emoji: z.string().default(''),
  description: z.string().default(''),
  steps: z.array(stepSchema).min(1),
  edges: z.array(edgeSchema),
  entryStepId: z.string(),
  enabled: z.boolean().default(true),
});

export function registerWorkflowTemplateRoutes(app: FastifyInstance, deps: { templateStore: WorkflowTemplateStorePort }) {
  app.get('/api/workflows/templates', async () => {
    const templates = await deps.templateStore.getAll();
    return templates.map((t) => t.toDTO());
  });

  app.get('/api/workflows/templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await deps.templateStore.getById(id);
    if (!t) return reply.code(404).send({ error: 'not_found' });
    return t.toDTO();
  });

  app.post('/api/workflows/templates', async (req, reply) => {
    const parsed = templateBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });

    // Unique slug check
    const existing = await deps.templateStore.getBySlug(parsed.data.slug);
    if (existing) return reply.code(409).send({ error: 'slug_taken' });

    try {
      const t = WorkflowTemplateEntity.create({ id: randomUUID(), ...parsed.data });
      await deps.templateStore.save(t);
      return reply.code(201).send(t.toDTO());
    } catch (err) {
      return reply.code(400).send({ error: 'invalid_template', message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put('/api/workflows/templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = templateBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });

    const t = await deps.templateStore.getById(id);
    if (!t) return reply.code(404).send({ error: 'not_found' });

    // Slug uniqueness if changed
    if (parsed.data.slug !== t.slug) {
      const collision = await deps.templateStore.getBySlug(parsed.data.slug);
      if (collision) return reply.code(409).send({ error: 'slug_taken' });
    }

    try {
      t.update(parsed.data);
      await deps.templateStore.save(t);
      return t.toDTO();
    } catch (err) {
      return reply.code(400).send({ error: 'invalid_template', message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/workflows/templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await deps.templateStore.getById(id);
    if (!t) return reply.code(404).send({ error: 'not_found' });
    t.update({ enabled: false });
    await deps.templateStore.save(t);
    return reply.code(204).send();
  });
}
```

- [ ] **Step 3: Register the routes**

In `packages/server/src/infrastructure/http/index.ts` (or equivalent — check for where `registerSkillRoutes` is called), add:

```ts
import { registerWorkflowTemplateRoutes } from './workflow-template.routes.js';
// ...
registerWorkflowTemplateRoutes(app, { templateStore: container.workflowTemplateStore });
```

- [ ] **Step 4: Restart + smoke**

```bash
fleex restart
curl -s http://localhost:$(fleex status | awk '/gateway/ {print $3}' | head -1 | cut -d: -f3)/api/workflows/templates
```

Expected: `[]` (empty array).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/infrastructure/http/workflow-template.routes.ts packages/server/src/infrastructure/http/index.ts
git commit -m "feat(server): /api/workflows/templates CRUD"
```

---

### Task C.5: HTTP routes — `/api/workflows/runs`

**Files:**
- Create: `packages/server/src/infrastructure/http/workflow-run.routes.ts`
- Modify: `packages/server/src/infrastructure/http/index.ts` (register routes)

- [ ] **Step 1: Write the routes**

Write `packages/server/src/infrastructure/http/workflow-run.routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  WorkflowRunAlreadyActiveError, WorkflowTemplateNotFoundError,
  WorkflowRunNotFoundError, StepRunNotFoundError, InvalidGateOutcomeError,
} from '../../domain/errors.js';
import type { WorkflowRunStorePort } from '../../application/ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../../application/ports/step-run-store.port.js';
import type { CreateWorkflowRunUseCase } from '../../application/use-cases/create-workflow-run.js';
import type { ResolveHumanGateUseCase } from '../../application/use-cases/resolve-human-gate.js';
import type { RetryStepUseCase } from '../../application/use-cases/retry-step.js';
import type { CancelWorkflowRunUseCase } from '../../application/use-cases/cancel-workflow-run.js';

export function registerWorkflowRunRoutes(app: FastifyInstance, deps: {
  runStore: WorkflowRunStorePort;
  stepRunStore: StepRunStorePort;
  createWorkflowRun: CreateWorkflowRunUseCase;
  resolveHumanGate: ResolveHumanGateUseCase;
  retryStep: RetryStepUseCase;
  cancelWorkflowRun: CancelWorkflowRunUseCase;
  authorNameResolver: () => string;
}) {
  app.get('/api/workflows/runs', async (req) => {
    const q = (req.query ?? {}) as { ticketId?: string };
    if (!q.ticketId) return [];
    const runs = await deps.runStore.getByTicket(q.ticketId);
    return runs.map((r) => r.toDTO());
  });

  app.get('/api/workflows/runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await deps.runStore.getById(id);
    if (!run) return reply.code(404).send({ error: 'not_found' });
    const stepRuns = await deps.stepRunStore.getByWorkflowRun(id);
    return { run: run.toDTO(), stepRuns: stepRuns.map((s) => s.toDTO()) };
  });

  const createBody = z.object({
    ticketId: z.string(),
    templateId: z.string(),
    triggeredFrom: z.string().default('api'),
  });

  app.post('/api/workflows/runs', async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
    try {
      const run = await deps.createWorkflowRun.execute({
        ticketId: parsed.data.ticketId,
        templateId: parsed.data.templateId,
        triggeredBy: deps.authorNameResolver(),
        triggeredFrom: parsed.data.triggeredFrom,
      });
      return reply.code(201).send(run.toDTO());
    } catch (err) {
      if (err instanceof WorkflowRunAlreadyActiveError) return reply.code(409).send({ error: 'run_already_active' });
      if (err instanceof WorkflowTemplateNotFoundError) return reply.code(404).send({ error: 'template_not_found' });
      throw err;
    }
  });

  app.delete('/api/workflows/runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await deps.cancelWorkflowRun.execute(id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof WorkflowRunNotFoundError) return reply.code(404).send({ error: 'not_found' });
      throw err;
    }
  });

  const resolveBody = z.object({ outcome: z.string(), notes: z.string().optional() });

  app.post('/api/workflows/runs/:id/steps/:stepRunId/resolve', async (req, reply) => {
    const { id, stepRunId } = req.params as { id: string; stepRunId: string };
    const parsed = resolveBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    try {
      await deps.resolveHumanGate.execute({
        workflowRunId: id, stepRunId, outcome: parsed.data.outcome, notes: parsed.data.notes,
      });
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof StepRunNotFoundError) return reply.code(404).send({ error: 'step_run_not_found' });
      if (err instanceof WorkflowRunNotFoundError) return reply.code(404).send({ error: 'run_not_found' });
      if (err instanceof InvalidGateOutcomeError) return reply.code(400).send({ error: 'invalid_outcome', message: err.message });
      throw err;
    }
  });

  app.post('/api/workflows/runs/:id/steps/:stepRunId/retry', async (req, reply) => {
    const { id, stepRunId } = req.params as { id: string; stepRunId: string };
    try {
      await deps.retryStep.execute({ workflowRunId: id, stepRunId });
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof StepRunNotFoundError) return reply.code(404).send({ error: 'step_run_not_found' });
      if (err instanceof WorkflowRunNotFoundError) return reply.code(404).send({ error: 'run_not_found' });
      throw err;
    }
  });
}
```

- [ ] **Step 2: Register the routes**

Add to `packages/server/src/infrastructure/http/index.ts`:

```ts
import { registerWorkflowRunRoutes } from './workflow-run.routes.js';
// ...
registerWorkflowRunRoutes(app, {
  runStore: container.workflowRunStore,
  stepRunStore: container.stepRunStore,
  createWorkflowRun: container.createWorkflowRun,
  resolveHumanGate: container.resolveHumanGate,
  retryStep: container.retryStep,
  cancelWorkflowRun: container.cancelWorkflowRun,
  authorNameResolver: () => 'workflow-trigger', // TODO: replace with actual user resolution when auth lands
});
```

- [ ] **Step 3: Restart + smoke**

```bash
fleex restart
curl -s http://localhost:$PORT/api/workflows/runs?ticketId=missing
```

Expected: `[]`.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/infrastructure/http/workflow-run.routes.ts packages/server/src/infrastructure/http/index.ts
git commit -m "feat(server): /api/workflows/runs + resolve/retry/cancel endpoints"
```

---

### Task C.6: WebSocket broadcasts for workflow events

**Files:**
- Modify: `packages/server/src/infrastructure/ws/` (find the WS plugin that listens to event-bus events and broadcasts on the `tickets:{ticketId}` channel)

- [ ] **Step 1: Locate the WS event subscriber**

Run: `grep -rn "ticketBroadcast\|'tickets:'" packages/server/src/infrastructure/ws 2>/dev/null | head -10`
Expected: identify the file/handler that bridges domain events → WS messages.

- [ ] **Step 2: Add workflow event handlers**

In the matching file, add subscriptions:

```ts
bus.on('workflow.run_created', (e) => ticketBroadcast(e.ticketId, 'workflow:run_created', { workflowRunId: e.workflowRunId, templateId: e.templateId }));
bus.on('workflow.step_started', (e) => ticketBroadcast(e.ticketId, 'workflow:step_started', { workflowRunId: e.workflowRunId, stepRunId: e.stepRunId, stepId: e.stepId }));
bus.on('workflow.step_completed', (e) => ticketBroadcast(e.ticketId, 'workflow:step_completed', { workflowRunId: e.workflowRunId, stepRunId: e.stepRunId, stepId: e.stepId, nextEdgeId: e.nextEdgeId }));
bus.on('workflow.needs_review', (e) => ticketBroadcast(e.ticketId, 'workflow:needs_review', { workflowRunId: e.workflowRunId, stepRunId: e.stepRunId, stepId: e.stepId }));
bus.on('workflow.run_completed', (e) => ticketBroadcast(e.ticketId, 'workflow:run_completed', { workflowRunId: e.workflowRunId }));
bus.on('workflow.run_failed', (e) => ticketBroadcast(e.ticketId, 'workflow:run_failed', { workflowRunId: e.workflowRunId, error: e.error }));
bus.on('workflow.run_cancelled', (e) => ticketBroadcast(e.ticketId, 'workflow:run_cancelled', { workflowRunId: e.workflowRunId }));
```

- [ ] **Step 3: Restart + verify**

```bash
fleex restart
fleex logs server | grep -i "workflow:" | head -10
```

Expected: no errors. Manual e2e covered later.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/infrastructure/ws/
git commit -m "feat(server): broadcast workflow events on tickets WS channel"
```

---

_End of Phase C._

---

## Phase D — UI Runtime

### Task D.1: Install `@xyflow/react`

**Files:**
- Modify: `packages/web/package.json`

- [ ] **Step 1: Install the dependency**

```bash
cd packages/web && bun add @xyflow/react
```

- [ ] **Step 2: Verify install**

```bash
grep '"@xyflow/react"' packages/web/package.json
```

Expected: shows the new dependency.

- [ ] **Step 3: Commit**

```bash
git add packages/web/package.json packages/web/bun.lockb
git commit -m "feat(web): add @xyflow/react for workflow DAG rendering"
```

---

### Task D.2: `useWorkflowTemplateStore` (Zustand)

**Files:**
- Create: `packages/web/src/stores/workflowTemplateStore.ts`

- [ ] **Step 1: Read the existing skillStore pattern**

Run: `head -60 packages/web/src/stores/skillStore.ts`
Match style: API base URL, fetch helpers, optimistic updates, WS hooks.

- [ ] **Step 2: Write the store**

Write `packages/web/src/stores/workflowTemplateStore.ts`:

```ts
import { create } from 'zustand';
import type { WorkflowTemplate } from '@fleex/shared';
import { apiBase } from './api-base';

interface State {
  templates: WorkflowTemplate[];
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  create(input: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<WorkflowTemplate>;
  update(id: string, input: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<WorkflowTemplate>;
  remove(id: string): Promise<void>;
  getBySlug(slug: string): WorkflowTemplate | undefined;
}

export const useWorkflowTemplateStore = create<State>((set, get) => ({
  templates: [],
  loading: false,
  error: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${apiBase()}/api/workflows/templates`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const templates = (await res.json()) as WorkflowTemplate[];
      set({ templates, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  async create(input) {
    const res = await fetch(`${apiBase()}/api/workflows/templates`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const t = (await res.json()) as WorkflowTemplate;
    set((s) => ({ templates: [...s.templates, t] }));
    return t;
  },

  async update(id, input) {
    const res = await fetch(`${apiBase()}/api/workflows/templates/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const t = (await res.json()) as WorkflowTemplate;
    set((s) => ({ templates: s.templates.map((x) => x.id === id ? t : x) }));
    return t;
  },

  async remove(id) {
    const res = await fetch(`${apiBase()}/api/workflows/templates/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    set((s) => ({ templates: s.templates.filter((t) => t.id !== id) }));
  },

  getBySlug(slug) {
    return get().templates.find((t) => t.slug === slug);
  },
}));
```

(If `apiBase()` helper does not exist in `packages/web/src/stores/`, check skillStore for the analogous import — often a hook like `useApiBaseUrl()` or a constant.)

- [ ] **Step 3: Typecheck**

Run: `bun run --cwd packages/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/stores/workflowTemplateStore.ts
git commit -m "feat(web): useWorkflowTemplateStore (Zustand)"
```

---

### Task D.3: `useWorkflowRunStore` (Zustand)

**Files:**
- Create: `packages/web/src/stores/workflowRunStore.ts`

- [ ] **Step 1: Write the store**

Write `packages/web/src/stores/workflowRunStore.ts`:

```ts
import { create } from 'zustand';
import type { WorkflowRun, StepRun } from '@fleex/shared';
import { apiBase } from './api-base';

interface RunDetail {
  run: WorkflowRun;
  stepRuns: StepRun[];
}

interface State {
  runsByTicket: Record<string, WorkflowRun[]>;   // ticketId → runs (desc order by startedAt)
  detail: Record<string, RunDetail>;             // runId → full detail
  loading: boolean;
  error: string | null;

  loadForTicket(ticketId: string): Promise<void>;
  loadDetail(runId: string): Promise<void>;
  start(ticketId: string, templateId: string): Promise<WorkflowRun>;
  cancel(runId: string): Promise<void>;
  resolveGate(runId: string, stepRunId: string, outcome: string, notes?: string): Promise<void>;
  retry(runId: string, stepRunId: string): Promise<void>;

  activeByTicket(ticketId: string): WorkflowRun | undefined;
  historyByTicket(ticketId: string): WorkflowRun[];

  // WS event handlers (called from the WS subscription)
  applyEvent(event: { type: string; ticketId: string; payload: Record<string, unknown> }): void;
}

const ACTIVE_STATUSES = new Set(['running', 'blocked', 'needs_review']);

export const useWorkflowRunStore = create<State>((set, get) => ({
  runsByTicket: {},
  detail: {},
  loading: false,
  error: null,

  async loadForTicket(ticketId) {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${apiBase()}/api/workflows/runs?ticketId=${encodeURIComponent(ticketId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const runs = (await res.json()) as WorkflowRun[];
      set((s) => ({ runsByTicket: { ...s.runsByTicket, [ticketId]: runs }, loading: false }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  async loadDetail(runId) {
    const res = await fetch(`${apiBase()}/api/workflows/runs/${runId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = (await res.json()) as RunDetail;
    set((s) => ({ detail: { ...s.detail, [runId]: d } }));
  },

  async start(ticketId, templateId) {
    const res = await fetch(`${apiBase()}/api/workflows/runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId, templateId, triggeredFrom: 'smart-button' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const run = (await res.json()) as WorkflowRun;
    set((s) => ({ runsByTicket: { ...s.runsByTicket, [ticketId]: [run, ...(s.runsByTicket[ticketId] ?? [])] } }));
    return run;
  },

  async cancel(runId) {
    const res = await fetch(`${apiBase()}/api/workflows/runs/${runId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },

  async resolveGate(runId, stepRunId, outcome, notes) {
    const res = await fetch(`${apiBase()}/api/workflows/runs/${runId}/steps/${stepRunId}/resolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome, notes }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  },

  async retry(runId, stepRunId) {
    const res = await fetch(`${apiBase()}/api/workflows/runs/${runId}/steps/${stepRunId}/retry`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  },

  activeByTicket(ticketId) {
    return (get().runsByTicket[ticketId] ?? []).find((r) => ACTIVE_STATUSES.has(r.status));
  },

  historyByTicket(ticketId) {
    return (get().runsByTicket[ticketId] ?? []).filter((r) => !ACTIVE_STATUSES.has(r.status));
  },

  applyEvent(event) {
    // Simplest correct response: refetch the affected ticket's runs and the run detail if known
    const ticketId = event.ticketId;
    void get().loadForTicket(ticketId);
    const runId = (event.payload?.workflowRunId as string | undefined);
    if (runId && get().detail[runId]) void get().loadDetail(runId);
  },
}));
```

- [ ] **Step 2: Typecheck**

Run: `bun run --cwd packages/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/stores/workflowRunStore.ts
git commit -m "feat(web): useWorkflowRunStore (Zustand) with WS-driven refetch"
```

---

### Task D.4: `StepRunNode` custom React Flow node (runtime)

**Files:**
- Create: `packages/web/src/components/workflows/StepRunNode.tsx`

- [ ] **Step 1: Write the node component**

```tsx
import { Handle, Position } from '@xyflow/react';
import { Bot, BookOpen, UserCheck, Users, CheckCircle2, XCircle, AlertTriangle, Clock, Loader2, CircleDot, SkipForward } from 'lucide-react';
import type { WorkflowStep, StepRunStatus } from '@fleex/shared';
import { cn } from '@/lib/utils';

export interface StepRunNodeData {
  step: WorkflowStep;
  status: StepRunStatus | 'pending';
  summary?: string;
  isCurrent: boolean;
  onSelect: (stepId: string) => void;
}

const executorIcon = {
  agent: Bot, panel: Users, skill: BookOpen, human_gate: UserCheck,
} as const;

const executorColor = {
  agent: 'text-fleex-purple border-fleex-purple/40',
  panel: 'text-fleex-blue border-fleex-blue/40',
  skill: 'text-fleex-green border-fleex-green/40',
  human_gate: 'text-fleex-amber border-fleex-amber/40 border-dashed',
} as const;

function statusIcon(status: StepRunStatus | 'pending') {
  switch (status) {
    case 'completed': return <CheckCircle2 className="w-4 h-4 text-fleex-cyan" />;
    case 'running': return <Loader2 className="w-4 h-4 text-fleex-green animate-spin" />;
    case 'failed': return <XCircle className="w-4 h-4 text-fleex-red" />;
    case 'needs_review': return <AlertTriangle className="w-4 h-4 text-fleex-amber" />;
    case 'queued': return <Clock className="w-4 h-4 text-fleex-blue" />;
    case 'cancelled':
    case 'skipped': return <SkipForward className="w-4 h-4 text-muted-foreground" />;
    default: return <CircleDot className="w-4 h-4 text-muted-foreground/40" />;
  }
}

export function StepRunNode({ data }: { data: StepRunNodeData }) {
  const Icon = executorIcon[data.step.executorType];
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-muted-foreground/40 !border-2 !border-card" />
      <div
        onClick={() => data.onSelect(data.step.id)}
        className={cn(
          'w-[180px] rounded-lg border-2 p-3 bg-card cursor-pointer transition-all hover:shadow-lg',
          executorColor[data.step.executorType],
          data.isCurrent && 'ring-2 ring-fleex-green ring-offset-2 ring-offset-background',
        )}
      >
        <div className="flex items-center gap-2 mb-1">
          <Icon className="w-4 h-4" />
          <span className="text-xs font-medium truncate flex-1 text-foreground">{data.step.name}</span>
          {statusIcon(data.status)}
        </div>
        <div className="text-[10px] text-muted-foreground truncate">{data.step.executorRef || '—'}</div>
        {data.summary && (
          <div className="mt-1 text-[10px] text-muted-foreground line-clamp-2">{data.summary}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-muted-foreground/40 !border-2 !border-card" />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run --cwd packages/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/workflows/StepRunNode.tsx
git commit -m "feat(web): StepRunNode custom React Flow node for runtime DAG"
```

---

### Task D.5: `WorkflowRunView` — DAG canvas + header + step detail panel

**Files:**
- Create: `packages/web/src/components/workflows/WorkflowRunView.tsx`
- Create: `packages/web/src/components/workflows/HumanGateResolvePanel.tsx`

- [ ] **Step 1: Write `HumanGateResolvePanel.tsx`**

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  outcomes: string[];
  onResolve: (outcome: string, notes?: string) => Promise<void>;
  onRetry: () => Promise<void>;
}

export function HumanGateResolvePanel({ outcomes, onResolve, onRetry }: Props) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const click = async (outcome: string) => {
    setBusy(true);
    try { await onResolve(outcome, notes.trim() || undefined); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Resolve gate</h3>
      <Textarea
        placeholder="Notes (optional, injected as context for the next step)"
        value={notes} onChange={(e) => setNotes(e.target.value)}
        className="text-xs"
      />
      <div className="flex flex-wrap gap-2">
        {outcomes.map((o) => (
          <Button key={o} variant="outline" size="sm" disabled={busy} onClick={() => click(o)}>{o}</Button>
        ))}
        <Button variant="ghost" size="sm" disabled={busy} onClick={onRetry}>Retry step</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `WorkflowRunView.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { WorkflowRun, StepRun, WorkflowStep } from '@fleex/shared';
import { StepRunNode, type StepRunNodeData } from './StepRunNode';
import { HumanGateResolvePanel } from './HumanGateResolvePanel';
import { useWorkflowRunStore } from '@/stores/workflowRunStore';

const nodeTypes = { stepRun: StepRunNode };

interface Props {
  run: WorkflowRun;
  stepRuns: StepRun[];
}

export function WorkflowRunView({ run, stepRuns }: Props) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const cancel = useWorkflowRunStore((s) => s.cancel);
  const resolveGate = useWorkflowRunStore((s) => s.resolveGate);
  const retry = useWorkflowRunStore((s) => s.retry);

  const stepIndex = useMemo(() => new Map(run.templateSnapshot.steps.map((s) => [s.id, s])), [run.templateSnapshot.steps]);
  const latestPerStep = useMemo(() => {
    const m = new Map<string, StepRun>();
    for (const sr of stepRuns) {
      const cur = m.get(sr.stepId);
      if (!cur || sr.attempt > cur.attempt) m.set(sr.stepId, sr);
    }
    return m;
  }, [stepRuns]);

  const nodes: Node<StepRunNodeData>[] = useMemo(() => run.templateSnapshot.steps.map((step) => {
    const sr = latestPerStep.get(step.id);
    return {
      id: step.id,
      type: 'stepRun',
      position: step.position,
      data: {
        step,
        status: sr?.status ?? 'pending',
        summary: (sr?.output?.comment ?? undefined) as string | undefined,
        isCurrent: run.currentStepId === step.id,
        onSelect: setSelectedStepId,
      },
    };
  }), [run.templateSnapshot.steps, latestPerStep, run.currentStepId]);

  const edges: Edge[] = useMemo(() => run.templateSnapshot.edges.map((e) => ({
    id: e.id, source: e.source, target: e.target,
    label: e.label ?? (e.condition ? `${e.condition.field} ${e.condition.operator} ${String(e.condition.value)}` : ''),
    animated: latestPerStep.get(e.source)?.nextEdgeId === e.id,
    style: { strokeDasharray: e.isDefault ? undefined : '5,5' },
    markerEnd: { type: MarkerType.ArrowClosed },
  })), [run.templateSnapshot.edges, latestPerStep]);

  const selectedStep: WorkflowStep | undefined = selectedStepId ? stepIndex.get(selectedStepId) : undefined;
  const selectedStepRun = selectedStepId ? latestPerStep.get(selectedStepId) : undefined;

  const completed = stepRuns.filter((s) => s.status === 'completed').length;
  const total = run.templateSnapshot.steps.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="text-xl">{run.templateSnapshot.emoji}</span>
          <div>
            <div className="text-sm font-medium">{run.templateSnapshot.name}</div>
            <div className="text-xs text-muted-foreground">{completed}/{total} steps completed</div>
          </div>
          <Badge variant={run.status === 'running' ? 'default' : run.status === 'failed' ? 'destructive' : 'secondary'}>
            {run.status}
          </Badge>
        </div>
        {['running', 'blocked', 'needs_review'].includes(run.status) && (
          <Button variant="ghost" size="sm" onClick={() => cancel(run.id)}>Cancel run</Button>
        )}
      </div>

      {/* Body: canvas + detail panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            nodesDraggable={false} nodesConnectable={false} elementsSelectable
            fitView fitViewOptions={{ padding: 0.2 }}
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
        {selectedStep && (
          <div className="w-[320px] border-l border-border p-4 overflow-y-auto space-y-3">
            <h3 className="text-sm font-medium">{selectedStep.name}</h3>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Type: <code>{selectedStep.executorType}</code></div>
              <div>Ref: <code>{selectedStep.executorRef || '—'}</code></div>
              {selectedStepRun && <div>Status: <code>{selectedStepRun.status}</code> (attempt {selectedStepRun.attempt})</div>}
            </div>
            {selectedStepRun?.output && (
              <details className="text-xs">
                <summary className="cursor-pointer">Output</summary>
                <pre className="mt-2 p-2 bg-muted/30 rounded overflow-x-auto text-[10px]">
                  {JSON.stringify(selectedStepRun.output, null, 2)}
                </pre>
              </details>
            )}
            {selectedStepRun?.status === 'needs_review' && selectedStep.executorType === 'human_gate' && (
              <HumanGateResolvePanel
                outcomes={(selectedStepRun.output?.schemaFields?.outcomes as string[]) ?? selectedStep.humanGateOutcomes ?? []}
                onResolve={(outcome, notes) => resolveGate(run.id, selectedStepRun.id, outcome, notes)}
                onRetry={() => retry(run.id, selectedStepRun.id)}
              />
            )}
            {selectedStepRun?.executionId && (
              <a href={`#agent-events/${selectedStepRun.executionId}`} className="text-xs text-fleex-blue underline">
                View agent events
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run --cwd packages/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/workflows/WorkflowRunView.tsx packages/web/src/components/workflows/HumanGateResolvePanel.tsx
git commit -m "feat(web): WorkflowRunView (DAG + step detail) + HumanGateResolvePanel"
```

---

### Task D.6: `TicketWorkflowTab` + plug into `TicketDetail`

**Files:**
- Create: `packages/web/src/components/workflows/TicketWorkflowTab.tsx`
- Modify: `packages/web/src/components/tickets/TicketDetail.tsx`

- [ ] **Step 1: Write `TicketWorkflowTab.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useWorkflowRunStore } from '@/stores/workflowRunStore';
import { WorkflowRunView } from './WorkflowRunView';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

interface Props { ticketId: string }

export function TicketWorkflowTab({ ticketId }: Props) {
  const loadForTicket = useWorkflowRunStore((s) => s.loadForTicket);
  const loadDetail = useWorkflowRunStore((s) => s.loadDetail);
  const runsByTicket = useWorkflowRunStore((s) => s.runsByTicket);
  const detail = useWorkflowRunStore((s) => s.detail);
  const active = useWorkflowRunStore((s) => s.activeByTicket(ticketId));
  const history = useWorkflowRunStore((s) => s.historyByTicket(ticketId));
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => { void loadForTicket(ticketId); }, [ticketId, loadForTicket]);

  const currentRunId = active?.id ?? selectedRunId ?? history[0]?.id;
  useEffect(() => {
    if (currentRunId && !detail[currentRunId]) void loadDetail(currentRunId);
  }, [currentRunId, detail, loadDetail]);

  if ((runsByTicket[ticketId]?.length ?? 0) === 0) {
    return <div className="p-6 text-sm text-muted-foreground">No workflow runs on this ticket yet.</div>;
  }

  const d = currentRunId ? detail[currentRunId] : undefined;
  return (
    <div className="flex flex-col h-full">
      {!active && history.length > 0 && (
        <div className="px-4 py-2 border-b border-border flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Historical run:</span>
          <Select value={currentRunId ?? undefined} onValueChange={setSelectedRunId}>
            <SelectTrigger className="h-8 w-[240px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {history.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.templateSnapshot.emoji} {r.templateSnapshot.name} — {new Date(r.startedAt).toLocaleString()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {d ? <WorkflowRunView run={d.run} stepRuns={d.stepRuns} /> : <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
    </div>
  );
}
```

- [ ] **Step 2: Plug into `TicketDetail`**

In `packages/web/src/components/tickets/TicketDetail.tsx`, find the tab system (search for `<Tabs` or `TabsTrigger`). Add a conditional "Workflow" tab:

```tsx
import { useWorkflowRunStore } from '@/stores/workflowRunStore';
import { TicketWorkflowTab } from '@/components/workflows/TicketWorkflowTab';

// ...inside TicketDetail component:
const workflowRuns = useWorkflowRunStore((s) => s.runsByTicket[ticketId] ?? []);
useEffect(() => { void useWorkflowRunStore.getState().loadForTicket(ticketId); }, [ticketId]);

// in the tabs JSX (alongside Ticket Details / Comments / Deliverables):
{workflowRuns.length > 0 && (
  <TabsTrigger value="workflow">Workflow</TabsTrigger>
)}
// ...
{workflowRuns.length > 0 && (
  <TabsContent value="workflow"><TicketWorkflowTab ticketId={ticketId} /></TabsContent>
)}
```

- [ ] **Step 3: Restart and smoke test in browser**

```bash
fleex restart
```

Open the web UI, create a workflow template (via the editor in Phase E, or manually via API curl), trigger a run via comment `@workflow:test-slug`, verify the Workflow tab appears.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/workflows/TicketWorkflowTab.tsx packages/web/src/components/tickets/TicketDetail.tsx
git commit -m "feat(web): TicketWorkflowTab plugged into TicketDetail tabs"
```

---

### Task D.7: Subscribe to workflow WS events

**Files:**
- Modify: `packages/web/src/lib/appWs.ts` (or wherever the global WS subscription dispatches events to stores)

- [ ] **Step 1: Locate the WS dispatcher**

Run: `grep -n "ticket:" packages/web/src/lib/appWs.ts 2>/dev/null | head -10`
Expected: see existing handlers for `mention:created`, `comment:posted`, etc.

- [ ] **Step 2: Route `workflow:*` events to the run store**

In `packages/web/src/lib/appWs.ts`, in the handler that receives ticket channel messages, add:

```ts
if (event.type.startsWith('workflow:') && event.ticketId) {
  useWorkflowRunStore.getState().applyEvent({ type: event.type, ticketId: event.ticketId, payload: event.payload ?? {} });
}
```

(Adjust to match the existing routing pattern.)

- [ ] **Step 3: Verify with a manual e2e**

Start the stack, create a template, fire a run, watch the Workflow tab update without page refresh.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/lib/appWs.ts
git commit -m "feat(web): route workflow:* WS events to workflowRunStore"
```

---

_End of Phase D._

---

## Phase E — UI Editor

### Task E.1: `EditorStepNode` custom node + executor palette

**Files:**
- Create: `packages/web/src/components/workflows/EditorStepNode.tsx`
- Create: `packages/web/src/components/workflows/executor-palette.tsx`

- [ ] **Step 1: Write `executor-palette.tsx`**

```tsx
import { Bot, Users, BookOpen, UserCheck } from 'lucide-react';
import type { WorkflowExecutorType } from '@fleex/shared';

export interface PaletteEntry {
  type: WorkflowExecutorType;
  label: string;
  description: string;
  Icon: typeof Bot;
  color: string;
}

export const EXECUTOR_PALETTE: PaletteEntry[] = [
  { type: 'agent',      label: 'Agent',      Icon: Bot,       color: 'text-fleex-purple', description: 'AI agent execution' },
  { type: 'panel',      label: 'Panel',      Icon: Users,     color: 'text-fleex-blue',   description: 'Multi-agent committee with synthesis' },
  { type: 'skill',      label: 'Skill',      Icon: BookOpen,  color: 'text-fleex-green',  description: 'Deterministic skill instruction file' },
  { type: 'human_gate', label: 'Human Gate', Icon: UserCheck, color: 'text-fleex-amber',  description: 'Manual approval checkpoint' },
];

export function ExecutorPalette({ onDragStart }: { onDragStart: (type: WorkflowExecutorType, e: React.DragEvent) => void }) {
  return (
    <div className="w-[200px] border-r border-border p-3 space-y-2 overflow-y-auto">
      <h3 className="text-xs font-medium uppercase text-muted-foreground mb-2">Step types</h3>
      {EXECUTOR_PALETTE.map((entry) => {
        const Icon = entry.Icon;
        return (
          <div
            key={entry.type}
            draggable
            onDragStart={(e) => onDragStart(entry.type, e)}
            className="p-2 rounded border border-border bg-card hover:border-fleex-purple/40 cursor-grab"
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`w-4 h-4 ${entry.color}`} />
              <span className="text-xs font-medium">{entry.label}</span>
            </div>
            <div className="text-[10px] text-muted-foreground">{entry.description}</div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Write `EditorStepNode.tsx`**

```tsx
import { Handle, Position } from '@xyflow/react';
import { Bot, Users, BookOpen, UserCheck, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkflowExecutorType, WorkflowStep } from '@fleex/shared';

const executorIcon = { agent: Bot, panel: Users, skill: BookOpen, human_gate: UserCheck } as const;
const executorBorder = {
  agent: 'border-fleex-purple/40',
  panel: 'border-fleex-blue/40',
  skill: 'border-fleex-green/40',
  human_gate: 'border-fleex-amber/40 border-dashed',
} as const;

export interface EditorStepNodeData {
  step: WorkflowStep;
  isSelected: boolean;
  isEntry: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function EditorStepNode({ data }: { data: EditorStepNodeData }) {
  const Icon = executorIcon[data.step.executorType];
  const isUnconfigured = data.step.executorType !== 'human_gate' && !data.step.executorRef;
  return (
    <div className="relative group">
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-muted-foreground/40 !border-2 !border-card" />
      <div
        onClick={() => data.onSelect(data.step.id)}
        className={cn(
          'w-[180px] rounded-lg border-2 p-3 bg-card cursor-pointer transition-all',
          executorBorder[data.step.executorType],
          data.isSelected && 'ring-2 ring-fleex-purple ring-offset-2 ring-offset-background',
        )}
      >
        <button
          onClick={(e) => { e.stopPropagation(); data.onDelete(data.step.id); }}
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-fleex-red/20 text-fleex-red flex items-center justify-center opacity-0 group-hover:opacity-100"
        >
          <X className="w-3 h-3" />
        </button>
        <div className="flex items-center gap-2 mb-1">
          <Icon className="w-4 h-4" />
          <span className="text-xs font-medium truncate flex-1">{data.step.name || 'Unnamed'}</span>
          {data.isEntry && <span className="text-[9px] font-mono bg-fleex-green/20 text-fleex-green px-1 rounded">entry</span>}
        </div>
        <div className="text-[10px] text-muted-foreground truncate">
          {isUnconfigured ? <span className="italic">Unconfigured</span> : data.step.executorRef || '—'}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-muted-foreground/40 !border-2 !border-card" />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run --cwd packages/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/workflows/EditorStepNode.tsx packages/web/src/components/workflows/executor-palette.tsx
git commit -m "feat(web): editor step node + executor palette"
```

---

### Task E.2: `StepConfigPanel` (right-side config for selected step)

**Files:**
- Create: `packages/web/src/components/workflows/StepConfigPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { usePersonaStore } from '@/stores/personaStore';
import { useSkillStore } from '@/stores/skillStore';
import { usePanelStore } from '@/stores/panelStore';
import type { WorkflowStep, WorkflowExecutorType, JsonSchema } from '@fleex/shared';

interface Props {
  step: WorkflowStep;
  isEntry: boolean;
  onChange: (next: WorkflowStep) => void;
  onSetEntry: () => void;
}

export function StepConfigPanel({ step, isEntry, onChange, onSetEntry }: Props) {
  const personas = usePersonaStore((s) => s.personas);
  const skills = useSkillStore((s) => s.skills);
  const panels = usePanelStore((s) => s.panels);

  const [outputSchemaText, setOutputSchemaText] = useState<string>(
    step.outputSchema ? JSON.stringify(step.outputSchema, null, 2) : '',
  );
  const [outputSchemaError, setOutputSchemaError] = useState<string | null>(null);

  useEffect(() => {
    setOutputSchemaText(step.outputSchema ? JSON.stringify(step.outputSchema, null, 2) : '');
    setOutputSchemaError(null);
  }, [step.id]);

  const refOptions = (() => {
    switch (step.executorType) {
      case 'agent': return personas.map((p) => ({ value: p.name, label: p.displayName || p.name }));
      case 'skill': return skills.map((s) => ({ value: s.commandName, label: s.displayName || s.commandName }));
      case 'panel': return panels.map((p) => ({ value: p.name, label: p.displayName || p.name }));
      case 'human_gate': return [];
    }
  })();

  const handleOutputSchema = (text: string) => {
    setOutputSchemaText(text);
    if (text.trim() === '') {
      setOutputSchemaError(null);
      onChange({ ...step, outputSchema: undefined });
      return;
    }
    try {
      const parsed = JSON.parse(text) as JsonSchema;
      if (parsed.type !== 'object' || !parsed.properties) throw new Error('must be {"type":"object","properties":{...}}');
      setOutputSchemaError(null);
      onChange({ ...step, outputSchema: parsed });
    } catch (e) {
      setOutputSchemaError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Step name</Label>
        <Input value={step.name} onChange={(e) => onChange({ ...step, name: e.target.value })} className="h-8 text-xs" />
      </div>
      <div>
        <Label className="text-xs">Type</Label>
        <div className="text-xs font-mono bg-muted/30 px-2 py-1 rounded">{step.executorType}</div>
      </div>
      {step.executorType !== 'human_gate' && (
        <div>
          <Label className="text-xs">Executor ref</Label>
          <Select value={step.executorRef} onValueChange={(v) => onChange({ ...step, executorRef: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              {refOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {step.executorType !== 'human_gate' && (
        <div>
          <Label className="text-xs">Mode override (optional)</Label>
          <Select
            value={step.mode ?? '__inherit__'}
            onValueChange={(v) => onChange({ ...step, mode: v === '__inherit__' ? undefined : v as 'talk' | 'plan' | 'edit' })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__inherit__">Inherit from persona</SelectItem>
              <SelectItem value="talk">talk</SelectItem>
              <SelectItem value="plan">plan</SelectItem>
              <SelectItem value="edit">edit</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {step.executorType === 'human_gate' && (
        <div>
          <Label className="text-xs">Outcomes (comma-separated)</Label>
          <Input
            value={(step.humanGateOutcomes ?? []).join(', ')}
            onChange={(e) => onChange({ ...step, humanGateOutcomes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            className="h-8 text-xs"
            placeholder="approve, reject, request_changes"
          />
        </div>
      )}
      <div>
        <Label className="text-xs">Output schema (JSON Schema)</Label>
        <Textarea
          value={outputSchemaText}
          onChange={(e) => handleOutputSchema(e.target.value)}
          className="text-[11px] font-mono min-h-[160px]"
          placeholder='{"type":"object","properties":{"path":{"type":"string","enum":["a","b"]}},"required":["path"]}'
        />
        {outputSchemaError && <div className="text-[10px] text-fleex-red mt-1">{outputSchemaError}</div>}
      </div>
      <Button size="sm" variant="outline" disabled={isEntry} onClick={onSetEntry}>
        {isEntry ? 'Entry step' : 'Set as entry step'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run --cwd packages/web typecheck`
Expected: no errors. If `usePanelStore` does not exist, adapt to whatever store / hook exposes panels in the codebase (search with `grep -rn "panels" packages/web/src/stores`).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/workflows/StepConfigPanel.tsx
git commit -m "feat(web): StepConfigPanel with ref autocomplete + JSON Schema textarea"
```

---

### Task E.3: `EdgeConfigPanel` (right-side config for selected edge)

**Files:**
- Create: `packages/web/src/components/workflows/EdgeConfigPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import type { WorkflowEdge, EdgeOperator } from '@fleex/shared';

interface Props {
  edge: WorkflowEdge;
  onChange: (next: WorkflowEdge) => void;
  onDelete: () => void;
}

const OPERATORS: EdgeOperator[] = ['eq', 'neq', 'in', 'gt', 'lt', 'contains'];

export function EdgeConfigPanel({ edge, onChange, onDelete }: Props) {
  const isDefault = edge.isDefault;
  const condition = edge.condition;

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Label (optional)</Label>
        <Input value={edge.label ?? ''} onChange={(e) => onChange({ ...edge, label: e.target.value || undefined })} className="h-8 text-xs" />
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-xs">Default (fallback) edge</Label>
        <Switch
          checked={isDefault}
          onCheckedChange={(checked) => onChange({
            ...edge,
            isDefault: checked,
            condition: checked ? undefined : (condition ?? { field: '', operator: 'eq', value: '' }),
          })}
        />
      </div>

      {!isDefault && (
        <>
          <div>
            <Label className="text-xs">Field (from output schema)</Label>
            <Input
              value={condition?.field ?? ''}
              onChange={(e) => onChange({ ...edge, condition: { ...(condition ?? { operator: 'eq', value: '' }), field: e.target.value } })}
              placeholder="e.g. path, outcome, deliverable.status"
              className="h-8 text-xs font-mono"
            />
          </div>
          <div>
            <Label className="text-xs">Operator</Label>
            <Select
              value={condition?.operator ?? 'eq'}
              onValueChange={(v) => onChange({ ...edge, condition: { ...(condition ?? { field: '', value: '' }), operator: v as EdgeOperator } })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {OPERATORS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Value{condition?.operator === 'in' ? ' (comma-separated)' : ''}</Label>
            <Input
              value={Array.isArray(condition?.value) ? condition!.value.join(', ') : (condition?.value ?? '')}
              onChange={(e) => {
                const raw = e.target.value;
                const value = condition?.operator === 'in' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : raw;
                onChange({ ...edge, condition: { ...(condition ?? { field: '', operator: 'eq' }), value } });
              }}
              className="h-8 text-xs font-mono"
            />
          </div>
        </>
      )}

      <Button variant="ghost" size="sm" className="text-fleex-red" onClick={onDelete}>Delete edge</Button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run --cwd packages/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/workflows/EdgeConfigPanel.tsx
git commit -m "feat(web): EdgeConfigPanel — default toggle + condition (field/op/value)"
```

---

### Task E.4: `WorkflowEditorView` main editor

**Files:**
- Create: `packages/web/src/components/workflows/WorkflowEditorView.tsx`

- [ ] **Step 1: Write the main editor**

```tsx
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, ReactFlowProvider, useReactFlow,
  applyNodeChanges, applyEdgeChanges, addEdge,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ExecutorPalette } from './executor-palette';
import { EditorStepNode, type EditorStepNodeData } from './EditorStepNode';
import { StepConfigPanel } from './StepConfigPanel';
import { EdgeConfigPanel } from './EdgeConfigPanel';
import { useWorkflowTemplateStore } from '@/stores/workflowTemplateStore';
import { useToast } from '@/hooks/use-toast';
import type { WorkflowExecutorType, WorkflowStep, WorkflowEdge as WfEdge, WorkflowTemplate } from '@fleex/shared';

const nodeTypes = { editorStep: EditorStepNode };

interface Props {
  template: WorkflowTemplate;
  onBack: () => void;
}

export function WorkflowEditorView(props: Props) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}

function EditorInner({ template, onBack }: Props) {
  const { toast } = useToast();
  const update = useWorkflowTemplateStore((s) => s.update);
  const reactFlow = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Mutable local state
  const [name, setName] = useState(template.name);
  const [slug, setSlug] = useState(template.slug);
  const [emoji, setEmoji] = useState(template.emoji);
  const [description, setDescription] = useState(template.description);
  const [steps, setSteps] = useState<WorkflowStep[]>(template.steps);
  const [edges, setEdges] = useState<WfEdge[]>(template.edges);
  const [entryStepId, setEntryStepId] = useState<string>(template.entryStepId);

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // RF nodes/edges derived from local state
  const nodes: Node<EditorStepNodeData>[] = useMemo(() => steps.map((s) => ({
    id: s.id,
    type: 'editorStep',
    position: s.position,
    data: {
      step: s, isSelected: s.id === selectedStepId, isEntry: s.id === entryStepId,
      onSelect: (id) => { setSelectedStepId(id); setSelectedEdgeId(null); },
      onDelete: (id) => {
        setSteps((prev) => prev.filter((x) => x.id !== id));
        setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
        if (selectedStepId === id) setSelectedStepId(null);
        if (entryStepId === id) {
          const next = steps.find((x) => x.id !== id);
          if (next) setEntryStepId(next.id);
        }
      },
    },
  })), [steps, selectedStepId, entryStepId]);

  const rfEdges: Edge[] = useMemo(() => edges.map((e) => ({
    id: e.id, source: e.source, target: e.target,
    label: e.label ?? (e.condition ? `${e.condition.field} ${e.condition.operator} ${String(e.condition.value)}` : ''),
    style: { strokeDasharray: e.isDefault ? undefined : '5,5' },
    markerEnd: { type: MarkerType.ArrowClosed },
    selected: e.id === selectedEdgeId,
  })), [edges, selectedEdgeId]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setSteps((prev) => {
      const next = applyNodeChanges(changes, prev.map((s) => ({ id: s.id, position: s.position, data: {} } as Node))) as Node[];
      return prev.map((s) => {
        const updated = next.find((n) => n.id === s.id);
        return updated ? { ...s, position: updated.position } : s;
      });
    });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((prev) => {
      // For position changes RF gives us removal too; respect 'remove' ops only here
      let next = prev;
      for (const c of changes) {
        if (c.type === 'remove') next = next.filter((e) => e.id !== c.id);
      }
      return next;
    });
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    const id = `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setEdges((prev) => [...prev, { id, source: connection.source!, target: connection.target!, isDefault: true }]);
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/x-fleex-executor') as WorkflowExecutorType;
    if (!type) return;
    const bounds = wrapperRef.current!.getBoundingClientRect();
    const position = reactFlow.screenToFlowPosition({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    const id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const step: WorkflowStep = {
      id, name: type === 'human_gate' ? 'Human Gate' : 'New Step',
      executorType: type, executorRef: '', position,
      humanGateOutcomes: type === 'human_gate' ? ['approve', 'reject'] : undefined,
    };
    setSteps((prev) => [...prev, step]);
    if (steps.length === 0) setEntryStepId(id);
  }, [reactFlow, steps.length]);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onPaletteDragStart = useCallback((type: WorkflowExecutorType, e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-fleex-executor', type);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const selectedStep = selectedStepId ? steps.find((s) => s.id === selectedStepId) : undefined;
  const selectedEdge = selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) : undefined;

  const save = async () => {
    setSaving(true);
    try {
      await update(template.id, { name, slug, emoji, description, steps, edges, entryStepId, enabled: template.enabled });
      toast({ title: 'Workflow saved' });
    } catch (err) {
      toast({ title: 'Save failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-[200px] text-sm" placeholder="Name" />
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} className="h-8 w-[180px] text-xs font-mono" placeholder="slug" />
          <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="h-8 w-[60px] text-center" placeholder="🏭" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{steps.length} steps · {edges.length} edges</span>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Workflow'}</Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <ExecutorPalette onDragStart={onPaletteDragStart} />
        <div ref={wrapperRef} className="flex-1" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes} edges={rfEdges} nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onEdgeClick={(_, e) => { setSelectedEdgeId(e.id); setSelectedStepId(null); }}
            onPaneClick={() => { setSelectedStepId(null); setSelectedEdgeId(null); }}
            fitView fitViewOptions={{ padding: 0.2 }}
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
        <div className="w-[320px] border-l border-border p-4 overflow-y-auto">
          {selectedStep ? (
            <StepConfigPanel
              step={selectedStep}
              isEntry={selectedStep.id === entryStepId}
              onChange={(next) => setSteps((prev) => prev.map((s) => s.id === next.id ? next : s))}
              onSetEntry={() => setEntryStepId(selectedStep.id)}
            />
          ) : selectedEdge ? (
            <EdgeConfigPanel
              edge={selectedEdge}
              onChange={(next) => setEdges((prev) => prev.map((e) => e.id === next.id ? next : e))}
              onDelete={() => { setEdges((prev) => prev.filter((e) => e.id !== selectedEdge.id)); setSelectedEdgeId(null); }}
            />
          ) : (
            <div className="space-y-3">
              <Label className="text-xs">Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="text-xs" />
              <div className="text-[10px] text-muted-foreground">
                Drag a step type from the palette into the canvas. Connect nodes by dragging from the right handle to the left handle of another node. Click a step or edge to configure it.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run --cwd packages/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/workflows/WorkflowEditorView.tsx
git commit -m "feat(web): WorkflowEditorView — React Flow editor with palette + config panels"
```

---

### Task E.5: `CreateWorkflowModal` + add "Workflows" section to `AgentListPanel`

**Files:**
- Create: `packages/web/src/components/agents/CreateWorkflowModal.tsx`
- Modify: `packages/web/src/components/agents/AgentListPanel.tsx`

- [ ] **Step 1: Write `CreateWorkflowModal.tsx`**

```tsx
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useWorkflowTemplateStore } from '@/stores/workflowTemplateStore';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (templateId: string) => void;
}

export function CreateWorkflowModal({ open, onOpenChange, onCreated }: Props) {
  const create = useWorkflowTemplateStore((s) => s.create);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [emoji, setEmoji] = useState('🔧');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const entryId = `s-${Date.now()}`;
      const t = await create({
        name, slug, emoji, description,
        steps: [{ id: entryId, name: 'Entry Step', executorType: 'agent', executorRef: '', position: { x: 0, y: 0 } }],
        edges: [], entryStepId: entryId, enabled: true,
      });
      onCreated(t.id);
      onOpenChange(false);
      setName(''); setSlug(''); setEmoji('🔧'); setDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New workflow</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Feature Delivery" />
          </div>
          <div>
            <Label className="text-xs">Slug (used as @workflow:slug)</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))} placeholder="feature-delivery" className="font-mono text-xs" />
          </div>
          <div>
            <Label className="text-xs">Emoji</Label>
            <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="w-[80px] text-center" />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {error && <div className="text-xs text-fleex-red">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !name || !slug}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add "Workflows" section to `AgentListPanel.tsx`**

In `packages/web/src/components/agents/AgentListPanel.tsx`, after the existing sections (Agents / Panels / Skills), add a 4th section:

```tsx
import { useState, useEffect } from 'react';
import { useWorkflowTemplateStore } from '@/stores/workflowTemplateStore';
import { CreateWorkflowModal } from './CreateWorkflowModal';
// ... existing imports

// inside the component:
const templates = useWorkflowTemplateStore((s) => s.templates);
const refreshTemplates = useWorkflowTemplateStore((s) => s.refresh);
const removeTemplate = useWorkflowTemplateStore((s) => s.remove);
const [showCreateWorkflow, setShowCreateWorkflow] = useState(false);

useEffect(() => { void refreshTemplates(); }, [refreshTemplates]);

// in the JSX, alongside other sections (Agents / Panels / Skills):
<div className="border-b border-border">
  <div className="flex items-center justify-between px-3 py-2">
    <h3 className="text-xs font-medium uppercase text-muted-foreground">Workflows</h3>
    <button className="text-xs text-fleex-purple" onClick={() => setShowCreateWorkflow(true)}>+ New</button>
  </div>
  <div className="space-y-1 pb-2">
    {templates.map((t) => (
      <button
        key={t.id}
        className="w-full text-left px-3 py-1.5 hover:bg-muted/30 flex items-center gap-2"
        onClick={() => onSelectWorkflow(t.id)}
      >
        <span>{t.emoji}</span>
        <span className="text-xs flex-1 truncate">{t.name}</span>
        <span className="text-[9px] font-mono text-muted-foreground">@workflow:{t.slug}</span>
      </button>
    ))}
    {templates.length === 0 && <div className="px-3 py-2 text-[10px] text-muted-foreground">No workflows yet.</div>}
  </div>
</div>

<CreateWorkflowModal
  open={showCreateWorkflow}
  onOpenChange={setShowCreateWorkflow}
  onCreated={(id) => onSelectWorkflow(id)}
/>
```

(`onSelectWorkflow` is a prop you add to `AgentListPanel`, plumbed from `AgentPersonaView` or the parent page that routes to `WorkflowEditorView`.)

- [ ] **Step 3: Wire `WorkflowEditorView` into the parent route**

In the parent (likely `AgentPersonaView.tsx` or `AgentsPage.tsx`), add state for `editingWorkflowId`. When set, render `<WorkflowEditorView template={...} onBack={() => setEditingWorkflowId(null)} />` instead of the persona/skill view. Otherwise show the persona detail.

- [ ] **Step 4: Restart + smoke test**

```bash
fleex restart
```

In the browser, navigate to Agents view → click "New" under Workflows → fill in form → editor opens → drag a step from palette → save → verify template is persisted (refresh).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/agents/CreateWorkflowModal.tsx packages/web/src/components/agents/AgentListPanel.tsx packages/web/src/components/agents/AgentPersonaView.tsx
git commit -m "feat(web): Workflows section in AgentListPanel + CreateWorkflowModal + editor routing"
```

---

### Task E.6: Hook workflows into `SmartSessionButton`

**Files:**
- Modify: `packages/web/src/components/dashboard/SmartSessionButton.tsx`

- [ ] **Step 1: Locate the existing skills section in the dropdown**

Run: `grep -n "enabledSkills\.map" packages/web/src/components/dashboard/SmartSessionButton.tsx`
Expected: find the JSX block that renders skills as menu items.

- [ ] **Step 2: Add workflows alongside skills**

In the dropdown component, import the workflow store and add a parallel section:

```tsx
import { useWorkflowTemplateStore } from '@/stores/workflowTemplateStore';
import { useWorkflowRunStore } from '@/stores/workflowRunStore';

// ... near the top of the dropdown content:
const templates = useWorkflowTemplateStore((s) => s.templates);
const startRun = useWorkflowRunStore((s) => s.start);
const enabledTemplates = templates.filter((t) => t.enabled);

// In the JSX, after the skills section:
{enabledTemplates.length > 0 && (
  <div className="border-t border-border pt-1 mt-1">
    <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground">Workflows</div>
    {enabledTemplates.map((t) => (
      <button
        key={t.id}
        className="w-full text-left px-2 py-1.5 hover:bg-muted/30 flex items-center gap-2"
        onClick={() => {
          void startRun(currentTicketId, t.id);
          closeDropdown();
        }}
      >
        <span>{t.emoji}</span>
        <span className="text-xs flex-1">{t.name}</span>
        <span className="text-[9px] font-mono text-muted-foreground">/{t.slug}</span>
      </button>
    ))}
  </div>
)}
```

Adjust `currentTicketId` and `closeDropdown` to the existing API of the component.

- [ ] **Step 3: Restart + smoke test**

```bash
fleex restart
```

Open a ticket, click the SmartSessionButton, verify the Workflows section appears with the templates created via the editor. Click one → verify a run is created (Workflow tab appears).

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/dashboard/SmartSessionButton.tsx
git commit -m "feat(web): SmartSessionButton — Workflows section starts a run on the current ticket"
```

---

_End of Phase E._

---

## Self-review checklist (the engineer runs this before declaring done)

1. **Spec coverage** — every section of `docs/superpowers/specs/2026-05-23-ticket-workflows-design.md` mapped to at least one task above:
   - §3 Domain model → Phase A
   - §4 Trigger & lifecycle → Phase C
   - §5 Orchestrator → Phase B
   - §6 HTTP endpoints → Phase C (templates + runs)
   - §7 Edge resolution → Task B.1
   - §8 UI runtime → Phase D
   - §9 UI editor → Phase E
   - §10 Security / observability → Phase A.2 (RLS) + Phase B.15 (event types)
   - §11 Testing → tests embedded in each task

2. **Smoke test the full happy path** (after Phase E):
   - Create a template via the editor with 3 steps: agent (triage), human_gate (approve/reject), agent (build).
   - Connect: triage → gate (default), gate → build (outcome eq approve).
   - On a fresh ticket, comment `@workflow:<slug>` → run is created → triage executes → posts deliverable + transitions to gate → workflow status = needs_review.
   - In the Workflow tab, click "approve" → next step starts → workflow runs to completion.

3. **Manual e2e checklist**:
   - [ ] Template editor: drag-and-drop creates nodes, connect creates edge, save persists.
   - [ ] Mention `@workflow:nonexistent` resolves silently (no error toast).
   - [ ] Mention `@workflow:<valid>` creates a run.
   - [ ] SmartSessionButton lists workflows and starts a run on click.
   - [ ] Concurrent run attempt returns 409 (try via curl).
   - [ ] Cancel run from the Workflow tab → status = cancelled.
   - [ ] Retry a failed step from the detail panel → new attempt created.
   - [ ] Human gate with custom outcomes → buttons match → resolving routes correctly.
   - [ ] WS events update the Workflow tab without page refresh.

---

_End of plan._





/**
 * Driver-agnostic contract for the three workflow store ports.
 *
 * There was no cross-driver suite before, which is exactly how `json` and `pgsql`
 * shipped with `workflowTemplateStore: null` unnoticed. Every driver must run this
 * same suite so a missing or divergent adapter fails a test instead of surfacing as
 * a 404 in production.
 *
 * Not a `.test.ts` file on purpose — it exports a suite that each driver's own test
 * file invokes with its harness.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { WorkflowStep, WorkflowEdge } from '@fleex/shared';
import { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';
import type { WorkflowTemplateStorePort } from '../../src/application/ports/workflow-template-store.port.js';
import type { WorkflowRunStorePort } from '../../src/application/ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../../src/application/ports/step-run-store.port.js';

export interface WorkflowStoreHarness {
  templateStore: WorkflowTemplateStorePort;
  runStore: WorkflowRunStorePort;
  stepRunStore: StepRunStorePort;
  /**
   * Insert whatever the driver's foreign keys require before a run can be saved.
   * SQL drivers need the ticket row to exist; `json` has no FKs and can no-op.
   */
  seedTicket(ticketId: string): Promise<void>;
  teardown(): Promise<void>;
}

const STEPS: WorkflowStep[] = [
  { id: 'step-1', name: 'First', executorType: 'agent', executorRef: 'builder', position: { x: 0, y: 0 } },
  { id: 'step-2', name: 'Second', executorType: 'agent', executorRef: 'reviewer', position: { x: 200, y: 0 } },
];

const EDGES: WorkflowEdge[] = [
  { id: 'edge-1', source: 'step-1', target: 'step-2' },
];

function makeTemplate(overrides: Partial<{ id: string; slug: string; name: string; enabled: boolean }> = {}) {
  return WorkflowTemplateEntity.create({
    id: overrides.id ?? 'tmpl-1',
    name: overrides.name ?? 'Ship it',
    slug: overrides.slug ?? 'ship-it',
    emoji: '🚀',
    description: 'Contract fixture',
    steps: STEPS,
    edges: EDGES,
    entryStepId: 'step-1',
    enabled: overrides.enabled ?? true,
  });
}

function makeRun(id: string, ticketId: string, templateId = 'tmpl-1') {
  return WorkflowRunEntity.create({
    id,
    ticketId,
    templateId,
    templateSnapshot: {
      name: 'Ship it', emoji: '🚀', steps: STEPS, edges: EDGES, entryStepId: 'step-1',
    },
    triggeredBy: '@tester',
    triggeredFrom: 'contract',
  });
}

/**
 * @param driverName shown in the test output
 * @param createHarness fresh, isolated stores for each test
 */
export function runWorkflowStoreContract(
  driverName: string,
  createHarness: () => Promise<WorkflowStoreHarness>,
): void {
  describe(`workflow store contract — ${driverName}`, () => {
    let h: WorkflowStoreHarness;

    beforeEach(async () => {
      h = await createHarness();
    });

    afterEach(async () => {
      await h.teardown();
    });

    // ── WorkflowTemplateStorePort ──────────────────────────────────────────

    describe('WorkflowTemplateStorePort', () => {
      it('round-trips a template with its steps and edges intact', async () => {
        await h.templateStore.save(makeTemplate());

        const found = await h.templateStore.getById('tmpl-1');
        expect(found).not.toBeNull();
        expect(found?.name).toBe('Ship it');
        expect(found?.slug).toBe('ship-it');
        expect(found?.emoji).toBe('🚀');
        expect(found?.entryStepId).toBe('step-1');
        // The DAG is the whole point of a template — it must survive serialization.
        expect(found?.steps).toEqual(STEPS);
        expect(found?.edges).toEqual(EDGES);
        expect(found?.enabled).toBe(true);
      });

      it('returns null for an unknown id and an unknown slug', async () => {
        expect(await h.templateStore.getById('nope')).toBeNull();
        expect(await h.templateStore.getBySlug('nope')).toBeNull();
      });

      it('finds a template by slug — this is what resolves an @workflow: mention', async () => {
        await h.templateStore.save(makeTemplate());
        const found = await h.templateStore.getBySlug('ship-it');
        expect(found?.id).toBe('tmpl-1');
      });

      it('excludes disabled templates from getEnabled but keeps them in getAll', async () => {
        await h.templateStore.save(makeTemplate({ id: 'tmpl-1', slug: 'enabled-one', name: 'Alpha' }));
        await h.templateStore.save(makeTemplate({ id: 'tmpl-2', slug: 'disabled-one', name: 'Beta', enabled: false }));

        const enabled = await h.templateStore.getEnabled();
        expect(enabled.map((t) => t.id)).toEqual(['tmpl-1']);

        const all = await h.templateStore.getAll();
        expect(all.map((t) => t.id).sort()).toEqual(['tmpl-1', 'tmpl-2']);
      });

      it('orders getAll by name ascending', async () => {
        await h.templateStore.save(makeTemplate({ id: 'tmpl-1', slug: 'zulu', name: 'Zulu' }));
        await h.templateStore.save(makeTemplate({ id: 'tmpl-2', slug: 'alpha', name: 'Alpha' }));

        const all = await h.templateStore.getAll();
        expect(all.map((t) => t.name)).toEqual(['Alpha', 'Zulu']);
      });

      it('updates in place rather than duplicating on re-save', async () => {
        const t = makeTemplate();
        await h.templateStore.save(t);

        t.update({ name: 'Renamed', enabled: false });
        await h.templateStore.save(t);

        const all = await h.templateStore.getAll();
        expect(all).toHaveLength(1);
        expect(all[0]?.name).toBe('Renamed');
        expect(all[0]?.enabled).toBe(false);
      });

      it('removes a template', async () => {
        await h.templateStore.save(makeTemplate());
        await h.templateStore.remove('tmpl-1');
        expect(await h.templateStore.getById('tmpl-1')).toBeNull();
      });
    });

    // ── WorkflowRunStorePort ───────────────────────────────────────────────

    describe('WorkflowRunStorePort', () => {
      beforeEach(async () => {
        await h.templateStore.save(makeTemplate());
        await h.seedTicket('ticket-1');
      });

      it('round-trips a run with its template snapshot intact', async () => {
        await h.runStore.save(makeRun('run-1', 'ticket-1'));

        const found = await h.runStore.getById('run-1');
        expect(found).not.toBeNull();
        expect(found?.ticketId).toBe('ticket-1');
        expect(found?.templateId).toBe('tmpl-1');
        expect(found?.status).toBe('running');
        expect(found?.currentStepId).toBe('step-1');
        expect(found?.triggeredBy).toBe('@tester');
        // The snapshot is what the run executes against — it must not be mangled.
        expect(found?.templateSnapshot.steps).toEqual(STEPS);
        expect(found?.templateSnapshot.edges).toEqual(EDGES);
        expect(found?.completedAt).toBeNull();
      });

      it('returns null for an unknown id', async () => {
        expect(await h.runStore.getById('nope')).toBeNull();
      });

      it('lists runs for a ticket and none for another', async () => {
        await h.seedTicket('ticket-2');
        await h.runStore.save(makeRun('run-1', 'ticket-1'));
        await h.runStore.save(makeRun('run-2', 'ticket-2'));

        expect((await h.runStore.getByTicket('ticket-1')).map((r) => r.id)).toEqual(['run-1']);
        expect((await h.runStore.getByTicket('ticket-3'))).toEqual([]);
      });

      it('reports an active run while running and nothing once completed', async () => {
        const run = makeRun('run-1', 'ticket-1');
        await h.runStore.save(run);

        expect((await h.runStore.getActiveByTicket('ticket-1'))?.id).toBe('run-1');

        // needs_review is still active — a human gate is a pause, not an end.
        run.block();
        await h.runStore.save(run);
        expect((await h.runStore.getActiveByTicket('ticket-1'))?.id).toBe('run-1');

        run.complete();
        await h.runStore.save(run);
        expect(await h.runStore.getActiveByTicket('ticket-1')).toBeNull();
      });

      it('filters by status', async () => {
        const a = makeRun('run-1', 'ticket-1');
        const b = makeRun('run-2', 'ticket-1');
        b.complete();
        await h.runStore.save(a);
        await h.runStore.save(b);

        expect((await h.runStore.getByStatus('running')).map((r) => r.id)).toEqual(['run-1']);
        expect((await h.runStore.getByStatus('completed')).map((r) => r.id)).toEqual(['run-2']);
      });

      it('returns every run from getAll — the Execution Log depends on it', async () => {
        await h.runStore.save(makeRun('run-1', 'ticket-1'));
        await h.runStore.save(makeRun('run-2', 'ticket-1'));

        const all = await h.runStore.getAll();
        expect(all.map((r) => r.id).sort()).toEqual(['run-1', 'run-2']);
      });

      it('persists a completed status and completedAt across a re-read', async () => {
        const run = makeRun('run-1', 'ticket-1');
        await h.runStore.save(run);
        run.complete();
        await h.runStore.save(run);

        const found = await h.runStore.getById('run-1');
        expect(found?.status).toBe('completed');
        expect(found?.currentStepId).toBeNull();
        expect(found?.completedAt).toBeInstanceOf(Date);
      });
    });

    // ── StepRunStorePort ───────────────────────────────────────────────────

    describe('StepRunStorePort', () => {
      beforeEach(async () => {
        await h.templateStore.save(makeTemplate());
        await h.seedTicket('ticket-1');
        await h.runStore.save(makeRun('run-1', 'ticket-1'));
      });

      it('round-trips a step run including its structured output', async () => {
        const sr = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'step-1' });
        sr.start();
        sr.status = 'completed';
        sr.result = 'success';
        sr.output = { summary: 'all good', deliverableIds: ['d-1'] } as never;
        sr.completedAt = new Date();
        await h.stepRunStore.save(sr);

        const found = await h.stepRunStore.getById('sr-1');
        expect(found).not.toBeNull();
        expect(found?.workflowRunId).toBe('run-1');
        expect(found?.stepId).toBe('step-1');
        expect(found?.status).toBe('completed');
        expect(found?.result).toBe('success');
        expect(found?.output).toEqual({ summary: 'all good', deliverableIds: ['d-1'] });
        expect(found?.startedAt).toBeInstanceOf(Date);
      });

      it('keeps a null output as null rather than inventing an object', async () => {
        await h.stepRunStore.save(StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'step-1' }));
        const found = await h.stepRunStore.getById('sr-1');
        expect(found?.output).toBeNull();
        expect(found?.result).toBeNull();
        expect(found?.startedAt).toBeNull();
      });

      it('lists step runs for a workflow run', async () => {
        await h.stepRunStore.save(StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'step-1' }));
        await h.stepRunStore.save(StepRunEntity.create({ id: 'sr-2', workflowRunId: 'run-1', stepId: 'step-2' }));

        const list = await h.stepRunStore.getByWorkflowRun('run-1');
        expect(list.map((s) => s.id).sort()).toEqual(['sr-1', 'sr-2']);
        expect(await h.stepRunStore.getByWorkflowRun('run-999')).toEqual([]);
      });

      it('returns the highest attempt from getLatestForStep — retries must win', async () => {
        await h.stepRunStore.save(StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'step-1', attempt: 1 }));
        await h.stepRunStore.save(StepRunEntity.create({ id: 'sr-2', workflowRunId: 'run-1', stepId: 'step-1', attempt: 2 }));

        const latest = await h.stepRunStore.getLatestForStep('run-1', 'step-1');
        expect(latest?.id).toBe('sr-2');
        expect(latest?.attempt).toBe(2);
        expect(await h.stepRunStore.getLatestForStep('run-1', 'step-999')).toBeNull();
      });

      it('returns every step run from getAll', async () => {
        await h.stepRunStore.save(StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'step-1' }));
        await h.stepRunStore.save(StepRunEntity.create({ id: 'sr-2', workflowRunId: 'run-1', stepId: 'step-2' }));

        expect((await h.stepRunStore.getAll()).map((s) => s.id).sort()).toEqual(['sr-1', 'sr-2']);
      });

      it('updates in place rather than duplicating on re-save', async () => {
        const sr = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'step-1' });
        await h.stepRunStore.save(sr);
        sr.status = 'running';
        await h.stepRunStore.save(sr);

        const list = await h.stepRunStore.getByWorkflowRun('run-1');
        expect(list).toHaveLength(1);
        expect(list[0]?.status).toBe('running');
      });
    });

    // ── Cascade non-regression ─────────────────────────────────────────────

    describe('run transitions must not destroy step history', () => {
      /**
       * On SQL drivers a delete-then-insert upsert (INSERT OR REPLACE) fires
       * ON DELETE CASCADE on step_runs, wiping the entire step history on every
       * single run state change. Adapters must upsert in place instead.
       */
      it('keeps all step runs after repeated run state transitions', async () => {
        await h.templateStore.save(makeTemplate());
        await h.seedTicket('ticket-1');

        const run = makeRun('run-1', 'ticket-1');
        await h.runStore.save(run);

        await h.stepRunStore.save(StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'step-1' }));
        await h.stepRunStore.save(StepRunEntity.create({ id: 'sr-2', workflowRunId: 'run-1', stepId: 'step-2' }));

        run.advanceTo('step-2');
        await h.runStore.save(run);
        run.block();
        await h.runStore.save(run);
        run.complete();
        await h.runStore.save(run);

        const stepRuns = await h.stepRunStore.getByWorkflowRun('run-1');
        expect(stepRuns.map((s) => s.id).sort()).toEqual(['sr-1', 'sr-2']);
      });
    });
  });
}

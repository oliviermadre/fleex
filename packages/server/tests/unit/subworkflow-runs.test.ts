import { describe, it, expect, vi } from 'vitest';
import type { WorkflowStep, WorkflowEdge, StepOutput } from '@fleex/shared';
import { MAX_STEP_VISITS_PER_RUN } from '@fleex/shared';
import { CreateWorkflowRunUseCase } from '../../src/application/use-cases/create-workflow-run.js';
import { RunWorkflowStepUseCase, LOOP_GUARD_FIELD } from '../../src/application/use-cases/run-workflow-step.js';
import { WorkflowStepExecutor } from '../../src/application/services/step-executors/workflow-step-executor.js';
import { HumanGateStepExecutor } from '../../src/application/services/step-executors/human-gate-step-executor.js';
import { ResolveHumanGateUseCase } from '../../src/application/use-cases/resolve-human-gate.js';
import { RouteStepExecutor } from '../../src/application/services/step-executors/route-step-executor.js';
import { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';
import type { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import type { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';
import { RetryStepUseCase } from '../../src/application/use-cases/retry-step.js';
import { SubworkflowExpansionFailedError } from '../../src/domain/errors.js';

/**
 * Sub-workflows end to end, on the real use cases with in-memory stores: a
 * "Full delivery" composed of Build and QA must run as ONE run whose steps are
 * the children's, branch on what the child concluded, and — since composing
 * makes loops more expensive — stop looping on its own instead of burning
 * tokens until someone notices.
 */

const step = (id: string, extra: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id, name: id, executorType: 'agent', executorRef: 'builder', position: { x: 0, y: 0 }, ...extra,
});
const edge = (id: string, source: string, target: string, extra: Partial<WorkflowEdge> = {}): WorkflowEdge => ({
  id, source, target, isDefault: true, ...extra,
});
const tpl = (id: string, slug: string, steps: WorkflowStep[], edges: WorkflowEdge[], enabled = true) =>
  WorkflowTemplateEntity.create({ id, name: slug.toUpperCase(), slug, steps, edges, entryStepId: steps[0]!.id, enabled });

const build = tpl('t-build', 'build', [step('implement'), step('tests')], [edge('i', 'implement', 'tests')]);
// QA ends on a step that only emits a verdict, with no edge out: inside QA
// alone the run would end there; composed, it must rejoin QA's exit (E5).
const qa = tpl('t-qa', 'qa', [step('review', { executorRef: 'qa-reviewer' })], []);
const full = tpl('t-full', 'full', [
  step('b', { executorType: 'workflow', executorRef: 'build' }),
  step('q', { executorType: 'workflow', executorRef: 'qa' }),
  step('done', { executorType: 'route', executorRef: '' }),
], [
  edge('b-q', 'b', 'q'),
  edge('ok', 'q', 'done'),
  edge('ko', 'q', 'b', { isDefault: false, conditionGroup: { match: 'all', clauses: [{ field: 'verdict', operator: 'eq', value: 'ko' }] } }),
]);

function harness(templates: WorkflowTemplateEntity[], verdicts: string[]) {
  let run: WorkflowRunEntity | null = null;
  const stepRuns: StepRunEntity[] = [];
  const queue: string[] = [];
  const executed: string[] = [];
  const comments: string[] = [];

  const templateStore = {
    getById: vi.fn(async (id: string) => templates.find((t) => t.id === id) ?? null),
    getAll: vi.fn(async () => templates),
  };
  const runStore = {
    getActiveByTicket: vi.fn(async () => null),
    getById: vi.fn(async () => run),
    save: vi.fn(async (r: WorkflowRunEntity) => { run = r; }),
  };
  const stepRunStore = {
    save: vi.fn(async (sr: StepRunEntity) => { if (!stepRuns.includes(sr)) stepRuns.push(sr); }),
    getLatestForStep: vi.fn(async (_run: string, stepId: string) =>
      stepRuns.filter((s) => s.stepId === stepId).sort((a, b) => b.attempt - a.attempt)[0] ?? null),
    getByWorkflowRun: vi.fn(async () => [...stepRuns]),
  };
  const orchestrator = { runStep: (_runId: string, stepId: string) => { queue.push(stepId); } };
  const eventBus = { emit: vi.fn() };
  const postComment = {
    execute: vi.fn(async (p: { body: string }) => { comments.push(p.body); return { comment: { id: `c${comments.length}` }, createdMentions: [] }; }),
  };
  let qaCalls = 0;
  const agent = {
    execute: vi.fn(async (input: { step: WorkflowStep }) => {
      executed.push(input.step.id);
      // Completed attempts are ordered by completedAt: keep them distinct.
      await new Promise((r) => setTimeout(r, 1));
      const output: StepOutput = input.step.executorRef === 'qa-reviewer'
        ? { schemaFields: { verdict: verdicts[Math.min(qaCalls++, verdicts.length - 1)] }, result: 'ok' }
        : { schemaFields: {}, result: 'ok' };
      return { output };
    }),
  };

  const runStep = new RunWorkflowStepUseCase({
    runStore: runStore as never, stepRunStore: stepRunStore as never, orchestrator: orchestrator as never,
    eventBus: eventBus as never,
    executors: {
      agent: agent as never, skill: {} as never, panel: {} as never, native: {} as never,
      human_gate: new HumanGateStepExecutor(postComment as never, eventBus as never),
      route: new RouteStepExecutor(), workflow: new WorkflowStepExecutor(stepRunStore as never),
    },
    submitDeliverable: { execute: vi.fn() } as never,
    postComment: postComment as never,
    agentEventStore: { setExecutionOutputs: vi.fn() } as never,
  });
  const create = new CreateWorkflowRunUseCase(
    templateStore as never, runStore as never, orchestrator as never, eventBus as never, postComment as never,
  );

  const retry = new RetryStepUseCase(
    runStore as never,
    { ...stepRunStore, getById: async (id: string) => stepRuns.find((s) => s.id === id) ?? null } as never,
    orchestrator as never,
    { cancelExecution: vi.fn() } as never,
  );

  const gates = new ResolveHumanGateUseCase(
    runStore as never, stepRunStore as never, orchestrator as never, eventBus as never, postComment as never,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
  );
  const stepRunGetById = async (id: string) => stepRuns.find((s) => s.id === id) ?? null;
  (stepRunStore as Record<string, unknown>)['getById'] = vi.fn(stepRunGetById);

  return {
    create, stepRuns, executed, comments, runStore,
    /** A human picks an outcome on the gate the run is waiting on. */
    resolveGate: async (outcome: string) => {
      const gate = stepRuns.at(-1)!;
      await gates.execute({ workflowRunId: run!.id, stepRunId: gate.id, outcome });
    },
    /** The Restart button on the parked step: re-enters it directly, not via an edge. */
    restartParkedStep: () => retry.execute({ workflowRunId: run!.id, stepRunId: stepRuns.at(-1)!.id }),
    get run() { return run!; },
    async drain() {
      for (let guard = 0; queue.length > 0 && guard < 200; guard++) {
        await runStep.execute({ workflowRunId: run!.id, stepId: queue.shift()! });
      }
    },
  };
}

describe('a composed workflow at launch', () => {
  it('runs the children in place, as one run, and branches on what the child concluded (ko → back to Build)', async () => {
    const h = harness([build, qa, full], ['ko', 'ok']);
    const run = await h.create.execute({ ticketId: 't-1', templateId: 't-full', triggeredBy: 'nas', triggeredFrom: 'api' });
    expect(run.currentStepId).toBe('b::implement');
    expect(run.templateSnapshot.subworkflows?.map((s) => s.stepId)).toEqual(['b', 'q']);

    await h.drain();

    expect(h.executed).toEqual([
      'b::implement', 'b::tests', 'q::review', // first lap: QA says ko
      'b::implement', 'b::tests', 'q::review', // back to Build's entry, QA says ok
    ]);
    expect(h.run.status).toBe('completed');
    expect(h.stepRuns.filter((s) => s.stepId === 'done')).toHaveLength(1);
  });

  it('refuses to create the run when an included workflow is disabled, and says so on the ticket', async () => {
    const h = harness([build, tpl('t-qa', 'qa', [step('review')], [], false), full], ['ok']);
    await expect(h.create.execute({ ticketId: 't-1', templateId: 't-full', triggeredBy: 'nas', triggeredFrom: 'mention:m' }))
      .rejects.toBeInstanceOf(SubworkflowExpansionFailedError);
    expect(h.runStore.save).not.toHaveBeenCalled();
    expect(h.comments).toEqual([expect.stringMatching(/^❌ Cannot start .*FULL.*sub-workflow "qa" is disabled/)]);
  });
});

describe('a human gate inside a sub-workflow', () => {
  // Spec ends on a gate with no edge out, as in "Spec Dev PR": approving hands
  // over to Build, refusing must stop the whole run — not start Build.
  const spec = tpl('t-spec', 'spec', [
    step('write'),
    step('check', { executorType: 'human_gate', executorRef: '', humanGateOutcomes: ['approve', 'reject'] }),
  ], [edge('w', 'write', 'check')]);
  const delivery = tpl('t-delivery', 'delivery', [
    step('s', { executorType: 'workflow', executorRef: 'spec' }),
    step('b', { executorType: 'workflow', executorRef: 'build' }),
  ], [edge('s-b', 's', 'b')]);

  it.each([
    ['reject', ['s::write'], 0],
    ['approve', ['s::write', 'b::implement', 'b::tests'], 1],
  ])('%s → executed %j', async (outcome, expected, buildExits) => {
    const h = harness([spec, build, delivery], ['ok']);
    await h.create.execute({ ticketId: 't-1', templateId: 't-delivery', triggeredBy: 'nas', triggeredFrom: 'api' });
    await h.drain();
    expect(h.stepRuns.at(-1)!.stepId).toBe('s::check');

    await h.resolveGate(outcome);
    await h.drain();

    expect(h.executed).toEqual(expected);
    expect(h.run.status).toBe('completed');
    expect(h.stepRuns.filter((sr) => sr.stepId === 'b')).toHaveLength(buildExits);
  });
});

describe(`loop guard (${MAX_STEP_VISITS_PER_RUN} visits per step)`, () => {
  it('parks the run for a human instead of entering the same step a 6th time — no agent spawned', async () => {
    const h = harness([build, qa, full], ['ko']); // QA never converges
    await h.create.execute({ ticketId: 't-1', templateId: 't-full', triggeredBy: 'nas', triggeredFrom: 'api' });
    await h.drain();

    expect(h.executed.filter((id) => id === 'b::implement')).toHaveLength(MAX_STEP_VISITS_PER_RUN);
    expect(h.run.status).toBe('needs_review');
    expect(h.run.currentStepId).toBe('b::implement');
    const parked = h.stepRuns.at(-1)!;
    expect(parked.stepId).toBe('b::implement');
    expect(parked.status).toBe('needs_review');
    expect(parked.output?.schemaFields[LOOP_GUARD_FIELD]).toBe(true);
    expect(h.comments.at(-1)).toMatch(/Loop detected: step \*\*BUILD › implement\*\* was reached 5 times/);
  });

  it('gives a fresh allowance once a human restarts the parked step', async () => {
    const h = harness([build, qa, full], ['ko']);
    await h.create.execute({ ticketId: 't-1', templateId: 't-full', triggeredBy: 'nas', triggeredFrom: 'api' });
    await h.drain();
    const before = h.executed.length;

    await h.restartParkedStep();
    await h.drain();

    const lapsAfter = h.executed.slice(before).filter((id) => id === 'b::implement').length;
    expect(lapsAfter).toBe(MAX_STEP_VISITS_PER_RUN);
    expect(h.run.status).toBe('needs_review');
  });
});

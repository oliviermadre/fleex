import { describe, it, expect, vi } from 'vitest';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';
import { RoutineEntity } from '../../src/domain/entities/routine.entity.js';
import { CreateWorkflowRunUseCase } from '../../src/application/use-cases/create-workflow-run.js';
import { RunRoutineUseCase } from '../../src/application/use-cases/run-routine.js';
import { CreateRoutineUseCase } from '../../src/application/use-cases/create-routine.js';
import {
  RoutineRunAlreadyActiveError,
  RoutineTriggerNotSupportedError,
} from '../../src/domain/errors.js';

const snapshot = {
  name: 'X', emoji: '', entryStepId: 'triage', edges: [],
  steps: [{ id: 'triage', name: 'Triage', executorType: 'agent' as const, executorRef: 'p', position: { x: 0, y: 0 } }],
};

const template = WorkflowTemplateEntity.create({
  id: 'tmpl-1', name: 'X', slug: 'x', steps: snapshot.steps, edges: [], entryStepId: 'triage',
});

function makeRoutine() {
  return RoutineEntity.create({
    id: 'r-1', name: 'Daily recap', templateId: 'tmpl-1',
    subject: { repos: ['acme/api'], brief: 'Summarise yesterday' },
  });
}

describe('workflow run anchoring', () => {
  // The "exactly one anchor" rule is the whole point of the routine model: a run
  // with neither anchor is unreachable from any screen, a run with both would
  // show up twice and race two timelines. SQLite cannot express the CHECK, so
  // this invariant only holds if the entity enforces it.
  it('rejects a run with neither a ticket nor a routine', () => {
    expect(() => WorkflowRunEntity.create({
      id: 'run-1', templateId: 'tmpl-1', templateSnapshot: snapshot,
      triggeredBy: '@john', triggeredFrom: 'api',
    })).toThrow(/exactly one of ticketId \/ routineId/);
  });

  it('rejects a run anchored to both a ticket and a routine', () => {
    expect(() => WorkflowRunEntity.create({
      id: 'run-1', ticketId: 't-1', routineId: 'r-1',
      templateId: 'tmpl-1', templateSnapshot: snapshot,
      triggeredBy: '@john', triggeredFrom: 'api',
    })).toThrow(/exactly one of ticketId \/ routineId/);
  });

  it('accepts a routine-anchored run and reports it as one', () => {
    const run = WorkflowRunEntity.create({
      id: 'run-1', routineId: 'r-1', subjectSnapshot: { repos: ['acme/api'] },
      templateId: 'tmpl-1', templateSnapshot: snapshot,
      triggeredBy: '@john', triggeredFrom: 'routine',
    });
    expect(run.ticketId).toBeNull();
    expect(run.isRoutineRun()).toBe(true);
  });
});

describe('RunRoutineUseCase', () => {
  function deps(activeRun: unknown = null) {
    const routine = makeRoutine();
    const routineStore = { getById: vi.fn().mockResolvedValue(routine), save: vi.fn() };
    const runStore = {
      getActiveByTicket: vi.fn().mockResolvedValue(null),
      getActiveByRoutine: vi.fn().mockResolvedValue(activeRun),
      save: vi.fn(),
    };
    const createRun = new CreateWorkflowRunUseCase(
      { getById: vi.fn().mockResolvedValue(template) } as never,
      runStore as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
      { execute: vi.fn() } as never,
    );
    return { routine, routineStore, runStore, uc: new RunRoutineUseCase(routineStore as never, createRun) };
  }

  it('freezes the routine subject into the run', async () => {
    // Editing a routine while it runs must not retarget the in-flight run —
    // the snapshot is what makes the run's history readable after the fact.
    const { routine, uc } = deps();
    const run = await uc.execute({ routineId: 'r-1', triggeredBy: '@john', triggeredFrom: 'routine' });

    expect(run.routineId).toBe('r-1');
    expect(run.subjectSnapshot).toEqual(routine.subject);
    expect(run.ticketId).toBeNull();
  });

  it('records the run on the routine so the list can show "last run"', async () => {
    const { routine, routineStore, uc } = deps();
    const run = await uc.execute({ routineId: 'r-1', triggeredBy: '@john', triggeredFrom: 'routine' });

    expect(routine.lastRunId).toBe(run.id);
    expect(routineStore.save).toHaveBeenCalledOnce();
  });

  it('refuses to launch while a run is already active on that routine', async () => {
    // Two concurrent runs would race on the same routine workspace.
    const { uc } = deps({ id: 'run-existing' });
    await expect(uc.execute({ routineId: 'r-1', triggeredBy: '@john', triggeredFrom: 'routine' }))
      .rejects.toBeInstanceOf(RoutineRunAlreadyActiveError);
  });

  it('posts no ticket comment for a routine run', async () => {
    // A routine has no timeline: its step_runs are its timeline. Posting would
    // require a ticket that does not exist.
    const routineStore = { getById: vi.fn().mockResolvedValue(makeRoutine()), save: vi.fn() };
    const postComment = { execute: vi.fn() };
    const createRun = new CreateWorkflowRunUseCase(
      { getById: vi.fn().mockResolvedValue(template) } as never,
      { getActiveByRoutine: vi.fn().mockResolvedValue(null), save: vi.fn() } as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
      postComment as never,
    );
    const uc = new RunRoutineUseCase(routineStore as never, createRun);

    await uc.execute({ routineId: 'r-1', triggeredBy: '@john', triggeredFrom: 'routine' });
    expect(postComment.execute).not.toHaveBeenCalled();
  });
});

describe('CreateRoutineUseCase', () => {
  it('rejects a scheduled trigger while no scheduler exists', async () => {
    // Persisting a `cron` routine now would arm nothing: the user would believe
    // it fires. Better a loud 422 than a routine that silently never runs.
    const uc = new CreateRoutineUseCase(
      { getBySlug: vi.fn().mockResolvedValue(null), save: vi.fn() } as never,
      { getById: vi.fn().mockResolvedValue(template) } as never,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    );

    await expect(uc.execute({
      name: 'Daily recap', templateId: 'tmpl-1',
      trigger: { kind: 'cron', cron: '0 9 * * *', timezone: 'Europe/Paris' },
    })).rejects.toBeInstanceOf(RoutineTriggerNotSupportedError);
  });
});

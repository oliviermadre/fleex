import { describe, it, expect, vi } from 'vitest';
import { RoutineEntity } from '../../src/domain/entities/routine.entity.js';
import { RunRoutineUseCase, synthesizePrimitiveSnapshot } from '../../src/application/use-cases/run-routine.js';
import { CreateWorkflowRunUseCase } from '../../src/application/use-cases/create-workflow-run.js';
import { assertRoutineTargetExists } from '../../src/application/services/routine-target-validator.js';
import { RoutineTargetNotFoundError, WorkflowTemplateNotFoundError } from '../../src/domain/errors.js';
import { rowToTarget, targetToColumns } from '../../src/infrastructure/adapters/routine-target-mapping.js';

function makeRoutine(target: { kind: 'workflow' | 'agent' | 'skill' | 'panel'; ref: string }) {
  return RoutineEntity.create({
    id: 'r-1', name: 'Daily digest', emoji: '📰', target,
    subject: { repos: [], brief: 'Summarise the day' },
  });
}

describe('synthesizePrimitiveSnapshot', () => {
  // A primitive-target routine must NOT grow its own execution pipeline: the
  // whole design is that a fabricated one-step snapshot rides the existing
  // workflow machinery (orchestrator, history, deliverable attribution).
  it('fabricates a one-step snapshot whose step references the primitive by name', () => {
    const snapshot = synthesizePrimitiveSnapshot(makeRoutine({ kind: 'skill', ref: 'weekly-report' }));

    expect(snapshot.entryStepId).toBe('primitive');
    expect(snapshot.edges).toEqual([]);
    expect(snapshot.steps).toHaveLength(1);
    expect(snapshot.steps[0]).toMatchObject({
      id: 'primitive',
      executorType: 'skill',
      executorRef: 'weekly-report',
    });
    // The run is named after the routine, so history reads "📰 Daily digest",
    // not an opaque synthetic label.
    expect(snapshot.name).toBe('Daily digest');
    expect(snapshot.emoji).toBe('📰');
  });
});

describe('RunRoutineUseCase with a primitive target', () => {
  function makeUc(routine: RoutineEntity) {
    const routineStore = { getById: vi.fn().mockResolvedValue(routine), save: vi.fn() };
    const templateStore = { getById: vi.fn().mockResolvedValue(null) };
    const createRun = new CreateWorkflowRunUseCase(
      templateStore as never,
      { getActiveByRoutine: vi.fn().mockResolvedValue(null), save: vi.fn() } as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
      { execute: vi.fn() } as never,
    );
    return { uc: new RunRoutineUseCase(routineStore as never, createRun), templateStore };
  }

  it('creates a synthetic run (null templateId) without touching the template store', async () => {
    // A null templateId is the marker of a synthetic run; hitting the template
    // store here would 404 since the ref is a persona name, not a template id.
    const { uc, templateStore } = makeUc(makeRoutine({ kind: 'agent', ref: 'builder' }));
    const run = await uc.execute({ routineId: 'r-1', triggeredBy: '@john', triggeredFrom: 'routine' });

    expect(run.templateId).toBeNull();
    expect(run.templateSnapshot.steps[0]?.executorType).toBe('agent');
    expect(run.templateSnapshot.steps[0]?.executorRef).toBe('builder');
    expect(templateStore.getById).not.toHaveBeenCalled();
  });
});

describe('CreateWorkflowRunUseCase templateId/templateSnapshot exclusivity', () => {
  function makeUc() {
    return new CreateWorkflowRunUseCase(
      { getById: vi.fn().mockResolvedValue(null) } as never,
      { getActiveByRoutine: vi.fn().mockResolvedValue(null), save: vi.fn() } as never,
      { runStep: vi.fn() } as never,
      { emit: vi.fn() } as never,
      { execute: vi.fn() } as never,
    );
  }

  // Silent precedence between the two sources would mask caller bugs — a run
  // built from the wrong template is far worse than a loud throw.
  it('rejects neither templateId nor templateSnapshot', async () => {
    await expect(makeUc().execute({
      routineId: 'r-1', templateId: null,
      triggeredBy: '@john', triggeredFrom: 'routine',
    })).rejects.toThrow(/exactly one of templateId \/ templateSnapshot/);
  });

  it('rejects both templateId and templateSnapshot', async () => {
    await expect(makeUc().execute({
      routineId: 'r-1', templateId: 'tmpl-1',
      templateSnapshot: synthesizePrimitiveSnapshot(makeRoutine({ kind: 'panel', ref: 'archi' })),
      triggeredBy: '@john', triggeredFrom: 'routine',
    })).rejects.toThrow(/exactly one of templateId \/ templateSnapshot/);
  });
});

describe('assertRoutineTargetExists', () => {
  function stores(overrides: Partial<Record<'template' | 'persona' | 'skill' | 'panel', unknown>> = {}) {
    return {
      templateStore: { getById: vi.fn().mockResolvedValue(overrides.template ?? null) },
      personaStore: { getByName: vi.fn().mockResolvedValue(overrides.persona ?? null) },
      skillStore: { getByCommandName: vi.fn().mockResolvedValue(overrides.skill ?? null) },
      panelStore: { getByName: vi.fn().mockResolvedValue(overrides.panel ?? null) },
    } as never;
  }

  // A routine resolves its target by name at every launch, so a typo'd ref
  // would only surface as a failed run days later. Write-time validation turns
  // that into an immediate 404 the author sees.
  it('rejects an unknown agent ref', async () => {
    await expect(assertRoutineTargetExists({ kind: 'agent', ref: 'ghost' }, stores()))
      .rejects.toBeInstanceOf(RoutineTargetNotFoundError);
  });

  it('rejects an unknown skill ref', async () => {
    await expect(assertRoutineTargetExists({ kind: 'skill', ref: 'ghost' }, stores()))
      .rejects.toBeInstanceOf(RoutineTargetNotFoundError);
  });

  it('rejects an unknown panel ref', async () => {
    await expect(assertRoutineTargetExists({ kind: 'panel', ref: 'ghost' }, stores()))
      .rejects.toBeInstanceOf(RoutineTargetNotFoundError);
  });

  it('keeps the workflow-specific error for unknown templates', async () => {
    await expect(assertRoutineTargetExists({ kind: 'workflow', ref: 'nope' }, stores()))
      .rejects.toBeInstanceOf(WorkflowTemplateNotFoundError);
  });

  it('passes when the primitive exists', async () => {
    await expect(assertRoutineTargetExists(
      { kind: 'agent', ref: 'builder' },
      stores({ persona: { id: 'p-1', name: 'builder' } }),
    )).resolves.toBeUndefined();
  });
});

describe('routine target column mapping', () => {
  // Workflow refs must keep living in `template_id`: it carries the FK and the
  // ON DELETE CASCADE. Primitive refs have no FK and live in `target_ref`.
  it('round-trips a workflow target through template_id', () => {
    const cols = targetToColumns({ kind: 'workflow', ref: 'tmpl-1' });
    expect(cols).toEqual({ template_id: 'tmpl-1', target_kind: 'workflow', target_ref: null });
    expect(rowToTarget(cols)).toEqual({ kind: 'workflow', ref: 'tmpl-1' });
  });

  it('round-trips a primitive target through target_ref', () => {
    const cols = targetToColumns({ kind: 'skill', ref: 'weekly-report' });
    expect(cols).toEqual({ template_id: null, target_kind: 'skill', target_ref: 'weekly-report' });
    expect(rowToTarget(cols)).toEqual({ kind: 'skill', ref: 'weekly-report' });
  });

  it('reads a pre-migration row (no target columns) as a workflow target', () => {
    // Rows written before migration 027 have only template_id — they must keep
    // resolving exactly as before.
    expect(rowToTarget({ template_id: 'tmpl-1', target_kind: null, target_ref: null }))
      .toEqual({ kind: 'workflow', ref: 'tmpl-1' });
  });
});

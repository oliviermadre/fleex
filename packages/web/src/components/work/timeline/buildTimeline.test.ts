import { describe, it, expect } from 'vitest';
import { buildTimeline, classifyExecution, type TimelineEvent } from './buildTimeline';
import {
  NOW, RUN, STEP_RUNS, activity, at, comment, deliverable, emptySources, execution, fixture591, mention, stepRun,
} from './timeline.fixture';

const byId = (events: TimelineEvent[], id: string) => {
  const e = events.find((x) => x.id === id);
  if (!e) throw new Error(`no event ${id}`);
  return e;
};

describe('buildTimeline — status zones', () => {
  it('opens on the first move\'s `from`, then one zone per move, the last one running to now', () => {
    const m = buildTimeline(fixture591(), NOW);
    expect(m.zones.map((z) => z.status)).toEqual(['backlog', 'todo', 'doing']);
    expect(m.zones[0]!.from).toBe(new Date(at(4, 41)).getTime());
    expect(m.zones[1]!.from).toBe(new Date(at(4, 50)).getTime());
    expect(m.zones[1]!.actorName).toBe('@PM');
    expect(m.zones[2]!.to).toBe(NOW);
    // Each zone is headed by a status pill in the status lane.
    expect(m.events.filter((e) => e.kind === 'status').map((e) => e.lane)).toEqual(['status', 'status', 'status']);
  });

  it('without any move, the zone is the ticket\'s current status', () => {
    const m = buildTimeline(emptySources(), NOW);
    expect(m.zones).toHaveLength(1);
    expect(m.zones[0]!.status).toBe('todo');
  });

  it('adds an approximate zone when the current status was reached by an untracked move (old Kanban drag)', () => {
    const src = emptySources();
    src.ticket = { ...src.ticket, status: 'reviewing', statusChangedAt: at(9, 30) };
    src.activities = [activity({ id: 'm', action: 'moved', createdAt: at(9, 10), changes: { status: { from: 'todo', to: 'doing' } } })];
    const m = buildTimeline(src, NOW);
    expect(m.zones.map((z) => [z.status, z.approximate])).toEqual([['todo', false], ['doing', false], ['reviewing', true]]);
    expect(m.zones[2]!.from).toBe(new Date(at(9, 30)).getTime());
  });

  it('inserts a gap zone when two moves do not chain (a move in between was never logged)', () => {
    const src = emptySources();
    src.ticket = { ...src.ticket, status: 'done' };
    src.activities = [
      activity({ id: 'm1', action: 'moved', createdAt: at(9, 10), changes: { status: { from: 'todo', to: 'doing' } } }),
      activity({ id: 'm2', action: 'moved', createdAt: at(9, 30), changes: { status: { from: 'reviewing', to: 'done' } } }),
    ];
    const m = buildTimeline(src, NOW);
    expect(m.zones.map((z) => z.status)).toEqual(['todo', 'doing', 'reviewing', 'done']);
    expect(m.zones[2]!.approximate).toBe(true);
    expect(m.zones[2]!.from).toBe(new Date(at(9, 20)).getTime());
  });
});

describe('buildTimeline — flat workflow history', () => {
  const m = buildTimeline(fixture591(), NOW);
  const steps = m.events.filter((e) => e.kind === 'step');

  it('draws every executed step run in time order, replays included, and never a skipped/queued one', () => {
    expect(steps.map((s) => s.label)).toEqual([
      'Triage', 'Spec', 'Valider la spec', 'Spec', 'Valider la spec', 'Implémentation', 'Tests CI',
      'Implémentation', 'Tests CI', 'Panel review', 'Merge',
    ]);
    expect(m.events.some((e) => e.id === 'step:sr-skipped')).toBe(false);
  });

  it('merges several runs into one chronology', () => {
    const src = fixture591();
    const run2 = { ...RUN, id: 'run-2', startedAt: at(6, 0), status: 'completed' as const };
    src.runs = [...src.runs, { run: run2, stepRuns: [stepRun({ id: 'sr-other', workflowRunId: 'run-2', stepId: 'triage', startedAt: at(6, 1) })] }];
    const labels = buildTimeline(src, NOW).events.filter((e) => e.kind === 'step').map((e) => e.id);
    // 06:01 falls between Spec (05:50) and the gate (06:13) of the other run.
    expect(labels.indexOf('step:sr-other')).toBe(labels.indexOf('step:sr-gate-1') - 1);
    expect(labels.indexOf('step:sr-other')).toBe(labels.indexOf('step:sr-spec-1') + 1);
  });

  it('badges replays with their attempt', () => {
    expect(byId(m.events, 'step:sr-spec-2').attempt).toBe(2);
    expect(byId(m.events, 'step:sr-spec-1').attempt).toBe(1);
  });

  it('notes a refused gate (it sent the run back) as ko, with the human\'s reason', () => {
    expect(byId(m.events, 'step:sr-gate-1').note).toEqual({ text: 'refusé : risques non couverts', tone: 'ko' });
    expect(byId(m.events, 'step:sr-gate-2').note).toEqual({ text: 'validé', tone: 'ok' });
  });

  it('notes a failed CI with its outcome, and a green one with the edge it took', () => {
    expect(byId(m.events, 'step:sr-ci-1').note).toEqual({ text: 'rouge : 3 échecs', tone: 'ko' });
    expect(byId(m.events, 'step:sr-ci-2').note).toEqual({ text: 'vert', tone: 'ok' });
  });

  it('labels who ran each step and marks gates', () => {
    expect(byId(m.events, 'step:sr-impl-1').sub).toBe('@Dev');
    expect(byId(m.events, 'step:sr-gate-1').gate).toBe(true);
    expect(byId(m.events, 'step:sr-review').tooltip.rows).toContainEqual(['Membres', '@Archi, @Sécu, @UX']);
    expect(byId(m.events, 'step:sr-merge').state).toBe('pending');
  });

  it('falls back to the step id when the snapshot lost the step', () => {
    const src = fixture591();
    src.runs = [{ run: RUN, stepRuns: [stepRun({ id: 'sr-ghost', stepId: 'gone', startedAt: at(6, 0) })] }];
    const ghost = byId(buildTimeline(src, NOW).events, 'step:sr-ghost');
    expect(ghost.label).toBe('gone');
    expect(ghost.glyph).toEqual({ type: 'executor', executor: 'native' });
  });
});

describe('buildTimeline — out-of-workflow runs', () => {
  it('shows a mention run once (step executions are not doubled) with its mode and trigger', () => {
    const m = buildTimeline(fixture591(), NOW);
    const runs = m.events.filter((e) => e.kind === 'run');
    expect(runs.map((r) => r.id)).toEqual(['run:x-pm']);
    expect(runs[0]!.label).toBe('@PM · talk');
    expect(runs[0]!.sub).toBe('clarifie le besoin stp');
  });

  it('groups every member execution of one panel mention into a single node', () => {
    const src = emptySources();
    src.names.panels['p-1'] = { name: 'Archi', members: ['A', 'B', 'C'] };
    src.names.personas = { pa: 'A', pb: 'B' };
    src.executions = [
      execution({ id: 'e1', personaId: 'pa', mentionId: 'panel:p-1:xyz', startedAt: at(9, 5) }),
      execution({ id: 'e2', personaId: 'pb', mentionId: 'panel:p-1:xyz', startedAt: at(9, 4), status: 'running' }),
    ];
    const runs = buildTimeline(src, NOW).events.filter((e) => e.kind === 'run');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.label).toBe('Panel · Archi');
    expect(runs[0]!.state).toBe('running');
    expect(runs[0]!.at).toBe(new Date(at(9, 4)).getTime());
    expect(runs[0]!.tooltip.rows).toContainEqual(['Membres', '@A, @B, @C']);
  });

  it('classifies synthetic mention ids like the server does', () => {
    expect(classifyExecution({ mentionId: 'skill:abc', source: 'sdk' }, null)).toBe('skill');
    expect(classifyExecution({ mentionId: 'panel:p:r', source: 'sdk' }, null)).toBe('panel');
    expect(classifyExecution({ mentionId: 'workflow:x', source: 'sdk' }, null)).toBe('workflow');
    expect(classifyExecution({ mentionId: 'whatever', source: 'cli' }, null)).toBe('cli');
    expect(classifyExecution({ mentionId: 'm1', source: 'sdk' }, { targetType: 'skill' })).toBe('skill');
    expect(classifyExecution({ mentionId: 'm1', source: 'sdk' }, null)).toBe('persona');
  });
});

describe('buildTimeline — attachments', () => {
  const m = buildTimeline(fixture591(), NOW);

  it('attaches deliverables to the step (stepRunId) or run (mentionId) that produced them', () => {
    expect(byId(m.events, 'deliv:d-spec').parentId).toBe('step:sr-spec-2');
    expect(byId(m.events, 'deliv:d-brief').parentId).toBe('run:x-pm');
  });

  it('attaches a gate decision comment to the gate it resolved', () => {
    expect(byId(m.events, 'comment:c-gate').parentId).toBe('step:sr-gate-2');
    expect(byId(m.events, 'comment:c-last').parentId).toBeNull();
  });

  it('attaches a comment a run produced (execution.commentId)', () => {
    const src = fixture591();
    src.executions = src.executions.map((e) => (e.id === 'x-impl-1' ? { ...e, commentId: 'c-last' } : e));
    expect(byId(buildTimeline(src, NOW).events, 'comment:c-last').parentId).toBe('step:sr-impl-1');
  });

  it('attaches via execution.deliverableId as a last resort', () => {
    const src = emptySources();
    src.executions = [execution({ id: 'x1', startedAt: at(9, 1), deliverableId: 'd1' })];
    src.deliverables = [deliverable({ id: 'd1', createdAt: at(9, 3) })];
    expect(byId(buildTimeline(src, NOW).events, 'deliv:d1').parentId).toBe('run:x1');
  });

  it('flags unread deliverables', () => {
    expect(byId(m.events, 'deliv:d-code').glyph).toMatchObject({ unread: true });
    expect(byId(m.events, 'deliv:d-spec').glyph).toMatchObject({ unread: false });
  });
});

describe('buildTimeline — sessions & PRs', () => {
  const m = buildTimeline(fixture591(), NOW);

  it('lists every linked tmux session, live state when known, guessed type otherwise', () => {
    const cli = m.events.filter((e) => e.kind === 'cli');
    expect(cli).toHaveLength(4);
    expect(byId(m.events, 'cli:s-4').action).toEqual({ type: 'session', sessionId: 's-4' });
    expect(byId(m.events, 'cli:s-2').tooltip.rows).toContainEqual(['Statut', 'dead']);
    expect(byId(m.events, 'cli:s-3').glyph).toEqual({ type: 'cli', session: 'shell' });
    expect(byId(m.events, 'cli:s-1').tooltip.rows).toContainEqual(['Statut', 'inconnu']);
  });

  it('includes ingested CLI transcripts', () => {
    const src = emptySources();
    src.executions = [execution({ id: 'cli-1', source: 'cli', startedAt: at(9, 5) })];
    const e = byId(buildTimeline(src, NOW).events, 'cli-t:cli-1');
    expect(e.lane).toBe('top');
    expect(e.action).toMatchObject({ type: 'execution', executionId: 'cli-1' });
  });

  it('dates a PR by its GitHub opening, attached to the latest agent/native step before it', () => {
    const pr = byId(m.events, 'pr:oliviermadre/fleex#281');
    expect(pr.at).toBe(new Date(at(7, 46)).getTime());
    expect(pr.parentId).toBe('step:sr-ci-1');
    expect(pr.tooltip.rows).toContainEqual(['Branche', 'agent/591-import-slack']);
  });

  it('falls back to the link date, adds a merge event, and lists undatable PRs apart', () => {
    const src = fixture591();
    src.prDates = { 'oliviermadre/fleex#281': { createdAt: null, mergedAt: at(10, 0), branch: null } };
    src.prs = [...src.prs, { ref: 'o/r#9', label: 'r#9', url: '', state: null, title: null, additions: null, deletions: null }];
    const mm = buildTimeline(src, NOW);
    expect(byId(mm.events, 'pr:oliviermadre/fleex#281').tooltip.title).toBe('PR #281 liée');
    expect(byId(mm.events, 'pr-merged:oliviermadre/fleex#281').glyph).toMatchObject({ state: 'merged' });
    expect(mm.undatedPrs.map((p) => p.ref)).toEqual(['o/r#9']);
  });
});

describe('buildTimeline — the pending fork (the only future drawn)', () => {
  it('fans out a waiting gate\'s outcomes to their target steps, "Done" when the workflow ends', () => {
    const m = buildTimeline(fixture591(), NOW);
    expect(m.pendingFork).toEqual({
      anchorId: 'step:sr-merge',
      kind: 'gate',
      options: [
        { label: 'Done', hint: 'Merger', executor: null, done: true },
        { label: 'Implémentation', hint: 'Demander des changements', executor: 'agent', done: false },
      ],
    });
  });

  it('fans out the candidate edges of an ambiguous route', () => {
    const src = fixture591();
    src.runs = [{
      run: RUN,
      stepRuns: [stepRun({
        id: 'sr-r', stepId: 'ci', startedAt: at(9, 0), status: 'awaiting_routing',
        output: { schemaFields: {}, result: 'ok', routing: { candidateEdgeIds: ['e6', 'e7'] } },
      })],
    }];
    const f = buildTimeline(src, NOW).pendingFork!;
    expect(f.kind).toBe('route');
    expect(f.options.map((o) => [o.label, o.hint])).toEqual([['Implémentation', 'rouge'], ['Panel review', 'vert']]);
  });

  it('draws no fork for a merely running step, nor for a finished run', () => {
    const src = fixture591();
    src.runs = [{ run: RUN, stepRuns: STEP_RUNS.map((s) => (s.id === 'sr-merge' ? { ...s, status: 'running' as const } : s)) }];
    expect(buildTimeline(src, NOW).pendingFork).toBeNull();
    src.runs = [{ run: { ...RUN, status: 'completed' }, stepRuns: STEP_RUNS }];
    expect(buildTimeline(src, NOW).pendingFork).toBeNull();
  });
});

describe('buildTimeline — robustness', () => {
  it('an empty ticket still has its creation, its zone, and nothing else', () => {
    const m = buildTimeline(emptySources(), NOW);
    expect(m.events.map((e) => e.kind)).toEqual(['created', 'status']);
    expect(byId(m.events, 'created').label).toBe('Toi');
  });

  it('pulls future timestamps back to now', () => {
    const src = emptySources();
    src.comments = [comment({ id: 'c', body: 'x', createdAt: at(23, 0) })];
    expect(byId(buildTimeline(src, NOW).events, 'comment:c').at).toBe(NOW);
  });

  it('sorts equal timestamps created < status < … < comment', () => {
    const src = emptySources();
    src.comments = [comment({ id: 'c', body: 'x', createdAt: at(9, 0) })];
    src.executions = [execution({ id: 'x', startedAt: at(9, 0) })];
    src.mentions = [mention({ id: 'm-x', commentId: 'c' })];
    expect(buildTimeline(src, NOW).events.map((e) => e.kind)).toEqual(['created', 'status', 'run', 'comment']);
  });

  it('shows the date on the first spine event of a new day', () => {
    const src = emptySources();
    src.executions = [execution({ id: 'x', startedAt: at(8, 5, 30) })];
    const m = buildTimeline(src, new Date(2026, 8, 30, 12, 0).getTime());
    expect(byId(m.events, 'created').clock).toBe('09:00');
    expect(byId(m.events, 'run:x').clock).toBe('30/09 08:05');
  });
});

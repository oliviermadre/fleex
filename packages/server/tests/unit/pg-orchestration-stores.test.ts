import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PgConnection } from '../../src/infrastructure/adapters/pgsql/connection.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { PgWorkflowTemplateStore } from '../../src/infrastructure/adapters/pgsql/pg-workflow-template-store.adapter.js';
import { PgWorkflowRunStore } from '../../src/infrastructure/adapters/pgsql/pg-workflow-run-store.adapter.js';
import { PgStepRunStore } from '../../src/infrastructure/adapters/pgsql/pg-step-run-store.adapter.js';
import { PgRoutineStore } from '../../src/infrastructure/adapters/pgsql/pg-routine-store.adapter.js';
import { WorkflowTemplateEntity } from '../../src/domain/entities/workflow-template.entity.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';
import { RoutineEntity } from '../../src/domain/entities/routine.entity.js';

/**
 * WHY: these four adapters are the only ones whose SQLite twin cannot stand in
 * for them. The orchestration tables store their payloads as `JSONB` and their
 * instants as `TIMESTAMPTZ`, and `pg` hands both back already parsed — objects
 * where SQLite gives strings, `Date` where SQLite gives ISO text. A mapping that
 * looks correct beside its SQLite original still breaks at runtime, and nothing
 * in `tsc` catches it because every row is typed `any` at the driver boundary.
 *
 * Needs a real server: `FLEEX_TEST_PG_URL=postgresql://…` selects the database,
 * which the suite migrates and then leaves populated. Without it the file skips,
 * so a machine with no Postgres still runs a green suite.
 */
const url = process.env['FLEEX_TEST_PG_URL'];
const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe.skipIf(!url)('pgsql orchestration stores', () => {
  let conn: PgConnection;
  let templates: PgWorkflowTemplateStore;
  let runs: PgWorkflowRunStore;
  let steps: PgStepRunStore;
  let routines: PgRoutineStore;

  // A suffix keeps repeat runs against the same database independent — the
  // fixtures are never torn down, because a failed run is worth inspecting.
  const sfx = `-${Date.now().toString(36)}`;
  const id = (base: string): string => `${base}${sfx}`;

  const snapshot = {
    name: 'QA template',
    emoji: '🧪',
    steps: [{ id: 's1', name: 'step', executorType: 'agent' as const, executorRef: 'someone', position: { x: 1, y: 2 } }],
    edges: [],
    entryStepId: 's1',
  };

  beforeAll(async () => {
    conn = new PgConnection(url!);
    await conn.init();
    await runPendingMigrations('pgsql', conn, silent as never);
    templates = new PgWorkflowTemplateStore(conn);
    runs = new PgWorkflowRunStore(conn);
    steps = new PgStepRunStore(conn);
    routines = new PgRoutineStore(conn);

    const now = new Date().toISOString();
    await conn.query(
      'INSERT INTO boards (id,name,emoji,created_at,updated_at) VALUES ($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING',
      [id('b'), 'QA', '🧪', now],
    );
    await conn.query(
      `INSERT INTO tickets (id,board_id,title,description,status,priority,position,tags,links,created_at,updated_at,status_changed_at)
       VALUES ($1,$2,'QA ticket','','backlog','none',0,'[]','[]',$3,$3,$3) ON CONFLICT DO NOTHING`,
      [id('t'), id('b'), now],
    );
  }, 30_000);

  afterAll(async () => {
    await conn?.close();
  });

  it('reads a template back with its JSONB columns already parsed', async () => {
    const now = new Date();
    await templates.save(new WorkflowTemplateEntity(
      id('tpl'), 'QA template', id('qa-template'), '🧪', 'desc',
      snapshot.steps, [], 's1', true, now, now,
    ));

    const read = await templates.getBySlug(id('qa-template'));
    expect(read?.id).toBe(id('tpl'));
    // The whole point: `steps` must be an array, not the JSON string a
    // `JSON.parse`-everywhere mapping would have produced (or crashed on).
    expect(Array.isArray(read?.steps)).toBe(true);
    expect(read?.steps[0]?.position?.x).toBe(1);
    // BOOLEAN, not SQLite's 0/1 integer.
    expect(read?.enabled).toBe(true);
    expect((await templates.getEnabled()).some((t) => t.id === id('tpl'))).toBe(true);
  });

  it('keeps step history when a run is re-saved', async () => {
    // WHY: `save()` must upsert in place. A delete-then-insert would fire
    // `step_runs.workflow_run_id`'s ON DELETE CASCADE and erase the run's whole
    // history on every state transition.
    const run = WorkflowRunEntity.create({
      id: id('run'), ticketId: id('t'), templateId: id('tpl'),
      templateSnapshot: snapshot, triggeredBy: 'qa', triggeredFrom: 'test',
    });
    await runs.save(run);

    const sr = StepRunEntity.create({ id: id('sr'), workflowRunId: id('run'), stepId: 's1' });
    sr.start();
    await steps.save(sr);

    run.complete();
    await runs.save(run);

    expect(await steps.getByWorkflowRun(id('run'))).toHaveLength(1);
  });

  it('round-trips a run and a failed step through their JSONB payloads', async () => {
    const read = await runs.getById(id('run'));
    expect(read?.templateSnapshot.entryStepId).toBe('s1');
    expect(read?.startedAt).toBeInstanceOf(Date);
    expect((await runs.getByTicket(id('t'))).map((r) => r.id)).toContain(id('run'));

    const sr = (await steps.getById(id('sr')))!;
    sr.fail({ message: 'boom' });
    await steps.save(sr);

    const failed = await steps.getById(id('sr'));
    expect(failed?.output?.schemaFields?.['error']).toBe('boom');
  });

  it('gives back a routine trigger whose runAt is an ISO string, not a Date', async () => {
    // WHY: `run_at` is TIMESTAMPTZ, so `pg` returns a Date — but
    // `RoutineTrigger.runAt` is typed `string` and is compared and re-serialised
    // as one. Handing the Date straight through type-checks and then corrupts
    // the value the moment anything concatenates it.
    const runAt = new Date(Date.now() + 60_000).toISOString();
    const routine = RoutineEntity.create({
      id: id('r'), slug: id('qa-routine'), name: 'QA routine',
      target: { kind: 'workflow', ref: id('tpl') },
      subject: { repos: ['org/repo'], brief: 'hello' },
      trigger: { kind: 'once', runAt, timezone: 'Europe/Paris' },
    });
    routine.schedule(new Date(runAt));
    await routines.save(routine);

    const read = await routines.getById(id('r'));
    expect(read?.trigger.kind).toBe('once');
    expect(typeof (read!.trigger as { runAt: string }).runAt).toBe('string');
    expect(new Date((read!.trigger as { runAt: string }).runAt).getTime()).toBe(new Date(runAt).getTime());
    expect(read?.subject.brief).toBe('hello');
    expect(read?.target).toEqual({ kind: 'workflow', ref: id('tpl') });
    expect(read?.enabled).toBe(true);
  });

  it('lets exactly one claimant take a due occurrence', async () => {
    // WHY: the CAS is the whole multi-instance story. The witness is compared
    // as a `Z`-suffixed ISO string against a TIMESTAMPTZ column; if Postgres
    // failed to coerce it, every claim would silently lose and no routine would
    // ever fire.
    expect((await routines.getDue(new Date())).map((r) => r.id)).not.toContain(id('r'));
    expect((await routines.getDue(new Date(Date.now() + 120_000))).map((r) => r.id)).toContain(id('r'));

    const observed = (await routines.getById(id('r')))!.nextRunAt!;
    const bid = { id: id('r'), observedNextRunAt: observed, nextRunAt: null, disable: true, claimedAt: new Date() };

    expect(await routines.claimDue({ ...bid, claimedBy: 'instance-a' })).toBe(true);
    expect(await routines.claimDue({ ...bid, claimedBy: 'instance-b' })).toBe(false);

    const claimed = (await routines.getById(id('r')))!;
    expect(claimed.enabled).toBe(false); // disable applied in the same statement
    expect(claimed.lastClaimedBy).toBe('instance-a');

    // An ordinary edit must not clobber the claim — `save()` deliberately omits
    // the last_claimed_* columns.
    claimed.name = 'renamed';
    await routines.save(claimed);
    expect((await routines.getById(id('r')))?.lastClaimedBy).toBe('instance-a');
  });

  it('persists a routine-anchored run and still rejects a two-anchor row', async () => {
    await runs.save(WorkflowRunEntity.create({
      id: id('run2'), routineId: id('r'), templateId: null,
      templateSnapshot: { ...snapshot, name: 'synthetic' },
      subjectSnapshot: { repos: [] },
      triggeredBy: 'qa', triggeredFrom: 'schedule',
    }));
    expect((await runs.getActiveByRoutine(id('r')))?.id).toBe(id('run2'));

    // migration 025 adds this CHECK on every dialect that supports it; gate 4
    // will relax it deliberately, so a silent loss here would go unnoticed.
    await expect(conn.query(
      `INSERT INTO workflow_runs (id,ticket_id,routine_id,template_id,template_snapshot,status,triggered_by,triggered_from,started_at,created_at,updated_at)
       VALUES ($1,$2,$3,NULL,'{}','running','qa','test',NOW(),NOW(),NOW())`,
      [id('bad'), id('t'), id('r')],
    )).rejects.toThrow();
  });
});

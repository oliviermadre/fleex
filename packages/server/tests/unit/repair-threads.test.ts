import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import { EventBus } from '../../src/application/event-bus.js';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';
import { AssistantThreadListener } from '../../src/application/assistant-thread-listener.js';
import { StopRunUseCase } from '../../src/application/use-cases/stop-run.js';
import { CancelWorkflowRunUseCase } from '../../src/application/use-cases/cancel-workflow-run.js';
import { RepairThreadsUseCase, STALL_GRACE_MS, THREAD_REPAIR_INTERVAL_MS } from '../../src/application/use-cases/repair-threads.js';
import { ThreadRepairScheduler } from '../../src/domain/services/thread-repair-scheduler.js';
import { assistantThreadsRoutes } from '../../src/infrastructure/http/assistant-threads.routes.js';

/**
 * Lot 7b — surveillance. The world below is the real chain, minus the agents:
 * real bus, real `AssistantThreadListener`, real `StopRunUseCase` and
 * `CancelWorkflowRunUseCase`, real `RepairThreadsUseCase` and scheduler, over
 * in-memory stores and an injected clock. No route is registered unless a test
 * asks for it: whatever gets repaired here is repaired with no interface open.
 */

const MIN = 60_000;
const NOW = new Date('2026-11-11T12:00:00.000Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MIN);
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

interface FakeMention { id: string; ticketId: string; targetAgent: string; commentId: string; status: string; createdAt: Date; markFailed(): void; resolve(): void }
interface FakeExecution { id: string; mentionId: string | null; status: string; startedAt: string; lastEventAt: string | null; completedAt: string | null; stoppedBy?: string; stopReason?: string | null }
interface FakeStep { status: string; executionId: string | null; startedAt: Date | null; completedAt: Date | null; cancel(): void }
interface FakeRun { id: string; ticketId: string; triggeredFrom: string; status: string; cancelledBy: string | null; startedAt: Date; updatedAt: Date; routineId: null; isActive(): boolean; cancel(by: string | null): void }

function world(config: Record<string, unknown> = { workThreadsEnabled: true }) {
  const bus = new EventBus();
  const threads = new Map<string, AgentThreadEntity>();
  const mentions = new Map<string, FakeMention>();
  const executions: FakeExecution[] = [];
  const runs: FakeRun[] = [];
  const steps = new Map<string, FakeStep[]>();
  const turns: Array<{ ticketId: string; trigger: Record<string, unknown> }> = [];
  const errors: Array<{ msg: string; ctx: unknown }> = [];
  const updated: string[] = [];
  const queued = new Set<string>();
  const launched: string[] = [];
  const calls = { getOpen: 0 };
  bus.on('thread.updated', (e) => { updated.push((e as { threadId: string }).threadId); });

  const logger = { info() {}, warn() {}, debug() {}, error(msg: string, ctx: unknown) { errors.push({ msg, ctx }); } };
  const threadStore = {
    getById: async (id: string) => threads.get(id) ?? null,
    getByTicket: async (ticketId: string) => [...threads.values()].filter((t) => t.ticketId === ticketId),
    getByCurrentMentionId: async (id: string) => [...threads.values()].find((t) => t.currentMentionId === id) ?? null,
    // Same contract as the stores: running or waiting, across tickets.
    getOpen: async () => { calls.getOpen++; return [...threads.values()].filter((t) => t.status === 'running' || t.status === 'waiting'); },
    save: async (t: AgentThreadEntity) => { threads.set(t.id, t); },
    getRunsByThreadAndStatus: async () => [],
  };
  const mentionStore = {
    getById: async (id: string): Promise<FakeMention | null> => mentions.get(id) ?? null,
    getByTicket: async (ticketId: string) => [...mentions.values()].filter((m) => m.ticketId === ticketId),
    save: async () => {},
  };
  const agentEventStore = {
    getExecutionsByTicket: async () => executions,
    markExecutionsStopped: async (ids: string[], by: string, reason?: string | null) => {
      for (const e of executions) if (ids.includes(e.id)) { e.stoppedBy = by; e.stopReason = reason ?? null; }
    },
    updateExecutionsByIds: async (ids: string[], status: string) => {
      for (const e of executions) if (ids.includes(e.id)) { e.status = status; e.completedAt = NOW.toISOString(); }
    },
  };
  // Nothing runs in this process: the runs under test are the ones a dead or
  // silent process left behind. `execute` is the only way to launch anything.
  const executeAgent = {
    execute: async (personaId: string) => { launched.push(personaId); },
    isMentionQueued: (id: string) => queued.has(id),
    runningExecutionIdsForMention: () => [] as string[],
    cancelExecutionForMention: async () => false,
    cancelExecution: async () => false,
    mentionOfRunningExecution: () => undefined,
  };
  const workflowRunStore = {
    getById: async (id: string) => runs.find((r) => r.id === id) ?? null,
    getByTicket: async (ticketId: string) => runs.filter((r) => r.ticketId === ticketId),
    save: async () => {},
  };
  const stepRunStore = { getByWorkflowRun: async (id: string) => steps.get(id) ?? [], save: async () => {} };
  const runAssistantTurn = {
    execute: async (p: { ticketId: string; trigger: Record<string, unknown> }) => { turns.push(p); },
    workflowRunOf: async (t: AgentThreadEntity) => runs.find((r) => r.triggeredFrom === `mention:${t.currentMentionId}`) ?? null,
  };
  const stopRun = new StopRunUseCase({
    executeAgent: executeAgent as never, agentEventStore: agentEventStore as never, threadStore: threadStore as never,
    mentionStore: mentionStore as never, workflowRunStore: workflowRunStore as never, stepRunStore: stepRunStore as never,
    eventBus: bus, logger: logger as never,
  });
  stopRun.cancelWorkflowRun = new CancelWorkflowRunUseCase(workflowRunStore as never, stepRunStore as never, executeAgent as never, bus);
  new AssistantThreadListener({
    eventBus: bus, threadStore: threadStore as never, commentStore: { getById: async () => null } as never,
    runAssistantTurn: runAssistantTurn as never, logger: logger as never, workflowRunStore: workflowRunStore as never,
  }).register();

  const deps = {
    threadStore, mentionStore, commentStore: { getById: async () => null, getByTicket: async () => [] },
    ticketStore: { getTicketById: async () => null, saveTicket: async () => {} },
    agentEventStore, executeAgent, runAssistantTurn, stopRun, stepRunStore,
    config: { get: () => config }, eventBus: bus, logger, now: () => NOW,
  };
  const repair = new RepairThreadsUseCase(deps as never);
  const scheduler = new ThreadRepairScheduler(repair, () => config['workThreadsEnabled'] === true, logger as never);

  function addThread(id: string, opts: { targetType?: 'agent' | 'skill' | 'panel' | 'workflow'; mention?: string; mentionStatus?: string; sinceMin?: number } = {}) {
    const mentionId = opts.mention ?? `m-${id}`;
    const t = AgentThreadEntity.create({ id, ticketId: 't1', personaId: `p-${id}`, personaName: 'builder', assistantPersonaId: 'pa', brief: 'b', forwardedContext: [], targetType: opts.targetType ?? 'agent' });
    t.openTurn(mentionId);
    // The thread was put to work `sinceMin` minutes ago.
    t.updatedAt = ago(opts.sinceMin ?? 0);
    threads.set(id, t);
    const m: FakeMention = {
      id: mentionId, ticketId: 't1', targetAgent: 'builder', commentId: `c-${id}`, status: opts.mentionStatus ?? 'acknowledged', createdAt: t.updatedAt,
      markFailed() { if (this.status === 'pending' || this.status === 'acknowledged') this.status = 'failed'; },
      resolve() { this.status = 'resolved'; },
    };
    mentions.set(mentionId, m);
    return { thread: t, mention: m };
  }
  function addExecution(id: string, mentionId: string | null, startedMin: number, lastEventMin: number | null): FakeExecution {
    const e: FakeExecution = { id, mentionId, status: 'running', startedAt: ago(startedMin).toISOString(), lastEventAt: lastEventMin === null ? null : ago(lastEventMin).toISOString(), completedAt: null };
    executions.push(e);
    return e;
  }
  function addRun(id: string, mentionId: string, status: string, updatedMin: number): FakeRun {
    const r: FakeRun = {
      id, ticketId: 't1', triggeredFrom: `mention:${mentionId}`, status, cancelledBy: null, startedAt: ago(updatedMin), updatedAt: ago(updatedMin), routineId: null,
      isActive() { return this.status === 'running' || this.status === 'needs_review'; },
      cancel(by) { this.status = 'cancelled'; this.cancelledBy = by; },
    };
    runs.push(r);
    return r;
  }
  function addStep(runId: string, status: string, executionId: string | null, startedMin: number): FakeStep {
    const s: FakeStep = { status, executionId, startedAt: ago(startedMin), completedAt: null, cancel() { this.status = 'cancelled'; } };
    steps.set(runId, [...(steps.get(runId) ?? []), s]);
    return s;
  }
  return { bus, threads, mentions, executions, turns, errors, updated, queued, launched, calls, deps, repair, scheduler, config, mentionStore, addThread, addExecution, addRun, addStep };
}

afterEach(() => { vi.useRealTimers(); });

describe('thread surveillance — a stuck thread is repaired with no interface open', () => {
  it('a tick parks a thread whose mention settled while the event was missed, and replays the wake-up', async () => {
    const w = world();
    const { thread } = w.addThread('th1', { mentionStatus: 'resolved', sinceMin: 5 });
    await w.scheduler.tick();
    await flush();
    expect(thread.status).toBe('idle');
    expect(w.turns).toEqual([{ ticketId: 't1', trigger: { kind: 'thread_reply', threadId: 'th1', mentionStatus: 'resolved' } }]);
    // A visible state change: the panels that are open hear about it.
    expect(w.updated).toEqual(['th1']);
  });

  it('the timer drives the tick every 60 s, and stops with the scheduler', async () => {
    vi.useFakeTimers();
    const w = world();
    const { thread } = w.addThread('th1', { mentionStatus: 'failed' });
    w.scheduler.start(THREAD_REPAIR_INTERVAL_MS);
    expect(THREAD_REPAIR_INTERVAL_MS).toBe(60_000);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(thread.status).toBe('running');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(thread.status).toBe('failed');
    expect(w.calls.getOpen).toBe(1);
    w.scheduler.stop();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(w.calls.getOpen).toBe(1);
  });

  it('only looks at threads with a run in flight: a waiting, idle or concluded thread is not even read', async () => {
    const w = world();
    const waiting = w.addThread('th-wait', { mentionStatus: 'resolved' }).thread; waiting.markWaiting();
    const idle = w.addThread('th-idle', { mentionStatus: 'failed' }).thread; idle.markIdle();
    const closed = w.addThread('th-closed', { mentionStatus: 'failed' }).thread; closed.conclude('fini');
    const read: string[] = [];
    const getById = w.mentionStore.getById;
    w.mentionStore.getById = async (id: string) => { read.push(id); return getById(id); };
    await w.scheduler.tick();
    expect(read).toEqual([]);
    expect([waiting.status, idle.status, closed.status]).toEqual(['waiting', 'idle', 'concluded']);
    expect(w.turns).toEqual([]);
  });
});

describe('thread surveillance — the route and the job are one implementation', () => {
  // Same stuck states, one world repaired by the periodic tick, the other by
  // GET /tickets/:id/threads: the threads and the wake-ups must come out identical.
  function stuck() {
    const w = world();
    w.addThread('th-resolved', { mentionStatus: 'resolved', sinceMin: 3 });
    w.addThread('th-failed', { mentionStatus: 'failed', sinceMin: 3 });
    w.addThread('th-waiting', { mentionStatus: 'waiting_for_info', sinceMin: 3 });
    w.addThread('th-stalled', { mentionStatus: 'acknowledged', sinceMin: 90 });
    w.addExecution('e-stalled', 'm-th-stalled', 90, 75);
    w.addThread('th-busy', { mentionStatus: 'acknowledged', sinceMin: 10 });
    w.addExecution('e-busy', 'm-th-busy', 10, 1);
    const wf = w.addThread('th-wf', { targetType: 'workflow', mentionStatus: 'resolved', sinceMin: 30 });
    w.addRun('r1', wf.mention.id, 'completed', 2);
    return w;
  }
  const picture = (w: ReturnType<typeof world>) => ({
    threads: [...w.threads.values()].map((t) => ({ id: t.id, status: t.status, failures: t.failures, hold: t.userHoldAt, stop: t.lastStop })),
    mentions: [...w.mentions.values()].map((m) => ({ id: m.id, status: m.status })),
    executions: w.executions.map((e) => ({ id: e.id, status: e.status, stoppedBy: e.stoppedBy, stopReason: e.stopReason })),
    turns: [...w.turns].sort((a, b) => String(a.trigger['threadId']).localeCompare(String(b.trigger['threadId']))),
  });

  it('gives the same threads, mentions, executions and wake-ups on the same stuck state', async () => {
    const byJob = stuck();
    await byJob.scheduler.tick();
    await flush();

    const byRoute = stuck();
    const app = Fastify();
    await app.register(assistantThreadsRoutes({ ...byRoute.deps, repairThreads: byRoute.repair } as never));
    const res = await app.inject({ method: 'GET', url: '/api/tickets/t1/threads' });
    await flush();
    expect(res.statusCode).toBe(200);

    expect(picture(byRoute)).toEqual(picture(byJob));
    // And that common result is a repair, not two no-ops.
    expect(Object.fromEntries(picture(byJob).threads.map((t) => [t.id, t.status]))).toEqual({
      'th-resolved': 'idle', 'th-failed': 'failed', 'th-waiting': 'waiting', 'th-stalled': 'failed', 'th-busy': 'running', 'th-wf': 'idle',
    });
    expect(picture(byJob).turns).toHaveLength(4);
  });
});

describe('thread surveillance — a run silent beyond the execution timeout', () => {
  it('wakes the assistant once, with the cause, and not again on the next ticks', async () => {
    const w = world();
    const { thread, mention } = w.addThread('th1', { sinceMin: 120 });
    const execution = w.addExecution('e1', mention.id, 120, 75);
    await w.scheduler.tick();
    await flush();

    expect(thread.status).toBe('failed');
    expect(thread.failures).toBe(1);
    expect(w.turns).toHaveLength(1);
    expect(w.turns[0]).toEqual({
      ticketId: 't1',
      trigger: {
        kind: 'thread_reply', threadId: 'th1', mentionStatus: 'failed',
        failure: { reason: 'stalled', message: "Aucun événement d'exécution depuis 75 min (délai d'exécution configuré : 60 min) : le run ne répondait plus, le serveur l'a clos." },
      },
    });
    // The run is closed as the system's doing, and its mention frees the lane:
    // left `acknowledged`, every relaunch would be answered « il travaille encore ».
    expect(mention.status).toBe('failed');
    expect(execution).toMatchObject({ status: 'interrupted', stoppedBy: 'system', stopReason: 'stalled' });
    // The surveillance launched nothing itself.
    expect(w.launched).toEqual([]);

    await w.scheduler.tick();
    await w.scheduler.tick();
    await flush();
    expect(w.turns).toHaveLength(1);
    expect(thread.failures).toBe(1);
  });

  it('follows the configured timeout (and its server default), with a margin for the run\'s own timer', async () => {
    // Default: 60 min. 61 min of silence is inside the margin — the run's own
    // timeout is still settling through the normal path.
    const inMargin = world();
    const a = inMargin.addThread('th1', { sinceMin: 200 });
    inMargin.addExecution('e1', a.mention.id, 200, 61);
    await inMargin.scheduler.tick();
    await flush();
    expect(a.thread.status).toBe('running');
    expect(inMargin.turns).toEqual([]);
    expect(STALL_GRACE_MS).toBeLessThan(5 * MIN);

    // Setting at 10 min: 13 min of silence is a stall, where the default would wait an hour.
    const short = world({ workThreadsEnabled: true, agentExecutionTimeout: 10 * MIN });
    const b = short.addThread('th1', { sinceMin: 200 });
    short.addExecution('e1', b.mention.id, 200, 13);
    await short.scheduler.tick();
    await flush();
    expect(b.thread.status).toBe('failed');
    expect((short.turns[0]!.trigger['failure'] as { message: string }).message).toContain('depuis 13 min (délai d\'exécution configuré : 10 min)');
  });

  it('a panel is alive as long as one of its sessions speaks', async () => {
    const w = world();
    const { thread, mention } = w.addThread('th1', { targetType: 'panel', sinceMin: 100 });
    w.addExecution('member-1', mention.id, 100, 90);
    w.addExecution('member-2', mention.id, 100, 4);
    await w.scheduler.tick();
    await flush();
    expect(thread.status).toBe('running');
    expect(w.turns).toEqual([]);
  });

  it('a turn that never started says so; a turn this process still has queued is not stalled', async () => {
    const lost = world();
    const a = lost.addThread('th1', { targetType: 'skill', mentionStatus: 'pending', sinceMin: 70 });
    await lost.scheduler.tick();
    await flush();
    expect(a.thread.status).toBe('failed');
    expect((lost.turns[0]!.trigger['failure'] as { reason: string; message: string })).toMatchObject({ reason: 'stalled' });
    expect((lost.turns[0]!.trigger['failure'] as { message: string }).message).toContain("le tour n'a jamais démarré");

    const queued = world();
    const b = queued.addThread('th1', { mentionStatus: 'pending', sinceMin: 70 });
    queued.queued.add(b.mention.id);
    await queued.scheduler.tick();
    await flush();
    expect(b.thread.status).toBe('running');
    expect(b.mention.status).toBe('pending');
    expect(queued.turns).toEqual([]);
  });

  it('a thread woken after a long wait is measured from the wake-up, not from its old events', async () => {
    const w = world();
    // The agent asked a question three hours ago; the answer went out two minutes ago.
    const { thread, mention } = w.addThread('th1', { sinceMin: 2 });
    mention.createdAt = ago(200);
    w.addExecution('e-old', mention.id, 200, 180).status = 'completed';
    await w.scheduler.tick();
    await flush();
    expect(thread.status).toBe('running');
    expect(w.turns).toEqual([]);
  });

  it('workflow: a run that claims to execute but no longer moves is cancelled as system, and the assistant woken with the cause, once', async () => {
    const w = world();
    const { thread, mention } = w.addThread('th-wf', { targetType: 'workflow', mentionStatus: 'resolved', sinceMin: 300 });
    const run = w.addRun('r1', mention.id, 'running', 150);
    const step = w.addStep('r1', 'running', 'e-step', 140);
    w.addExecution('e-step', null, 140, 80);
    await w.scheduler.tick();
    await flush();

    expect(run).toMatchObject({ status: 'cancelled', cancelledBy: 'system' });
    expect(step.status).toBe('cancelled');
    expect(thread.status).toBe('failed');
    expect(w.turns).toEqual([{
      ticketId: 't1',
      trigger: {
        kind: 'thread_reply', threadId: 'th-wf', mentionStatus: 'failed', workflowRun: { id: 'r1', status: 'cancelled' },
        failure: { reason: 'stalled', message: "Aucun événement d'exécution depuis 80 min (délai d'exécution configuré : 60 min) : le run du workflow ne progressait plus, le serveur l'a annulé." },
      },
    }]);

    await w.scheduler.tick();
    await flush();
    expect(w.turns).toHaveLength(1);
    expect(thread.failures).toBe(1);
  });

  it('workflow: a run whose current step still speaks, or that waits on a human decision, is left alone', async () => {
    const speaking = world();
    const a = speaking.addThread('th-wf', { targetType: 'workflow', mentionStatus: 'resolved', sinceMin: 300 });
    const runA = speaking.addRun('r1', a.mention.id, 'running', 150);
    speaking.addStep('r1', 'running', 'e-step', 140);
    speaking.addExecution('e-step', null, 140, 3);
    await speaking.scheduler.tick();
    await flush();
    expect([a.thread.status, runA.status]).toEqual(['running', 'running']);

    // The human may take days over a gate or a route: that is not a stall.
    for (const [runStatus, stepStatus] of [['needs_review', 'needs_review'], ['running', 'awaiting_routing']] as const) {
      const parked = world();
      const b = parked.addThread('th-wf', { targetType: 'workflow', mentionStatus: 'resolved', sinceMin: 3000 });
      const runB = parked.addRun('r1', b.mention.id, runStatus, 3000);
      parked.addStep('r1', stepStatus, 'e-step', 3000);
      await parked.scheduler.tick();
      await flush();
      expect([b.thread.status, runB.status, parked.turns.length]).toEqual(['running', runStatus, 0]);
    }
  });
});

describe('thread surveillance — the human\'s hold', () => {
  it('leaves a held thread exactly as it is: not parked, not failed, hold standing, nobody woken', async () => {
    const w = world();
    // Held and settled, held and silent: either way it is the human's to restart.
    const settled = w.addThread('th-settled', { mentionStatus: 'resolved', sinceMin: 30 });
    const silent = w.addThread('th-silent', { sinceMin: 500 });
    const execution = w.addExecution('e1', silent.mention.id, 500, 400);
    const heldAt = ago(20);
    for (const { thread } of [settled, silent]) { thread.userHoldAt = heldAt; }
    const before = [settled.thread.updatedAt, silent.thread.updatedAt];

    await w.scheduler.tick();
    await flush();

    for (const { thread } of [settled, silent]) {
      expect(thread.userHoldAt).toBe(heldAt);
      expect(thread.status).toBe('running');
      expect(thread.failures).toBe(0);
    }
    expect([settled.thread.updatedAt, silent.thread.updatedAt]).toEqual(before);
    expect(silent.mention.status).toBe('acknowledged');
    expect(execution.status).toBe('running');
    expect(w.turns).toEqual([]);
    expect(w.updated).toEqual([]);
    expect(w.launched).toEqual([]);
  });

  it('a thread the human stopped (idle, held) is not touched by any number of ticks', async () => {
    const w = world();
    const { thread } = w.addThread('th1', { mentionStatus: 'resolved', sinceMin: 500 });
    thread.recordStop('user', 'stop');
    const hold = thread.userHoldAt;
    await w.scheduler.tick();
    await w.scheduler.tick();
    await flush();
    expect(thread.status).toBe('idle');
    expect(thread.userHoldAt).toBe(hold);
    expect(w.turns).toEqual([]);
  });

  it('does not act on a thread the human stopped between the read and the repair', async () => {
    const w = world();
    const { thread, mention } = w.addThread('th1', { sinceMin: 120 });
    w.addExecution('e1', mention.id, 120, 90);
    // The pass loaded the thread as running; the stop lands while it reads the executions.
    const stale = Object.assign(Object.create(Object.getPrototypeOf(thread)), thread) as AgentThreadEntity;
    thread.recordStop('user', 'stop');
    await w.repair.repair([stale]);
    await flush();
    expect(thread.status).toBe('idle');
    expect(thread.userHoldAt).not.toBeNull();
    expect(thread.failures).toBe(0);
    expect(mention.status).toBe('acknowledged');
    expect(w.turns).toEqual([]);
  });
});

describe('thread surveillance — the switch', () => {
  it('off: the tick does nothing, not even a read; on again: the next tick repairs, with no restart', async () => {
    const w = world({ workThreadsEnabled: false });
    const { thread } = w.addThread('th1', { mentionStatus: 'resolved', sinceMin: 5 });
    const stalled = w.addThread('th2', { sinceMin: 200 });
    w.addExecution('e2', stalled.mention.id, 200, 150);

    await w.scheduler.tick();
    await flush();
    expect(w.calls.getOpen).toBe(0);
    expect([thread.status, stalled.thread.status]).toEqual(['running', 'running']);
    expect(stalled.mention.status).toBe('acknowledged');
    expect(w.turns).toEqual([]);

    // Absent is off too: the switch is opt-in.
    delete w.config['workThreadsEnabled'];
    await w.scheduler.tick();
    expect(w.calls.getOpen).toBe(0);

    w.config['workThreadsEnabled'] = true;
    await w.scheduler.tick();
    await flush();
    expect([thread.status, stalled.thread.status]).toEqual(['idle', 'failed']);
  });

  it('off: the route keeps its read-repair but ends no silent run', async () => {
    const w = world({ workThreadsEnabled: false });
    const settled = w.addThread('th1', { mentionStatus: 'resolved', sinceMin: 5 });
    const stalled = w.addThread('th2', { sinceMin: 200 });
    w.addExecution('e2', stalled.mention.id, 200, 150);
    await w.repair.repair([settled.thread, stalled.thread]);
    await flush();
    expect(settled.thread.status).toBe('idle');
    expect([stalled.thread.status, stalled.mention.status]).toEqual(['running', 'acknowledged']);
  });
});

describe('thread surveillance — the scheduler', () => {
  it('two overlapping ticks run the repair once: the second is skipped, not queued', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let passes = 0;
    const scheduler = new ThreadRepairScheduler({ repairOpen: async () => { passes++; await gate; return 0; } }, () => true, { info() {}, warn() {}, error() {}, debug() {} } as never);

    const first = scheduler.tick();
    const second = scheduler.tick();
    await second; // returns at once, without waiting for the pass in flight
    expect(passes).toBe(1);
    expect(scheduler.isTicking).toBe(true);
    release();
    await first;
    expect(passes).toBe(1);
    // The guard is released: the next tick runs.
    await scheduler.tick();
    expect(passes).toBe(2);
  });

  it('overlapping ticks over a slow store wake the assistant once', async () => {
    const w = world();
    const { mention } = w.addThread('th1', { sinceMin: 120 });
    w.addExecution('e1', mention.id, 120, 90);
    await Promise.all([w.scheduler.tick(), w.scheduler.tick(), w.scheduler.tick()]);
    await flush();
    expect(w.calls.getOpen).toBe(1);
    expect(w.turns).toHaveLength(1);
  });

  it('a pass that throws is logged by the timer, never thrown out of it, and the next tick still runs', async () => {
    vi.useFakeTimers();
    const errors: string[] = [];
    let passes = 0;
    const scheduler = new ThreadRepairScheduler(
      { repairOpen: async () => { passes++; if (passes === 1) throw new Error('store down'); return 0; } },
      () => true,
      { info() {}, warn() {}, debug() {}, error: (msg: string, ctx: { error: string }) => { errors.push(`${msg}: ${ctx.error}`); } } as never,
    );
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => { unhandled.push(e); };
    process.on('unhandledRejection', onUnhandled);
    try {
      scheduler.start(60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(errors).toEqual(['Thread repair tick failed: store down']);
      expect(scheduler.isTicking).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(passes).toBe(2);
      expect(unhandled).toEqual([]);
    } finally {
      scheduler.stop();
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('a repair failing on one thread does not prevent the others, and is logged', async () => {
    const w = world();
    const broken = w.addThread('th-broken', { mentionStatus: 'resolved', sinceMin: 5 });
    const fine = w.addThread('th-fine', { mentionStatus: 'resolved', sinceMin: 5 });
    const stalled = w.addThread('th-stalled', { sinceMin: 200 });
    w.addExecution('e1', stalled.mention.id, 200, 150);
    const getById = w.mentionStore.getById;
    w.mentionStore.getById = async (id: string) => {
      if (id === broken.mention.id) throw new Error('row unreadable');
      return getById(id);
    };

    await w.scheduler.tick();
    await flush();

    expect(broken.thread.status).toBe('running');
    expect(fine.thread.status).toBe('idle');
    expect(stalled.thread.status).toBe('failed');
    expect(w.turns.map((t) => t.trigger['threadId']).sort()).toEqual(['th-fine', 'th-stalled']);
    expect(w.errors).toEqual([{ msg: 'Thread repair failed', ctx: { threadId: 'th-broken', ticketId: 't1', error: 'row unreadable' } }]);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MemoryConsolidator,
  parseJudgeAnswers,
  stripMentions,
  MIN_CORRECTION_CHARS,
  type MemoryConsolidatorDeps,
} from '../../src/application/memory/memory-consolidator.js';
import { MemoryEventListener } from '../../src/application/memory/memory-event-listener.js';
import { NOTHING_SENTINEL } from '../../src/application/memory/memory-synthesiser.js';
import { CURATED_TAG } from '../../src/application/memory/chunk-curated.js';
import { HUMAN_FEEDBACK_TAG } from '../../src/application/memory/chunker.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import type { AppConfig } from '../../src/application/ports/config.port.js';
import type { DraftChunk } from '../../src/application/memory/chunker.js';
import { CASE_694 } from '../helpers/correction-694.fixture.js';

const silent = { info: () => {}, warn: vi.fn(), error: () => {}, debug: () => {} };

// ─── Fixture world ───

const TICKET = {
  id: 't694', displayId: 694, title: 'memory compile et memory ask --repo sortent en exit 1',
  boardId: 'b1', tags: ['memory'], links: [{ type: 'repository', ref: 'oliviermadre/fleex' }],
};

let comments: TicketCommentEntity[];
let mentions: TicketMentionEntity[];
let kv: Map<string, string>;
let config: Partial<AppConfig>;
let now: Date;
let ingested: Array<{ kind: string; id: string; drafts: DraftChunk[] }>;
let judge: ReturnType<typeof vi.fn>;

function comment(p: {
  id: string; body: string; authorType?: 'user' | 'agent'; authorName?: string;
  parentId?: string | null; visibility?: 'public' | 'private'; at: string; ticketId?: string;
}): TicketCommentEntity {
  const at = new Date(p.at);
  const c = new TicketCommentEntity(
    p.id, p.ticketId ?? TICKET.id, p.authorType ?? 'user', p.authorName ?? (p.authorType === 'agent' ? 'The Builder' : 'NaS'),
    p.body, (p.visibility ?? 'public') as never, [], [], p.parentId ?? null, at, at,
  );
  comments.push(c);
  return c;
}

function resolvedMention(p: {
  id: string; commentId: string; resolvedCommentId?: string | null; resolvedAt: string;
  agent?: string; targetType?: 'agent' | 'panel'; ticketId?: string;
}): TicketMentionEntity {
  const m = new TicketMentionEntity(
    p.id, p.ticketId ?? TICKET.id, p.commentId, p.agent ?? 'builder', 'user', (p.targetType ?? 'agent') as never,
    'plan' as never, 'resolved' as never, new Date(p.resolvedAt), p.resolvedCommentId ?? null, null, new Date(p.resolvedAt),
  );
  mentions.push(m);
  return m;
}

/** A user→agent exchange that passes the free filters. */
function exchange(n: number, at: string) {
  const u = comment({ id: `u${n}`, body: `@agent:builder non, tu te trompes sur le point ${n}, relis la spec`, at });
  const r = comment({ id: `r${n}`, authorType: 'agent', body: `You're right about ${n}, fixing it.`, parentId: u.id, at });
  return resolvedMention({ id: `m${n}`, commentId: u.id, resolvedCommentId: r.id, resolvedAt: at });
}

/** The #694 exchange, verbatim. */
function case694() {
  comment({ id: 'claim', authorType: 'agent', authorName: 'workflow:Spec Dev PR (HITL) → Build', body: CASE_694.agentClaim, at: '2026-10-18T17:14:45Z' });
  comment({ id: '404f9714', body: CASE_694.correction, at: '2026-10-18T22:09:50Z' });
  comment({ id: '8486e0dd', authorType: 'agent', body: CASE_694.response, parentId: '404f9714', at: '2026-10-18T22:20:30Z' });
  return resolvedMention({ id: 'm694', commentId: '404f9714', resolvedCommentId: '8486e0dd', resolvedAt: '2026-10-18T22:20:31Z' });
}

/** Judge stub: answers every numbered exchange with `answerFor(n, prompt)`. */
function judgeAnswers(answerFor: (n: number, block: string) => string) {
  judge.mockImplementation(async ({ userPrompt }: { userPrompt: string }) => {
    const blocks = userPrompt.split('\n\n---\n\n');
    return blocks.map((b, i) => `${i + 1}: ${answerFor(i + 1, b)}`).join('\n');
  });
}

function makeConsolidator(overrides: Partial<MemoryConsolidatorDeps> = {}) {
  return new MemoryConsolidator({
    config: { get: () => ({ basePath: '/tmp', defaultShell: 'bash', repositoryRefreshIntervalMs: 0, ...config } as AppConfig) } as never,
    kernel: { ingest: vi.fn(async (kind: string, id: string, drafts: DraftChunk[]) => { ingested.push({ kind, id, drafts }); }) } as never,
    mentionStore: { getAll: async () => mentions } as never,
    commentStore: { getByTicket: async (id: string) => comments.filter((c) => c.ticketId === id) } as never,
    ticketStore: { getTicketById: async (id: string) => (id === TICKET.id ? TICKET : null) } as never,
    kvStore: {
      get: async (k: string) => kv.get(k) ?? null,
      set: async (k: string, v: string) => { kv.set(k, v); },
      delete: async (k: string) => { kv.delete(k); },
      listByPrefix: async () => [],
    },
    synthesiser: { run: judge } as never,
    logger: silent as never,
    schedulerArmed: true,
    now: () => now,
    ...overrides,
  });
}

beforeEach(() => {
  comments = [];
  mentions = [];
  kv = new Map();
  ingested = [];
  config = { memoryEngine: 'semantic' };
  now = new Date('2026-10-19T03:05:00');
  judge = vi.fn(async () => null);
  silent.warn.mockReset();
});

// ─── Free filters: approvals and questions never cost a model call ───

describe('free filters', () => {
  it.each([
    '@agent:builder go',
    '@agent:builder continue',
    '@agent:builder ok parfait',
    '@agent:builder pourquoi ?',
  ])('drops "%s" without calling the judge', async (body) => {
    const u = comment({ id: 'u', body, at: '2026-10-18T10:00:00Z' });
    const r = comment({ id: 'r', authorType: 'agent', body: 'Done.', parentId: u.id, at: '2026-10-18T10:01:00Z' });
    resolvedMention({ id: 'm', commentId: u.id, resolvedCommentId: r.id, resolvedAt: '2026-10-18T10:01:00Z' });

    const result = await makeConsolidator().run({ sinceDays: 2 });

    expect(result.stats.candidates).toBe(0);
    expect(judge).not.toHaveBeenCalled();
  });

  it('measures length without the mentions, so a long handle cannot pass for content', () => {
    expect(stripMentions('@agent:builder-with-a-very-long-name ok')).toBe('ok');
    expect(stripMentions('@agent:builder ok').length).toBeLessThan(MIN_CORRECTION_CHARS);
  });

  it('drops a private correction or a private reply', async () => {
    const u = comment({ id: 'u', body: '@agent:builder non, ce n’est pas du tout ce que je voulais', visibility: 'private', at: '2026-10-18T10:00:00Z' });
    const r = comment({ id: 'r', authorType: 'agent', body: 'You are right.', parentId: u.id, at: '2026-10-18T10:01:00Z' });
    resolvedMention({ id: 'm1', commentId: u.id, resolvedCommentId: r.id, resolvedAt: '2026-10-18T10:01:00Z' });
    const u2 = comment({ id: 'u2', body: '@agent:builder non, ce n’est pas du tout ce que je voulais', at: '2026-10-18T11:00:00Z' });
    const r2 = comment({ id: 'r2', authorType: 'agent', body: 'You are right.', parentId: u2.id, visibility: 'private', at: '2026-10-18T11:01:00Z' });
    resolvedMention({ id: 'm2', commentId: u2.id, resolvedCommentId: r2.id, resolvedAt: '2026-10-18T11:01:00Z' });

    const result = await makeConsolidator().run({ sinceDays: 2 });

    expect(result.stats.candidates).toBe(0);
    expect(judge).not.toHaveBeenCalled();
  });

  it('drops a resolved mention with no reply at all, without failing', async () => {
    const u = comment({ id: 'u', body: '@agent:builder non, ce n’est pas du tout ce que je voulais', at: '2026-10-18T10:00:00Z' });
    resolvedMention({ id: 'm', commentId: u.id, resolvedCommentId: null, resolvedAt: '2026-10-18T10:01:00Z' });

    const result = await makeConsolidator().run({ sinceDays: 2 });

    expect(result.status).toBe('done');
    expect(result.stats.candidates).toBe(0);
  });

  it('falls back to the agent reply under the correction when the mention names none', async () => {
    const u = comment({ id: 'u', body: '@agent:builder non, ce n’est pas du tout ce que je voulais', at: '2026-10-18T10:00:00Z' });
    comment({ id: 'r', authorType: 'agent', body: 'You are right, redoing it.', parentId: u.id, at: '2026-10-18T10:01:00Z' });
    resolvedMention({ id: 'm', commentId: u.id, resolvedCommentId: null, resolvedAt: '2026-10-18T10:01:00Z' });
    judgeAnswers(() => 'Ask before rewriting a whole section.');

    const result = await makeConsolidator().run({ sinceDays: 2 });

    expect(result.stats.candidates).toBe(1);
    expect(ingested[0]!.drafts[0]!.content).toContain('You are right, redoing it.');
  });
});

// ─── #694: the reference case ───

describe('the #694 correction', () => {
  it('passes the free filters even though it has no parent and another agent spoke just before', async () => {
    case694();
    judgeAnswers(() => NOTHING_SENTINEL);

    const result = await makeConsolidator().run({ sinceDays: 2 });

    expect(result.stats.candidates).toBe(1);
    const prompt = judge.mock.calls[0]![0].userPrompt as string;
    expect(prompt).toContain('je ne comprends pas pourquoi tu dis ne pas pouvoir tester');
    expect(prompt).toContain('I assumed "Stack not running"');
  });

  it('is indexed as a curated correction for builder, lesson first', async () => {
    case694();
    const lesson = 'Before concluding an environment blocker (e.g. "stack not running"), try to lift it (`fleex start`).';
    judgeAnswers(() => lesson);

    const result = await makeConsolidator().run({ sinceDays: 2 });

    expect(result.stats.corrections).toBe(1);
    expect(ingested).toHaveLength(1);
    const [{ kind, id, drafts }] = ingested;
    expect(kind).toBe('correction');
    expect(id).toBe('m694');
    const chunk = drafts[0]!;
    expect(chunk.title).toBe('Ticket #694: memory compile et memory ask --repo sortent en exit 1 > NaS corrected builder');
    // The lesson leads: short chunks retrieve on their opening.
    expect(chunk.content.startsWith(`**Lesson**: ${lesson}`)).toBe(true);
    expect(chunk.metadata.agentName).toBe('builder');
    expect(chunk.metadata.tags).toEqual(expect.arrayContaining([CURATED_TAG, HUMAN_FEEDBACK_TAG, 'memory']));
    expect(kv.get('memory:correction-verdict:m694')).toBe('positive');
  });
});

// ─── Verdicts, batches, failures ───

describe('judging', () => {
  it('marks a NOTHING verdict negative and indexes nothing', async () => {
    exchange(1, '2026-10-18T10:00:00Z');
    judgeAnswers(() => 'NOTHING');

    const result = await makeConsolidator().run({ sinceDays: 2 });

    expect(result.stats.judged).toBe(1);
    expect(ingested).toHaveLength(0);
    expect(kv.get('memory:correction-verdict:m1')).toBe('negative');
  });

  it('judges 23 candidates in 3 calls of at most 10', async () => {
    for (let n = 1; n <= 23; n++) exchange(n, `2026-10-18T10:${String(n).padStart(2, '0')}:00Z`);
    judgeAnswers(() => 'NOTHING');

    const result = await makeConsolidator().run({ sinceDays: 2 });

    expect(judge).toHaveBeenCalledTimes(3);
    expect(result.stats.batches).toBe(3);
    expect(result.stats.judged).toBe(23);
  });

  it('leaves an exchange the judge skipped without a marker, and handles the rest', async () => {
    exchange(1, '2026-10-18T10:00:00Z');
    exchange(2, '2026-10-18T10:01:00Z');
    judge.mockResolvedValue('1: NOTHING');

    const result = await makeConsolidator().run({ sinceDays: 2 });

    expect(kv.get('memory:correction-verdict:m1')).toBe('negative');
    expect(kv.has('memory:correction-verdict:m2')).toBe(false);
    expect(result.verdicts.find((v) => v.mentionId === 'm2')!.verdict).toBe('unjudged');
  });

  it('marks nothing for a failed call, warns, and still runs the next batches', async () => {
    for (let n = 1; n <= 12; n++) exchange(n, `2026-10-18T10:${String(n).padStart(2, '0')}:00Z`);
    judge
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('1: NOTHING\n2: NOTHING');

    const result = await makeConsolidator().run({ sinceDays: 2 });

    expect(result.stats.failedBatches).toBe(1);
    expect(silent.warn).toHaveBeenCalled();
    expect([...kv.keys()].filter((k) => k.startsWith('memory:correction-verdict:'))).toEqual([
      'memory:correction-verdict:m11', 'memory:correction-verdict:m12',
    ]);
  });

  it('does not call the judge again for exchanges already judged', async () => {
    exchange(1, '2026-10-18T10:00:00Z');
    exchange(2, '2026-10-18T10:01:00Z');
    judgeAnswers(() => 'NOTHING');
    const consolidator = makeConsolidator();
    await consolidator.run({ sinceDays: 120 });
    judge.mockClear();

    const second = await consolidator.run({ sinceDays: 120 });

    expect(judge).not.toHaveBeenCalled();
    expect(second.stats.skipped).toBe(2);
    expect(second.stats.judged).toBe(0);
  });

  it('writes nothing on a dry run, but still reports the verdicts', async () => {
    case694();
    judgeAnswers(() => 'Try `fleex start` before reporting a missing stack.');

    const result = await makeConsolidator().run({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.verdicts[0]!.verdict).toBe('lesson');
    expect(result.stats.corrections).toBe(1);
    expect(ingested).toHaveLength(0);
    expect(kv.size).toBe(0);
  });
});

// ─── Scheduling ───

describe('nightly scheduling', () => {
  it('does not run before the configured hour', async () => {
    now = new Date('2026-10-19T02:55:00');
    exchange(1, '2026-10-18T10:00:00Z');

    expect(await makeConsolidator().tick()).toBeNull();
  });

  it('runs on the first tick past the hour, once per day', async () => {
    exchange(1, '2026-10-18T10:00:00Z');
    judgeAnswers(() => 'NOTHING');
    const consolidator = makeConsolidator();

    expect((await consolidator.tick())?.status).toBe('done');
    now = new Date('2026-10-19T03:20:00');
    expect(await consolidator.tick()).toBeNull();
  });

  it('catches up on waking when the machine was asleep at the hour', async () => {
    kv.set('memory:consolidation:state', JSON.stringify({
      lastRunAt: '2026-10-18T03:00:00', lastRunDate: '2026-10-18', watermark: new Date('2026-10-18T03:00:00').toISOString(), stats: {},
    }));
    now = new Date('2026-10-19T09:00:00');
    exchange(1, '2026-10-18T22:00:00Z');
    judgeAnswers(() => 'NOTHING');

    const result = await makeConsolidator().tick();

    expect(result?.status).toBe('done');
    expect(result?.stats.judged).toBe(1);
  });

  it('honours a configured hour', async () => {
    config.memoryConsolidationHour = 5;
    now = new Date('2026-10-19T04:00:00');
    expect(await makeConsolidator().tick()).toBeNull();
  });

  it('never runs on its own where the scheduler is disarmed, but runs by hand', async () => {
    exchange(1, '2026-10-18T10:00:00Z');
    judgeAnswers(() => 'NOTHING');
    const consolidator = makeConsolidator({ schedulerArmed: false });

    expect(await consolidator.tick()).toBeNull();
    expect((await consolidator.run({})).status).toBe('done');
  });

  it('moves the watermark after a complete pass, and keeps it after a failed batch', async () => {
    exchange(1, '2026-10-18T10:00:00Z');
    judge.mockResolvedValue(null);
    const consolidator = makeConsolidator();
    await consolidator.tick();
    const failed = JSON.parse(kv.get('memory:consolidation:state')!);
    expect(failed.lastRunDate).toBe('2026-10-19');
    expect(Date.parse(failed.watermark)).toBeLessThan(now.getTime());

    now = new Date('2026-10-20T03:05:00');
    judgeAnswers(() => 'NOTHING');
    await consolidator.tick();
    const ok = JSON.parse(kv.get('memory:consolidation:state')!);
    expect(ok.watermark).toBe(now.toISOString());
    // The exchange the failed night left unjudged was retried.
    expect(kv.get('memory:correction-verdict:m1')).toBe('negative');
  });

  it('leaves the nightly watermark alone on a --since catch-up', async () => {
    exchange(1, '2026-10-18T10:00:00Z');
    judgeAnswers(() => 'NOTHING');

    await makeConsolidator().run({ sinceDays: 120 });

    expect(kv.has('memory:consolidation:state')).toBe(false);
  });

  it('ignores mentions resolved before the window', async () => {
    exchange(1, '2026-06-01T10:00:00Z');
    judgeAnswers(() => 'NOTHING');

    const result = await makeConsolidator().run({});

    expect(result.stats.resolvedMentions).toBe(0);
    expect(judge).not.toHaveBeenCalled();
  });
});

// ─── Gates ───

describe('gates', () => {
  it('neither ticks nor runs by hand when the feature is off', async () => {
    config.memoryFeatures = { consolidation: false };
    exchange(1, '2026-10-18T10:00:00Z');
    const consolidator = makeConsolidator();

    expect(await consolidator.tick()).toBeNull();
    expect((await consolidator.run({ sinceDays: 120 })).status).toBe('disabled');
    expect(judge).not.toHaveBeenCalled();
    expect(ingested).toHaveLength(0);
  });

  it('is unavailable under the legacy engine', async () => {
    config.memoryEngine = 'legacy';
    expect((await makeConsolidator().run({})).status).toBe('unavailable');
  });

  it('has no nightly pass without a KV store', async () => {
    expect(await makeConsolidator({ kvStore: null }).tick()).toBeNull();
  });
});

// ─── Live path stays free ───

describe('live path', () => {
  it('does not subscribe to mention resolution: resolving a mention never calls a model', () => {
    const types: string[] = [];
    const listener = new MemoryEventListener({
      bus: { on: (type: string) => { types.push(type); } } as never,
      kernel: {} as never,
      config: { get: () => ({}) } as never,
      ticketStore: {} as never, commentStore: {} as never, deliverableStore: {} as never,
      personaStore: {} as never, skillStore: {} as never,
      logger: silent as never,
    });
    listener.register();

    expect(types).not.toContain('mention.resolved');
  });
});

// ─── Parsing ───

describe('parseJudgeAnswers', () => {
  it('reads numbered lines and tolerates preamble and quotes', () => {
    const answers = parseJudgeAnswers('Here you go:\n1: NOTHING\n2: "Try fleex start first."\n- 3) nothing.\n9: out of range', 3);
    expect(answers.get(1)).toBe(NOTHING_SENTINEL);
    expect(answers.get(2)).toBe('Try fleex start first.');
    expect(answers.get(3)).toBe(NOTHING_SENTINEL);
    expect(answers.has(9)).toBe(false);
  });
});

// ─── Live eval, opt-in ───

describe.skipIf(!process.env['MEMORY_LIVE_EVAL'])('live judge eval (MEMORY_LIVE_EVAL=1)', () => {
  it('finds the lesson in #694 and nothing in an instruction or a held position', async () => {
    const { MemorySynthesiser } = await import('../../src/application/memory/memory-synthesiser.js');
    const real = new MemorySynthesiser({ acquire: async () => () => {} } as never, silent as never);

    case694();
    const u1 = comment({ id: 'c1', body: '@agent:builder fais moi ça mais ne commit pas, je veux valider avant', at: '2026-10-18T23:00:00Z' });
    const r1 = comment({ id: 'c1r', authorType: 'agent', body: 'OK, I will prepare the change without committing.', parentId: u1.id, at: '2026-10-18T23:01:00Z' });
    resolvedMention({ id: 'mC', commentId: u1.id, resolvedCommentId: r1.id, resolvedAt: '2026-10-18T23:01:00Z' });
    const u2 = comment({ id: 'd1', body: '@agent:builder tu es sûr que la stack ne peut pas démarrer ?', at: '2026-10-18T23:10:00Z' });
    const r2 = comment({ id: 'd1r', authorType: 'agent', body: 'Yes. `fleex start` fails with EADDRINUSE on port 5432, which another process holds. Here is the full error.', parentId: u2.id, at: '2026-10-18T23:11:00Z' });
    resolvedMention({ id: 'mD', commentId: u2.id, resolvedCommentId: r2.id, resolvedAt: '2026-10-18T23:11:00Z' });

    const result = await makeConsolidator({ synthesiser: real }).run({ sinceDays: 2, dryRun: true });
    const byId = new Map(result.verdicts.map((v) => [v.mentionId, v]));

    expect(byId.get('m694')!.verdict).toBe('lesson');
    expect(byId.get('m694')!.lesson).toMatch(/start|blocker|environment|stack/i);
    expect(byId.get('mC')!.verdict).toBe('nothing');
    expect(byId.get('mD')!.verdict).toBe('nothing');
  }, 120_000);
});

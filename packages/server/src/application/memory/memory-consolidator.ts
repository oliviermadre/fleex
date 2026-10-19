import type { TicketCommentEntity } from '../../domain/entities/ticket-comment.entity.js';
import type { TicketMentionEntity } from '../../domain/entities/ticket-mention.entity.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import { isMemoryFeatureEnabled, type ConfigPort } from '../ports/config.port.js';
import type { KvStorePort } from '../ports/kv-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import { chunkCorrection } from './chunk-curated.js';
import type { MemoryKernel } from './memory-kernel.js';
import { NOTHING_SENTINEL, type MemorySynthesiser } from './memory-synthesiser.js';

/** Local hour after which the nightly pass becomes due, when none is configured. */
export const DEFAULT_CONSOLIDATION_HOUR = 3;

/**
 * Shortest human message, once its @mentions are stripped, that can carry a
 * correction. Below it sit "go", "ok parfait", "pourquoi ?" — approvals and
 * questions, which are never worth a model call. A starting value: the dry-run
 * reports candidates and positives, and that ratio is what should move it.
 */
export const MIN_CORRECTION_CHARS = 25;

/** Exchanges judged per model call. ~15 000 characters in, far from any limit. */
export const JUDGE_BATCH_SIZE = 10;

/** Each block sent to the judge is cut to this. */
const JUDGE_BLOCK_MAX = 1_500;

/** First pass with no watermark looks back this far. */
const FIRST_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How far back an automatic pass always looks, whatever the watermark says.
 *
 * An exchange the judge failed on (timeout, unreadable line) gets no verdict
 * marker, and its `resolvedAt` is already behind the next watermark. Looking back
 * a week is what retries it; the markers keep everything already judged free.
 */
const RETRY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const STATE_KEY = 'memory:consolidation:state';
const VERDICT_PREFIX = 'memory:correction-verdict:';

const JUDGE_SYSTEM_PROMPT = `
You read numbered exchanges from tickets. Each one is a human message addressed
to an AI agent, and the agent's reply. For EACH exchange, decide whether the
human CORRECTED the agent.

It is a correction only if BOTH hold:
1. The human contradicts, rejects or overrides something the agent previously
   said, concluded or did (a claim, a conclusion, an approach, a refusal).
   A new instruction, a request for more work, an approval ("go", "ok"),
   a question or a decision between options the agent offered is NOT a correction.
2. The agent's reply accepts the correction and changes course.
   If the agent pushes back, or the reply is unrelated, it is NOT a correction.

Output exactly one line per exchange, in order, formatted "<n>: <answer>".
<answer> is either the generalisable lesson as an instruction to the agent
("Before concluding X, try Y"), with no ticket-specific details such as file
names, ticket numbers or people unless they ARE the lesson, or the single
token ${NOTHING_SENTINEL}. When in doubt, output ${NOTHING_SENTINEL}.
`.trim();

export interface ConsolidationState {
  lastRunAt: string;
  /** Local date (YYYY-MM-DD) of the last automatic pass: decides whether today's is done. */
  lastRunDate: string;
  /** Mentions resolved at or before this have been through a complete pass. */
  watermark: string;
  stats: ConsolidationStats;
}

export interface ConsolidationStats {
  resolvedMentions: number;
  candidates: number;
  judged: number;
  batches: number;
  failedBatches: number;
  corrections: number;
  skipped: number;
}

export interface ConsolidationVerdict {
  mentionId: string;
  ticketDisplayId: number | string | null;
  agentName: string;
  /** `unjudged`: the call failed or skipped this line; it is retried later. */
  verdict: 'lesson' | 'nothing' | 'unjudged';
  lesson?: string;
}

export interface ConsolidationResult {
  status: 'done' | 'unavailable' | 'disabled' | 'busy';
  dryRun: boolean;
  window: { from: string; to: string } | null;
  stats: ConsolidationStats;
  verdicts: ConsolidationVerdict[];
}

export interface ConsolidationOptions {
  /** Look back this many days instead of from the watermark. Never moves the watermark. */
  sinceDays?: number;
  /** Judge, but write nothing: no chunk, no marker, no state. */
  dryRun?: boolean;
}

export interface MemoryConsolidatorDeps {
  config: ConfigPort;
  kernel: MemoryKernel;
  mentionStore: MentionStorePort;
  commentStore: CommentStorePort;
  ticketStore: TicketStorePort;
  /** Holds the watermark and the verdict markers. Null on the filesystem fallback. */
  kvStore: KvStorePort | null;
  synthesiser: MemorySynthesiser;
  logger: LoggerPort;
  /**
   * Whether this instance schedules background work. A QA worktree sharing the
   * main database must not consolidate with unmerged code — same rule as routines.
   */
  schedulerArmed: boolean;
  now?: () => Date;
}

/** One exchange that passed the free filters, ready for the judge. */
interface Exchange {
  mention: TicketMentionEntity;
  ticket: TicketEntity;
  correction: TicketCommentEntity;
  response: TicketCommentEntity;
  agentSaid: TicketCommentEntity | null;
}

const EMPTY_STATS: ConsolidationStats = {
  resolvedMentions: 0, candidates: 0, judged: 0, batches: 0, failedBatches: 0, corrections: 0, skipped: 0,
};

/**
 * Learns, once a night, from the times a human corrected an agent unprompted.
 *
 * A `qa_pair` only exists when an agent asked: it is written on
 * `mention.woken_up`. When an agent is confidently wrong it asks nothing, the
 * human steps in, and that exchange — the one most worth learning from — left no
 * structured trace. This pass reads the mentions resolved since the last one,
 * drops approvals and questions for free, has the cheap model judge the rest in
 * batches, and indexes each correction as a curated `correction` chunk.
 *
 * Nightly rather than live: an exchange judged after the fact is finished, the
 * agent's reply is final, and a whole day costs a call or two. A timer rather
 * than a routine, because a routine starts an agent session — far heavier than
 * reading a few exchanges.
 */
export class MemoryConsolidator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private loggedNoKv = false;

  constructor(private readonly deps: MemoryConsolidatorDeps) {}

  start(tickMs: number): void {
    this.stop();
    if (tickMs <= 0) return;
    this.timer = setInterval(() => void this.tick(), tickMs);
    this.timer.unref?.();
    this.deps.logger.info('Memory consolidation scheduler started', { tickMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run the nightly pass if it is due. Public for tests and for a boot-time check.
   *
   * Due on the first tick past the configured hour on a day that has not had its
   * pass, rather than at the hour exactly: a laptop closed at 3 a.m. must not
   * skip the night, it consolidates when it wakes.
   */
  async tick(): Promise<ConsolidationResult | null> {
    if (!this.deps.schedulerArmed) return null;
    if (!isMemoryFeatureEnabled(this.deps.config.get(), 'consolidation')) return null;
    if (!this.deps.kvStore) {
      if (!this.loggedNoKv) {
        this.loggedNoKv = true;
        this.deps.logger.info('Memory consolidation needs a KV store; no nightly pass on this driver');
      }
      return null;
    }

    const now = this.now();
    if (now.getHours() < this.hour()) return null;
    const state = await this.readState();
    if (state && state.lastRunDate >= localDate(now)) return null;

    return this.run({});
  }

  /**
   * One pass. Shared by the timer and `fleex memory consolidate`.
   *
   * Without `sinceDays` it is the nightly pass and records its state; with it, it
   * is a catch-up over history that leaves the watermark alone.
   */
  async run(options: ConsolidationOptions): Promise<ConsolidationResult> {
    const dryRun = !!options.dryRun;
    const config = this.deps.config.get();
    if (config.memoryEngine !== 'semantic') {
      return { status: 'unavailable', dryRun, window: null, stats: { ...EMPTY_STATS }, verdicts: [] };
    }
    if (!isMemoryFeatureEnabled(config, 'consolidation')) {
      return { status: 'disabled', dryRun, window: null, stats: { ...EMPTY_STATS }, verdicts: [] };
    }
    if (this.running) {
      return { status: 'busy', dryRun, window: null, stats: { ...EMPTY_STATS }, verdicts: [] };
    }

    this.running = true;
    try {
      return await this.pass(options, dryRun);
    } finally {
      this.running = false;
    }
  }

  /** What `memory status` shows about the pass. */
  async status(): Promise<{
    scheduled: boolean;
    lastRunAt: string | null;
    watermark: string | null;
    stats: ConsolidationStats | null;
    nextDueAfter: string | null;
  }> {
    const state = await this.readState();
    const scheduled = this.deps.schedulerArmed
      && !!this.deps.kvStore
      && isMemoryFeatureEnabled(this.deps.config.get(), 'consolidation');

    let nextDueAfter: string | null = null;
    if (scheduled) {
      const now = this.now();
      const due = new Date(now);
      due.setHours(this.hour(), 0, 0, 0);
      if (state && state.lastRunDate >= localDate(now)) due.setDate(due.getDate() + 1);
      nextDueAfter = due.toISOString();
    }

    return {
      scheduled,
      lastRunAt: state?.lastRunAt ?? null,
      watermark: state?.watermark ?? null,
      stats: state?.stats ?? null,
      nextDueAfter,
    };
  }

  // ─── The pass ───

  private async pass(options: ConsolidationOptions, dryRun: boolean): Promise<ConsolidationResult> {
    const now = this.now();
    const nightly = options.sinceDays === undefined;
    const state = await this.readState();

    const from = nightly
      ? new Date(Math.min(
          state ? Date.parse(state.watermark) : now.getTime() - FIRST_WINDOW_MS,
          now.getTime() - RETRY_LOOKBACK_MS,
        ))
      : new Date(now.getTime() - options.sinceDays! * 24 * 60 * 60 * 1000);

    const mentions = (await this.deps.mentionStore.getAll()).filter((m) =>
      m.status === 'resolved'
      && m.targetType === 'agent'
      && !!m.resolvedAt
      && m.resolvedAt.getTime() > from.getTime()
      && m.resolvedAt.getTime() <= now.getTime());

    const stats: ConsolidationStats = { ...EMPTY_STATS, resolvedMentions: mentions.length };
    const verdicts: ConsolidationVerdict[] = [];

    const exchanges: Exchange[] = [];
    for (const [ticketId, group] of groupBy(mentions, (m) => m.ticketId)) {
      const ticket = await this.deps.ticketStore.getTicketById(ticketId);
      if (!ticket) continue;
      const comments = await this.deps.commentStore.getByTicket(ticketId);
      for (const mention of group) {
        const exchange = selectExchange(mention, ticket, comments);
        if (!exchange) continue;
        stats.candidates++;
        if (await this.hasVerdict(mention.id)) {
          stats.skipped++;
          continue;
        }
        exchanges.push(exchange);
      }
    }

    exchanges.sort((a, b) => a.mention.resolvedAt!.getTime() - b.mention.resolvedAt!.getTime());

    for (let i = 0; i < exchanges.length; i += JUDGE_BATCH_SIZE) {
      const batch = exchanges.slice(i, i + JUDGE_BATCH_SIZE);
      stats.batches++;
      const answers = await this.judge(batch);
      if (!answers) stats.failedBatches++;

      for (const [index, exchange] of batch.entries()) {
        const answer = answers?.get(index + 1) ?? null;
        const base = {
          mentionId: exchange.mention.id,
          ticketDisplayId: exchange.ticket.displayId ?? null,
          agentName: exchange.mention.targetAgent,
        };
        if (answer === null) {
          verdicts.push({ ...base, verdict: 'unjudged' });
          continue;
        }
        stats.judged++;
        if (answer === NOTHING_SENTINEL) {
          verdicts.push({ ...base, verdict: 'nothing' });
          if (!dryRun) await this.setVerdict(exchange.mention.id, 'negative');
          continue;
        }
        verdicts.push({ ...base, verdict: 'lesson', lesson: answer });
        if (dryRun) {
          stats.corrections++;
          continue;
        }
        try {
          await this.deps.kernel.ingest('correction', exchange.mention.id, toChunks(exchange, answer));
          await this.setVerdict(exchange.mention.id, 'positive');
          stats.corrections++;
        } catch (error) {
          // No marker: the next pass retries it.
          this.deps.logger.warn('Indexing a correction failed', {
            mentionId: exchange.mention.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (nightly && !dryRun && this.deps.kvStore) {
      await this.writeState({
        lastRunAt: now.toISOString(),
        lastRunDate: localDate(now),
        // Only a pass with no failed batch moves the watermark: the failed
        // exchanges have no marker, and the next pass must still see them.
        watermark: stats.failedBatches === 0 ? now.toISOString() : (state?.watermark ?? from.toISOString()),
        stats,
      });
    }

    this.deps.logger.info('Memory consolidation pass finished', { dryRun, nightly, ...stats });
    return {
      status: 'done',
      dryRun,
      window: { from: from.toISOString(), to: now.toISOString() },
      stats,
      verdicts,
    };
  }

  /**
   * One model call for up to ten exchanges.
   *
   * Returns the answer per 1-based exchange number, or null when the call
   * failed. A line the model skipped is simply absent from the map.
   */
  private async judge(batch: Exchange[]): Promise<Map<number, string> | null> {
    const raw = await this.deps.synthesiser.run(
      { systemPrompt: JUDGE_SYSTEM_PROMPT, userPrompt: buildJudgePrompt(batch) },
      { task: 'correction-judge', exchanges: batch.length },
    );
    // The synthesiser folds a failed call and a bare decline into null. A batch
    // asked for numbered lines never legitimately answers with the bare token,
    // so both are treated as "not judged" — retried, never marked.
    if (!raw) {
      this.deps.logger.warn('Correction judge returned nothing for a batch', { exchanges: batch.length });
      return null;
    }
    return parseJudgeAnswers(raw, batch.length);
  }

  // ─── State ───

  private async readState(): Promise<ConsolidationState | null> {
    const raw = await this.deps.kvStore?.get(STATE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ConsolidationState;
    } catch {
      return null;
    }
  }

  private async writeState(state: ConsolidationState): Promise<void> {
    await this.deps.kvStore?.set(STATE_KEY, JSON.stringify(state));
  }

  private async hasVerdict(mentionId: string): Promise<boolean> {
    return !!(await this.deps.kvStore?.get(`${VERDICT_PREFIX}${mentionId}`));
  }

  private async setVerdict(mentionId: string, verdict: 'positive' | 'negative'): Promise<void> {
    await this.deps.kvStore?.set(`${VERDICT_PREFIX}${mentionId}`, verdict);
  }

  private hour(): number {
    const configured = this.deps.config.get().memoryConsolidationHour;
    return Number.isInteger(configured) && configured! >= 0 && configured! <= 23
      ? configured!
      : DEFAULT_CONSOLIDATION_HOUR;
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
}

// ─── Pure helpers, exported for tests ───

/**
 * The free, deterministic filter: is this resolved mention a human message to an
 * agent, answered by that agent, long enough to be more than an approval?
 *
 * The pair is read off the mention itself — `commentId` is the human message,
 * `resolvedCommentId` the agent's reply — because the thread order cannot be
 * trusted: on #694 the comment just before the correction was another agent's,
 * and the correction had no parent.
 */
export function selectExchange(
  mention: TicketMentionEntity,
  ticket: TicketEntity,
  comments: TicketCommentEntity[],
): Exchange | null {
  if (mention.status !== 'resolved' || mention.targetType !== 'agent') return null;

  const correction = comments.find((c) => c.id === mention.commentId);
  if (!correction || correction.authorType !== 'user' || correction.visibility !== 'public') return null;
  if (stripMentions(correction.body).length < MIN_CORRECTION_CHARS) return null;

  const response = (mention.resolvedCommentId
    ? comments.find((c) => c.id === mention.resolvedCommentId)
    : null)
    ?? comments
      .filter((c) => c.authorType === 'agent'
        && c.parentId === correction.id
        && c.createdAt.getTime() > correction.createdAt.getTime())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]
    ?? null;
  if (!response || response.authorType !== 'agent' || response.visibility !== 'public') return null;

  const parent = correction.parentId ? comments.find((c) => c.id === correction.parentId) : null;
  const agentSaid = parent && parent.authorType === 'agent' && parent.visibility === 'public' ? parent : null;

  return { mention, ticket, correction, response, agentSaid };
}

/** A message's text without its `@agent:x`, `@workflow:y` or `@name` mentions. */
export function stripMentions(body: string): string {
  return body.replace(/@[\w:-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildJudgePrompt(batch: Exchange[]): string {
  return batch.map((e, i) => [
    `### ${i + 1} — agent: ${e.mention.targetAgent}`,
    e.agentSaid ? `What the agent said before:\n${cut(e.agentSaid.body)}` : null,
    `Human message:\n${cut(e.correction.body)}`,
    `Agent reply:\n${cut(e.response.body)}`,
  ].filter(Boolean).join('\n\n')).join('\n\n---\n\n');
}

/**
 * Read `<n>: <answer>` lines. Anything else — preamble, blank lines, numbers
 * outside the batch — is ignored, so a chatty answer still yields the lines it
 * got right.
 */
export function parseJudgeAnswers(raw: string, size: number): Map<number, string> {
  const answers = new Map<number, string>();
  for (const line of raw.split('\n')) {
    const match = /^\s*(?:[-*]\s*)?(\d+)\s*[:.)]\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const n = Number(match[1]);
    if (n < 1 || n > size || answers.has(n)) continue;
    const answer = match[2]!.replace(/^["'`]+|["'`]+$/g, '').trim();
    if (!answer) continue;
    answers.set(n, /^nothing\.?$/i.test(answer) ? NOTHING_SENTINEL : answer);
  }
  return answers;
}

function toChunks(exchange: Exchange, lesson: string) {
  const { mention, ticket, correction, response, agentSaid } = exchange;
  return chunkCorrection({
    mentionId: mention.id,
    ticketId: ticket.id,
    ticketTitle: ticket.title,
    ticketDisplayId: ticket.displayId,
    agentName: mention.targetAgent,
    humanName: correction.authorName,
    lesson,
    agentSaid: agentSaid?.body ?? null,
    correction: correction.body,
    response: response.body,
    repo: ticket.links?.find((l) => l.type === 'repository')?.ref ?? null,
    boardId: ticket.boardId,
    tags: ticket.tags,
    respondedAt: response.createdAt,
  });
}

function cut(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= JUDGE_BLOCK_MAX ? trimmed : `${trimmed.slice(0, JUDGE_BLOCK_MAX - 1)}…`;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/** Local calendar date, YYYY-MM-DD — what "has today's pass run" is about. */
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

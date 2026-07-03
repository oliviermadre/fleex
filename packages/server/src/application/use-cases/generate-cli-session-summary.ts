import { randomUUID } from 'node:crypto';
import { CLI_SESSION_SUMMARY_TYPE } from '@fleex/shared';
import { TicketDeliverableEntity } from '../../domain/entities/ticket-deliverable.entity.js';
import { reconstructTranscript, type TranscriptTurn } from '../utils/cli-session-ingest.js';
import type { DeliverableStorePort } from '../ports/deliverable-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { EventBus } from '../event-bus.js';
import type { SdkConcurrencyLimiter } from '../services/sdk-concurrency-limiter.js';

const MODEL = 'claude-haiku-4-5-20251001';

/** Sentinel the model emits when the session is not worth persisting. */
const SKIP_SENTINEL = 'SKIP';

const SYSTEM_PROMPT = `You are a technical summarizer preserving the decision trail of a manual Claude Code CLI session for developer memory (bus-factor mitigation). The code and PR capture the outcome; your job is to capture WHY — the arbitrations and decisions made along the way, which would otherwise be lost when the session ends.

You are given the reconstructed user/assistant conversation of one CLI session (tool calls already stripped). Use the session date provided in the input for the header.

Structure your output EXACTLY as follows:

## CLI session — {session date}

### What was done
Outcome-level summary of the work performed this session.

### Topics that required arbitration
- Topic — the tension / the options that were on the table
(omit this whole section if there were none)

### Decisions & tradeoffs taken
- Decision — rationale — tradeoff accepted
(omit this whole section if there were none)

Rules:
- Be factual, not speculative — only describe what actually happened.
- No raw diffs, stack traces, file dumps, or tool spam.
- ~400 words max.
- Omit the optional sections that have no meaningful content.

You are the sole judge of whether this session is worth persisting. If it contains no meaningful work or decisions worth remembering later (a quick question, a trivial lookup, no arbitration), output the single token ${SKIP_SENTINEL} and nothing else.`.trim();

/**
 * Summarize a finished manual Claude *CLI* session into a system-managed
 * `cli-session-summary` deliverable on the belonging ticket — capturing the
 * decisions/arbitrations that live only in the ephemeral transcript.
 *
 * Invoked on the `SessionEnd` hook path AFTER {@link IngestCliSessionUseCase}
 * confirms the session is a CLI session belonging to this workspace's ticket, so
 * it inherits every routing/entrypoint guard for free. Best-effort: never blocks
 * or fails the hook response.
 *
 * Idempotent via the deliverable's `mentionId` (`cli:<sessionId>`) — mirrors the
 * cost execution row's key — so retried/fanned-out hooks produce exactly one
 * deliverable per session. The model alone decides (via the SKIP sentinel)
 * whether a session is worth persisting; the only non-LLM short-circuit is an
 * empty transcript (no assistant content → nothing to summarize).
 */
export class GenerateCliSessionSummaryUseCase {
  public eventBus?: EventBus;

  constructor(
    private readonly deliverableStore: DeliverableStorePort,
    private readonly logger: LoggerPort,
    private readonly sdkLimiter: SdkConcurrencyLimiter,
  ) {}

  async execute(params: { sessionId: string; ticketId: string; transcriptPath: string }): Promise<void> {
    const { sessionId, ticketId, transcriptPath } = params;
    const mentionId = `cli:${sessionId}`;

    // Idempotency: one deliverable per session. `DeliverableStorePort` has no
    // per-mention lookup, but per-ticket deliverable counts are tiny — filter
    // in memory (no port/adapter change).
    const existing = await this.deliverableStore.getByTicket(ticketId);
    if (existing.some((d) => d.mentionId === mentionId)) {
      this.logger.debug('CLI session summary already exists — skipping', { sessionId, ticketId });
      return;
    }

    // Reconstruct the conversation (tool noise stripped). No assistant content =>
    // nothing to summarize (pure cost guard, not an interest judgment).
    const turns = await reconstructTranscript(transcriptPath);
    if (!turns.some((t) => t.role === 'assistant')) {
      this.logger.debug('CLI session has no assistant content — skipping summary', { sessionId, ticketId });
      return;
    }

    const dateStr = formatSessionDate(new Date());
    const userPrompt = buildSessionPrompt(turns, dateStr);

    // Call Claude via Agent SDK (same auth as every other agent — no API key).
    let summaryText: string;
    const releaseSdkSlot = await this.sdkLimiter.acquire();
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      let resultText = '';
      for await (const message of query({
        prompt: userPrompt,
        options: {
          model: MODEL,
          systemPrompt: SYSTEM_PROMPT,
          allowedTools: [],
          permissionMode: 'dontAsk' as const,
          maxTurns: 0,
        },
      })) {
        if ('result' in message) {
          resultText = (message as { result: string }).result;
        }
      }
      summaryText = resultText.trim();
    } catch (err) {
      this.logger.error('Claude Agent SDK call failed for CLI session summary', {
        sessionId,
        ticketId,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    } finally {
      releaseSdkSlot();
    }

    // The model is the sole judge of interest: SKIP (or nothing) => no deliverable.
    if (!summaryText || summaryText === SKIP_SENTINEL) {
      this.logger.info('CLI session judged not worth persisting — no summary created', { sessionId, ticketId });
      return;
    }

    const deliverable = TicketDeliverableEntity.create({
      id: randomUUID(),
      ticketId,
      agentName: 'system',
      type: CLI_SESSION_SUMMARY_TYPE,
      title: `CLI session — ${dateStr}`,
      content: summaryText,
      status: 'final',
      mentionId,
    });
    await this.deliverableStore.save(deliverable);
    this.logger.info('CLI session summary created', { sessionId, ticketId, deliverableId: deliverable.id });
    this.eventBus?.emit({
      type: 'deliverable.created',
      deliverableId: deliverable.id,
      ticketId,
      agentName: 'system',
      status: 'final',
      title: deliverable.title,
      occurredAt: new Date(),
    });
  }
}

/** Format a Date as `YYYY-MM-DD HH:mm` in UTC (stable, timezone-agnostic). */
function formatSessionDate(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * Ceiling on the reconstructed conversation we feed to the model. Haiku's window
 * is ~200K tokens (~3-4 chars/token); we stay far under so the summary call can
 * never overflow — the failure mode that silently drops the *longest, most
 * decision-rich* sessions. These are safety ceilings, not aggressive compression:
 * once tool/subagent/system noise is stripped, genuine dialogue rarely approaches
 * them. Values are in characters (cheap to measure, no tokenizer needed).
 */
export const MAX_TURN_CHARS = 16_000; // a single verbose turn / pasted blob
export const MAX_TRANSCRIPT_CHARS = 240_000; // the whole conversation (~60-80K tokens)

/** Render the (budgeted) reconstructed turns into the SDK user prompt. */
export function buildSessionPrompt(turns: TranscriptTurn[], dateStr: string): string {
  const { head, tail, elided } = fitToBudget(turns);
  const render = (t: TranscriptTurn) => `**${t.role === 'user' ? 'User' : 'Assistant'}:**\n${t.text}\n`;
  const parts: string[] = [
    '# Claude Code CLI session',
    `Session date (use exactly this value in the header): ${dateStr}`,
    '\n## Conversation\n',
  ];
  for (const turn of head) parts.push(render(turn));
  if (elided > 0) parts.push(`\n_[… ${elided} intermediate turn(s) elided to fit the summary budget …]_\n`);
  for (const turn of tail) parts.push(render(turn));
  parts.push(`\n---\nWrite the CLI session summary now, or output ${SKIP_SENTINEL} if it is not worth persisting.`);
  return parts.join('\n');
}

/**
 * Keep the conversation within {@link MAX_TRANSCRIPT_CHARS}. Each turn is first
 * capped ({@link truncateTurnText}); if the total still overflows we keep turns
 * from the start (the ask + initial plan) and from the end (final decisions +
 * outcome) — the two highest-signal regions for a decision summary — and report
 * how many middle turns were elided so the prompt can flag the gap.
 */
function fitToBudget(turns: TranscriptTurn[]): { head: TranscriptTurn[]; tail: TranscriptTurn[]; elided: number } {
  const capped = turns.map((t): TranscriptTurn => ({ role: t.role, text: truncateTurnText(t.text) }));
  const total = capped.reduce((n, t) => n + t.text.length, 0);
  if (total <= MAX_TRANSCRIPT_CHARS) return { head: capped, tail: [], elided: 0 };

  const half = Math.floor(MAX_TRANSCRIPT_CHARS / 2);
  const head: TranscriptTurn[] = [];
  let headChars = 0;
  let i = 0;
  for (; i < capped.length; i++) {
    const len = capped[i]!.text.length;
    if (head.length > 0 && headChars + len > half) break;
    head.push(capped[i]!);
    headChars += len;
  }
  const tail: TranscriptTurn[] = [];
  let tailChars = 0;
  let j = capped.length - 1;
  for (; j >= i; j--) {
    const len = capped[j]!.text.length;
    if (tail.length > 0 && tailChars + len > half) break;
    tail.unshift(capped[j]!);
    tailChars += len;
  }
  return { head, tail, elided: Math.max(j - i + 1, 0) };
}

/**
 * Truncate one over-long turn, keeping its head and tail. The ends carry the ask
 * and the resolution; the middle of a giant paste (a log dump, a huge file) is the
 * least informative, so that is what we drop.
 */
function truncateTurnText(text: string): string {
  if (text.length <= MAX_TURN_CHARS) return text;
  const head = Math.ceil(MAX_TURN_CHARS * 0.6);
  const tail = MAX_TURN_CHARS - head;
  const omitted = text.length - MAX_TURN_CHARS;
  return `${text.slice(0, head)}\n\n[… ${omitted.toLocaleString('en-US')} characters truncated …]\n\n${text.slice(text.length - tail)}`;
}

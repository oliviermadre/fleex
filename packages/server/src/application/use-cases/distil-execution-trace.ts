import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import type { MemoryKernel } from '../memory/memory-kernel.js';
import { MemorySynthesiser, NOTHING_SENTINEL } from '../memory/memory-synthesiser.js';
import { splitMarkdown } from '../memory/chunker.js';
import type { DraftChunk } from '../memory/chunker.js';
import type { ExecutionTraceInput } from './execute-agent.js';
import type { RetrieveContextUseCase } from './retrieve-context.js';

/** Cap on the run text handed to the distiller. */
const MAX_RESULT_CHARS = 20_000;

/** Cap on the diff summary. A diffstat is short; a truncated one is still useful. */
const MAX_DIFF_CHARS = 4_000;

const SYSTEM_PROMPT = `
You distil what an agent's run discovered into a note for long-term memory.

You are given the agent's final message and, when available, the diff it produced.

Keep only what would help a *different* run later:
- facts about this codebase that were discovered, not assumed
- approaches that worked, and approaches that were tried and failed
- pitfalls, constraints and gotchas encountered
- which files or modules turned out to matter for this kind of work

Discard the narration of doing the work, restatements of the task, and anything
true only of this one ticket.

Write terse markdown bullets, under 200 words. No preamble, no code fence.

If the run discovered nothing that generalises, output the single token
${NOTHING_SENTINEL}.
`.trim();

/**
 * Turns a finished run into memory.
 *
 * Agent runs already persist their event stream, but it is inert: nobody reads a
 * log, and the discovery inside it — "the arm runner has no docker", "this module
 * needs the migration applied first" — is lost the moment the run ends, so the
 * next agent rediscovers it from scratch.
 *
 * The distillation is deliberately about *transferable* findings rather than a
 * summary of the run. A recap of what an agent did is of no use to a later run;
 * what the agent learned about the codebase is.
 */
export class DistilExecutionTraceUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly retrieveContext: RetrieveContextUseCase,
    private readonly synthesiser: MemorySynthesiser,
    private readonly git: GitPort,
    private readonly logger: LoggerPort,
    private readonly kernel?: MemoryKernel,
  ) {}

  async execute(trace: ExecutionTraceInput): Promise<boolean> {
    if (!this.kernel || !this.retrieveContext.isFeatureEnabled('executionTraces')) return false;

    const resultText = trace.resultText.trim();
    if (!resultText) return false;

    const ticket = await this.ticketStore.getTicketById(trace.ticketId);
    if (!ticket) return false;

    const diff = await this.diffSummary(ticket, trace.worktreePath);

    const note = await this.synthesiser.run(
      {
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: buildTracePrompt(trace.personaName, resultText, diff),
      },
      { executionId: trace.executionId, ticketId: trace.ticketId },
    );
    // Most runs discover nothing that generalises; a memory full of "the agent
    // edited a file" would drown the runs that did.
    if (!note) return false;

    await this.kernel.ingest('execution_trace', trace.executionId, buildChunks(trace, ticket, note));
    this.logger.info('Distilled an execution trace into memory', {
      executionId: trace.executionId, ticketId: trace.ticketId,
    });
    return true;
  }

  /**
   * The diff the run left behind.
   *
   * Best-effort: a run on a ticket with no worktree, or whose worktree was already
   * reaped, still has its final message to distil — the diff sharpens the note but
   * is not required for one.
   */
  private async diffSummary(ticket: TicketEntity, worktreePath?: string | null): Promise<string> {
    const branch = ticket.links.find((l) => l.type === 'worktree')?.ref;
    if (!worktreePath || !branch) return '';
    try {
      const summary = await this.git.getDiffSummary(worktreePath, branch);
      return summary.slice(0, MAX_DIFF_CHARS);
    } catch (error) {
      this.logger.debug('No diff available for execution trace', {
        error: error instanceof Error ? error.message : String(error),
      });
      return '';
    }
  }
}

export function buildTracePrompt(personaName: string, resultText: string, diff: string): string {
  const parts = [
    `Agent: ${personaName}`,
    '',
    '## Final message',
    '',
    resultText.slice(0, MAX_RESULT_CHARS),
  ];
  if (diff) {
    parts.push('', '## Diff produced', '', diff);
  }
  parts.push('', '---', 'Distil the transferable findings now.');
  return parts.join('\n');
}

function buildChunks(trace: ExecutionTraceInput, ticket: TicketEntity, note: string): DraftChunk[] {
  const label = ticket.displayId ? `Ticket #${ticket.displayId}` : 'Ticket';
  const parts = splitMarkdown(note);
  const repo = ticket.links.find((l) => l.type === 'repository')?.ref ?? null;

  return parts.map((content, chunkIndex) => ({
    sourceKind: 'execution_trace' as const,
    sourceId: trace.executionId,
    chunkIndex,
    title: parts.length > 1
      ? `${label}: ${ticket.title} > ${trace.personaName} found (${chunkIndex + 1}/${parts.length})`
      : `${label}: ${ticket.title} > ${trace.personaName} found`,
    content,
    metadata: {
      ticketId: ticket.id,
      boardId: ticket.boardId,
      repo,
      agentName: trace.personaName,
      tags: ticket.tags,
    },
    sourceUpdatedAt: new Date(),
  }));
}

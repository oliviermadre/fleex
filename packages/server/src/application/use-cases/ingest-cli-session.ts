import { existsSync } from 'node:fs';
import { computeSessionCost, detectFleexTicket } from '../utils/cli-session-ingest.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export interface IngestCliSessionResult {
  ingested: boolean;
  /** Why nothing was ingested (not-fleex, other-workspace, entrypoint:sdk-ts, …). */
  reason?: string;
  ticketId?: string;
  costUsd?: number;
}

/**
 * Ingest one finished manual `claude` CLI session into Fleex as a `source='cli'`
 * execution, so its cost shows in stats next to the agentic (SDK) runs.
 *
 * Skips (returns `ingested:false`) when: the cwd isn't under a Fleex worktree,
 * the ticket doesn't belong to this instance's workspace (routing — the same
 * event is fanned out to every running instance), or the transcript isn't a CLI
 * session (`entrypoint !== 'cli'` — SDK runs are already recorded by the server).
 *
 * Idempotent via `agentEventStore.upsertCliExecution` (stable `cli:<sessionId>` key).
 */
export class IngestCliSessionUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly agentEventStore: AgentEventStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(params: { sessionId: string; transcriptPath: string; cwd: string }): Promise<IngestCliSessionResult> {
    const { sessionId, transcriptPath, cwd } = params;
    if (!sessionId || !transcriptPath || !cwd) return { ingested: false, reason: 'missing-params' };
    if (!existsSync(transcriptPath)) return { ingested: false, reason: 'no-transcript' };

    const ticketId = detectFleexTicket(cwd);
    if (!ticketId) return { ingested: false, reason: 'not-fleex' };

    // Routing: every running instance receives the hook; only the one whose DB
    // owns this ticket ingests it.
    const ticket = await this.ticketStore.getTicketById(ticketId);
    if (!ticket) return { ingested: false, reason: 'other-workspace' };

    const c = await computeSessionCost(transcriptPath);
    if (c.entrypoint !== 'cli') return { ingested: false, reason: `entrypoint:${c.entrypoint ?? 'none'}` };

    const startedAt = c.startedAt ?? c.completedAt ?? new Date().toISOString();
    const completedAt = c.completedAt ?? startedAt;
    const durationMs = c.startedAt && c.completedAt
      ? new Date(c.completedAt).getTime() - new Date(c.startedAt).getTime()
      : null;

    await this.agentEventStore.upsertCliExecution({
      executionId: `cli:${sessionId}`,
      sdkSessionId: sessionId,
      ticketId,
      mentionId: `cli:${sessionId}`,
      model: c.model,
      startedAt,
      completedAt,
      durationMs,
      costUsd: c.cost,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      cacheReadTokens: c.cacheReadTokens,
      cacheCreationTokens: c.cacheCreationTokens,
    });

    this.logger.info('Ingested CLI session', { sessionId, ticketId, costUsd: c.cost });
    return { ingested: true, ticketId, costUsd: c.cost };
  }
}

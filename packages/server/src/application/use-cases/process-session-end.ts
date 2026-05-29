import { randomUUID } from 'node:crypto';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type { HostFs } from '../../infrastructure/host/types.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { ClaudeStatePort } from '../ports/claude-state.port.js';
import type { SessionSummarizerPort } from '../ports/session-summarizer.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { SubmitDeliverableUseCase } from './submit-deliverable.js';
import { parseTranscriptUsage, extractTranscriptText } from '../utils/parse-transcript-usage.js';

/** Synthetic persona id for manually-run (human) Claude Code sessions. */
export const MANUAL_SESSION_PERSONA_ID = 'manual';

export interface ProcessSessionEndResult {
  recorded: boolean;
  reason?: 'no-ticket' | 'ticket-not-found' | 'no-transcript' | 'no-usage';
  ticketId?: string;
  executionId?: string;
  summarized?: boolean;
}

/**
 * Background handler for `SessionEnd`. Reconciles the ticket from the session's
 * cwd via the workspace `.fleex.json` manifest (no fleex session needed), tallies
 * token usage from the transcript into a `source: 'manual'` execution row, and
 * stores an LLM summary as a `ticket-summary` deliverable.
 *
 * Never throws — it runs fire-and-forget off the hook path.
 */
export class ProcessSessionEndUseCase {
  constructor(
    private readonly resolver: RepoPathResolver,
    private readonly ticketStore: TicketStorePort,
    private readonly agentEventStore: AgentEventStorePort,
    private readonly claudeState: ClaudeStatePort,
    private readonly summarizer: SessionSummarizerPort,
    private readonly submitDeliverable: SubmitDeliverableUseCase,
    private readonly hostFs: HostFs,
    private readonly logger: LoggerPort,
  ) {}

  async execute(params: {
    cwd: string;
    transcriptPath: string | null;
    claudeSessionId: string | null;
  }): Promise<ProcessSessionEndResult> {
    try {
      // 1. cwd → ticket via the workspace manifest.
      const manifest = this.resolver.resolveManifest(params.cwd);
      if (!manifest?.ticketId) return { recorded: false, reason: 'no-ticket' };

      const ticket = await this.ticketStore.getTicketById(manifest.ticketId);
      if (!ticket) return { recorded: false, reason: 'ticket-not-found' };

      // 2. Locate + read the transcript (Claude supplies the path; fall back to cwd lookup).
      const content = await this.readTranscript(params.transcriptPath, params.cwd);
      if (content == null) return { recorded: false, reason: 'no-transcript', ticketId: ticket.id };

      // 3. Tally token usage into a manual execution row.
      const usage = parseTranscriptUsage(content);
      if (usage.assistantTurns === 0) {
        return { recorded: false, reason: 'no-usage', ticketId: ticket.id };
      }

      const executionId = randomUUID();
      const mentionId = `manual:${params.claudeSessionId ?? executionId}`;
      const durationMs =
        usage.firstTimestamp && usage.lastTimestamp
          ? Math.max(0, new Date(usage.lastTimestamp).getTime() - new Date(usage.firstTimestamp).getTime())
          : undefined;

      await this.agentEventStore.startExecution({
        executionId,
        personaId: MANUAL_SESSION_PERSONA_ID,
        ticketId: ticket.id,
        mentionId,
        source: 'manual',
      });
      await this.agentEventStore.completeExecution(executionId, 'completed', {
        model: usage.model ?? undefined,
        durationMs,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
      });

      this.logger.info('Recorded manual session usage', {
        ticketId: ticket.id,
        executionId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        assistantTurns: usage.assistantTurns,
      });

      // 4. Summarize and store as a deliverable (best-effort).
      let summarized = false;
      const conversationText = extractTranscriptText(content);
      const summary = await this.summarizer.summarize({
        conversationText,
        ticketTitle: ticket.title,
        cwd: params.cwd,
      });
      if (summary) {
        const date = new Date().toISOString().slice(0, 10);
        await this.submitDeliverable.execute({
          ticketId: ticket.id,
          agentName: 'Manual Session',
          type: 'ticket-summary',
          title: `Session summary — ${date}`,
          content: summary,
          status: 'final',
          mentionId: null,
        });
        summarized = true;
      }

      return { recorded: true, ticketId: ticket.id, executionId, summarized };
    } catch (err) {
      this.logger.warn('ProcessSessionEnd failed', {
        cwd: params.cwd,
        error: err instanceof Error ? err.message : String(err),
      });
      return { recorded: false };
    }
  }

  private async readTranscript(transcriptPath: string | null, cwd: string): Promise<string | null> {
    const candidate = transcriptPath?.trim();
    if (candidate && (await this.hostFs.exists(candidate))) {
      try {
        return await this.hostFs.readFile(candidate);
      } catch {
        // fall through to lookup
      }
    }

    const info = await this.claudeState.findSessionFile(cwd);
    if (info?.path && (await this.hostFs.exists(info.path))) {
      try {
        return await this.hostFs.readFile(info.path);
      } catch {
        return null;
      }
    }
    return null;
  }
}

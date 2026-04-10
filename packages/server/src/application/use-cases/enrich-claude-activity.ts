import type { ClaudeActivityStatus } from '@fleex/shared';
import type { ClaudeStatePort } from '../ports/claude-state.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { SessionEntity } from '../../domain/entities.js';
import type { ClaudeMessage } from '../../domain/types/claude-message.js';
import { determineClaudeActivity } from '../../domain/services/claude-activity-determiner.js';

export class EnrichClaudeActivityUseCase {
  constructor(
    private readonly claudeState: ClaudeStatePort,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * Enriches running Claude sessions with fine-grained activity status.
   * Single `discoverClaudeProcesses()` call per cycle, then matches to sessions by CWD.
   */
  async execute(sessions: SessionEntity[]): Promise<Map<string, ClaudeActivityStatus>> {
    const result = new Map<string, ClaudeActivityStatus>();

    const claudeSessions = sessions.filter(
      (s) => s.status === 'running',
    );

    if (claudeSessions.length === 0) return result;

    // Single process discovery call for all sessions
    const processes = await this.claudeState.discoverClaudeProcesses();
    const processByCwd = new Map<string, { cpuPercent: number }>();
    for (const proc of processes) {
      // Accumulate CPU for all claude processes in the same CWD
      const existing = processByCwd.get(proc.cwd);
      if (existing) {
        existing.cpuPercent = Math.max(existing.cpuPercent, proc.cpuPercent);
      } else {
        processByCwd.set(proc.cwd, { cpuPercent: proc.cpuPercent });
      }
    }

    // Process each claude session
    const enrichTasks = claudeSessions.map(async (session) => {
      try {
        const activity = await this.enrichOne(session, processByCwd);
        if (activity !== 'unknown') {
          result.set(session.id, activity);
        }
      } catch (err) {
        this.logger.debug('Failed to enrich claude activity', {
          sessionId: session.id,
          error: String(err),
        });
      }
    });

    await Promise.all(enrichTasks);
    return result;
  }

  private async enrichOne(
    session: SessionEntity,
    processByCwd: Map<string, { cpuPercent: number }>,
  ): Promise<ClaudeActivityStatus> {
    const cwd = session.paneCwd ?? session.cwd;
    const sessionFile = await this.claudeState.findSessionFile(cwd);
    if (!sessionFile) return 'unknown';

    const rawLines = await this.claudeState.readLastMessages(sessionFile.path, 100);
    if (rawLines.length === 0) return 'unknown';

    const messages = parseMessages(rawLines);
    const processInfo = processByCwd.get(cwd);
    const cpuPercent = processInfo?.cpuPercent ?? 0;

    const hasPendingToolApproval = await this.claudeState.checkPendingToolApproval(
      sessionFile.path,
    );

    // const meaningful = messages.filter((m) => m.type === 'user' || m.type === 'assistant');
    // const lastMsg = meaningful[meaningful.length - 1];
    // const lastTools = Array.isArray(lastMsg?.message?.content)
    //   ? (lastMsg.message.content as Array<{type: string; name?: string}>).filter((b) => b.type === 'tool_use').map((b) => b.name)
    //   : [];

    const activity = determineClaudeActivity({
      messages,
      fileAgeSeconds: sessionFile.ageSeconds,
      cpuPercent,
      hasPendingToolApproval,
      isClaudeRunning: processInfo !== undefined,
    });

    // this.logger.info('Claude activity enrichment', {
    //   cwd: session.cwd,
    //   sessionId: session.id,
    //   file: sessionFile.path.split('/').pop(),
    //   ageSeconds: Math.round(sessionFile.ageSeconds),
    //   msgCount: messages.length,
    //   meaningfulCount: meaningful.length,
    //   lastType: lastMsg?.type,
    //   lastTools,
    //   cpuPercent,
    //   hasPendingToolApproval,
    //   activity,
    // });

    return activity;
  }
}

function parseMessages(lines: string[]): ClaudeMessage[] {
  const result: ClaudeMessage[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed.type === 'string') {
        result.push(parsed as ClaudeMessage);
      }
    } catch {
      // Skip malformed lines
    }
  }
  return result;
}

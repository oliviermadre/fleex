import type { SessionEntity } from '../../domain/entities.js';
import type { TmuxPort, TmuxSessionInfo } from '../ports/tmux.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class ListSessionsUseCase {
  constructor(
    private readonly sessionStore: SessionStorePort,
    private readonly tmux: TmuxPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(): Promise<SessionEntity[]> {
    const sessions = await this.sessionStore.getAll();

    let tmuxSessions: TmuxSessionInfo[];
    try {
      tmuxSessions = await this.tmux.listManagedSessions();
    } catch (err) {
      this.logger.warn('Failed to list tmux sessions, skipping reconciliation marking', {
        error: err instanceof Error ? err.message : String(err),
      });
      return sessions;
    }

    const tmuxNames = new Set(tmuxSessions.map((s) => s.name));

    for (const session of sessions) {
      if (!tmuxNames.has(session.tmuxName)) {
        if (session.status !== 'pending_reconciliation') {
          session.markPendingReconciliation();
          await this.sessionStore.save(session);
          this.logger.debug('Marked session as pending_reconciliation (tmux session gone)', {
            id: session.id,
            tmuxName: session.tmuxName,
          });
        }
      } else if (session.status === 'pending_reconciliation') {
        // Tmux session is back (reconciler recreated it) — mark running again
        session.status = 'running';
        await this.sessionStore.save(session);
        this.logger.debug('Session reconciled, marked as running', {
          id: session.id,
          tmuxName: session.tmuxName,
        });
      }
    }

    return sessions;
  }
}

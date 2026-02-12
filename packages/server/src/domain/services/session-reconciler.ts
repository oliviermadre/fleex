import type { TmuxPort } from '../../application/ports/tmux.port.js';
import type { SessionStorePort } from '../../application/ports/session-store.port.js';
import type { ConfigPort } from '../../application/ports/config.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';

const DEFAULT_INTERVAL_MS = 5_000;
const INITIAL_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 300_000;
const MAX_CONSECUTIVE_FAILURES = 5;

interface FailureTracker {
  consecutiveFailures: number;
  backoffUntil: number; // timestamp
}

export class SessionReconciler {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly failures = new Map<string, FailureTracker>();
  private reconciling = false;

  constructor(
    private readonly sessionStore: SessionStorePort,
    private readonly tmux: TmuxPort,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
  ) {}

  start(intervalMs = DEFAULT_INTERVAL_MS): void {
    if (this.intervalHandle) return;

    this.logger.info('Session reconciler started', { intervalMs });
    this.intervalHandle = setInterval(() => {
      void this.reconcile();
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.info('Session reconciler stopped');
    }
  }

  async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;

    try {
      const sessions = await this.sessionStore.getAll();
      const pendingSessions = sessions.filter(
        (s) => s.status === 'pending_reconciliation',
      );

      if (pendingSessions.length === 0) return;

      // Get current tmux state
      let tmuxNames: Set<string>;
      try {
        const tmuxSessions = await this.tmux.listManagedSessions();
        tmuxNames = new Set(tmuxSessions.map((s) => s.name));
      } catch (err) {
        this.logger.warn('Reconciler: failed to list tmux sessions', {
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      for (const session of pendingSessions) {
        // Already exists in tmux (maybe recreated externally)
        if (tmuxNames.has(session.tmuxName)) {
          session.status = 'running';
          await this.sessionStore.save(session);
          this.failures.delete(session.id);
          this.logger.info('Reconciler: session already running in tmux', {
            id: session.id,
            tmuxName: session.tmuxName,
          });
          continue;
        }

        // Check backoff
        const tracker = this.failures.get(session.id);
        if (tracker && Date.now() < tracker.backoffUntil) {
          continue; // Still in backoff period
        }

        // Attempt to recreate the tmux session
        try {
          const command =
            session.type === 'shell'
              ? this.config.get().defaultShell
              : undefined;

          await this.tmux.createSession({
            name: session.tmuxName,
            cwd: session.cwd,
            command,
          });

          // If claude type, send the claude command
          if (session.type === 'claude') {
            const claudeCmd = session.claudePrompt
              ? `${this.config.getClaudeCommand()} "${session.claudePrompt.replace(/"/g, '\\"')}"`
              : this.config.getClaudeCommand();
            await this.tmux.sendKeys(session.tmuxName, claudeCmd);
          }

          session.status = 'running';
          await this.sessionStore.save(session);
          this.failures.delete(session.id);

          this.logger.info('Reconciler: recreated tmux session', {
            id: session.id,
            tmuxName: session.tmuxName,
            type: session.type,
          });
        } catch (err) {
          const current = this.failures.get(session.id) ?? {
            consecutiveFailures: 0,
            backoffUntil: 0,
          };
          current.consecutiveFailures++;

          if (current.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            // Exponential backoff: 10s, 20s, 40s, 80s, 160s, capped at 300s
            const backoffMs = Math.min(
              INITIAL_BACKOFF_MS *
                Math.pow(2, current.consecutiveFailures - MAX_CONSECUTIVE_FAILURES),
              MAX_BACKOFF_MS,
            );
            current.backoffUntil = Date.now() + backoffMs;

            this.logger.warn('Reconciler: session creation failed, entering backoff', {
              id: session.id,
              tmuxName: session.tmuxName,
              failures: current.consecutiveFailures,
              backoffMs,
              error: err instanceof Error ? err.message : String(err),
            });
          } else {
            this.logger.debug('Reconciler: session creation failed, will retry', {
              id: session.id,
              tmuxName: session.tmuxName,
              failures: current.consecutiveFailures,
              error: err instanceof Error ? err.message : String(err),
            });
          }

          this.failures.set(session.id, current);
        }
      }
    } catch (err) {
      this.logger.error('Reconciler: unexpected error', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.reconciling = false;
    }
  }

  /** Clear failure tracking for a session (e.g. when manually killed). */
  clearFailures(sessionId: string): void {
    this.failures.delete(sessionId);
  }
}

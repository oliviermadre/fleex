import { resolve as resolvePath, sep as pathSep } from 'node:path';

import type { HookEventPayload, HookStatusUpdate } from '@fleex/shared';
import { mapHookEventToStatus } from '@fleex/shared';

import type { EventBus } from '../event-bus.js';
import type { GenerateCliSessionSummaryUseCase } from './generate-cli-session-summary.js';
import type { IngestCliSessionUseCase } from './ingest-cli-session.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';

/** Result returned to `POST /api/hook`. Always 200, never bubbles errors back to Claude. */
export interface ProcessHookEventResult {
  matched: boolean;
  sessionsTouched: number;
  /** Set when the event was observed but did not produce a status change (e.g. unknown notification_type). */
  observedOnly?: boolean;
  /** Per-session decisions for telemetry. */
  decisions: Array<{
    sessionId: string;
    previousStatus: string;
    nextStatus: string;
    changed: boolean;
  }>;
}

/**
 * Process a hook event sent by `fleex hook` — match CWD to sessions, apply the mapping,
 * persist, and emit a domain event so the dashboard can re-broadcast.
 *
 * Failure-safe: the caller (route) always returns 200, errors are logged.
 */
export class ProcessHookEventUseCase {
  constructor(
    private readonly sessionStore: SessionStorePort,
    private readonly eventBus: EventBus,
    private readonly logger: LoggerPort,
    /** Optional — when present, finished manual CLI sessions are ingested for cost tracking. */
    private readonly ingestCliSession?: IngestCliSessionUseCase,
    /** Optional — when present, ingested CLI sessions also get a decision-trail summary deliverable. */
    private readonly generateCliSessionSummary?: GenerateCliSessionSummaryUseCase,
  ) {}

  async execute(event: HookEventPayload): Promise<ProcessHookEventResult> {
    // Always log incoming events (audit trail — useful to discover unmapped notification_types).
    this.logger.info('Hook event received', {
      event: event.event,
      cwd: event.cwd,
      notification_type:
        typeof event.payload?.['notification_type'] === 'string'
          ? event.payload['notification_type']
          : undefined,
      tool_name:
        typeof event.payload?.['tool_name'] === 'string' ? event.payload['tool_name'] : undefined,
    });

    // Real-time CLI cost ingestion: at session end, record a finished manual
    // `claude` CLI session (independent of whether a Fleex session matches the
    // cwd — manual sessions usually have no Fleex session record). Best-effort;
    // never blocks the status mapping below or fails the hook.
    if (event.event === 'sessionEnd' && this.ingestCliSession) {
      const p = event.payload ?? {};
      const sessionId = typeof p['session_id'] === 'string' ? (p['session_id'] as string) : '';
      const transcriptPath =
        typeof p['transcript_path'] === 'string' ? (p['transcript_path'] as string) : '';
      try {
        const res = await this.ingestCliSession.execute({
          sessionId,
          transcriptPath,
          cwd: event.cwd,
        });
        if (res.ingested) {
          this.logger.info('CLI session cost ingested', {
            sessionId,
            ticketId: res.ticketId,
            costUsd: res.costUsd,
          });
          // The session is a confirmed CLI session owned by this workspace's
          // ticket — also persist its decision trail as a deliverable. Isolated
          // try/catch: a summary failure must never affect cost ingestion or the
          // hook response (best-effort, non-blocking).
          if (this.generateCliSessionSummary && res.ticketId) {
            try {
              await this.generateCliSessionSummary.execute({
                sessionId,
                ticketId: res.ticketId,
                transcriptPath,
              });
            } catch (err) {
              this.logger.warn('CLI session summary generation failed (ignored)', {
                error: err instanceof Error ? err.message : String(err),
                sessionId,
              });
            }
          }
        }
      } catch (err) {
        this.logger.warn('CLI session ingestion failed (ignored)', {
          error: err instanceof Error ? err.message : String(err),
          sessionId,
        });
      }
    }

    const update = mapHookEventToStatus(event);
    if (!update) {
      return { matched: false, sessionsTouched: 0, observedOnly: true, decisions: [] };
    }

    const allSessions = await this.sessionStore.getAll();
    const matched = allSessions.filter((s) => isCwdMatch(event.cwd, s.cwd));
    if (matched.length === 0) {
      this.logger.info('Hook event has no matching session', {
        cwd: event.cwd,
        event: event.event,
      });
      return { matched: false, sessionsTouched: 0, decisions: [] };
    }

    const decisions: ProcessHookEventResult['decisions'] = [];
    let touched = 0;

    for (const session of matched) {
      const previousStatus = session.hookStatus;
      const changed = session.applyHookUpdate(update);

      if (changed) {
        await this.sessionStore.save(session);
        touched += 1;
        this.eventBus.emit({
          type: 'session.hookStatusChanged',
          sessionId: session.id,
          previousStatus,
          nextStatus: update.status,
          waitingReason: update.waitingReason ?? null,
          occurredAt: new Date(),
        });
      }

      decisions.push({
        sessionId: session.id,
        previousStatus,
        nextStatus: session.hookStatus,
        changed,
      });
    }

    return { matched: true, sessionsTouched: touched, decisions };
  }
}

/**
 * The hook's CWD matches a session if it equals the session's CWD or is one of its sub-directories.
 *
 * Example matches (session.cwd = `/Users/x/.fleex/worktrees/my-ticket`):
 *   - hookCwd = same                                                                → match
 *   - hookCwd = `/Users/x/.fleex/worktrees/my-ticket/packages/web`                  → match (sub-dir)
 *   - hookCwd = `/Users/x/other-project`                                            → no match
 *   - hookCwd = `/Users/x/.fleex/worktrees`                                         → no match (parent of session)
 *
 * `path.resolve()` handles trailing slashes, `..`, and double slashes consistently.
 */
export function isCwdMatch(hookCwd: string, sessionCwd: string): boolean {
  if (!hookCwd || !sessionCwd) return false;
  const h = resolvePath(hookCwd);
  const s = resolvePath(sessionCwd);
  return h === s || h.startsWith(s + pathSep);
}

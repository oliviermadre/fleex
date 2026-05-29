import { resolve as resolvePath, sep as pathSep } from 'node:path';
import type { HookEventPayload, HookStatusUpdate } from '@fleex/shared';
import { mapHookEventToStatus } from '@fleex/shared';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { EventBus } from '../event-bus.js';

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
  ) {}

  async execute(event: HookEventPayload): Promise<ProcessHookEventResult> {
    // Always log incoming events (audit trail — useful to discover unmapped notification_types).
    this.logger.info('Hook event received', {
      event: event.event,
      cwd: event.cwd,
      notification_type: typeof event.payload?.['notification_type'] === 'string'
        ? event.payload['notification_type']
        : undefined,
      tool_name: typeof event.payload?.['tool_name'] === 'string'
        ? event.payload['tool_name']
        : undefined,
    });

    const update = mapHookEventToStatus(event);
    if (!update) {
      return { matched: false, sessionsTouched: 0, observedOnly: true, decisions: [] };
    }

    // SessionEnd → emit a domain event so a background handler can reconcile the
    // ticket from the cwd (via the `.fleex.json` manifest), tally token cost, and
    // store a summary. Emitted independently of fleex session matching because a
    // purely manual session may have no SessionEntity at all.
    if (event.event === 'sessionEnd') {
      const payload = event.payload ?? {};
      this.eventBus.emit({
        type: 'session.ended',
        cwd: event.cwd,
        transcriptPath: typeof payload['transcript_path'] === 'string' ? (payload['transcript_path'] as string) : null,
        claudeSessionId: typeof payload['session_id'] === 'string' ? (payload['session_id'] as string) : null,
        occurredAt: new Date(),
      });
    }

    const allSessions = await this.sessionStore.getAll();
    const matched = allSessions.filter((s) => isCwdMatch(event.cwd, s.cwd));
    if (matched.length === 0) {
      this.logger.info('Hook event has no matching session', { cwd: event.cwd, event: event.event });
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

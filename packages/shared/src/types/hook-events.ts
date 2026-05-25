/**
 * Hook events from Claude Code → Fleex.
 *
 * The CLI command `fleex hook <event>` is invoked by Claude Code (via
 * `~/.claude/settings.json`) and POSTs the captured payload to every running
 * Fleex server. Each server matches the CWD against its known sessions, then
 * derives a semantic `SessionHookStatus`.
 */

/** Subset of Claude Code hook events Fleex listens to. */
export type HookEventType =
  | 'sessionStart'
  | 'sessionEnd'
  | 'userPromptSubmit'
  | 'notification'
  | 'stop'
  | 'stopFailure'
  | 'preToolUse';

/** Whitelisted Notification.notification_type values that map to `waiting`. */
export type NotificationKind =
  | 'permission_prompt'
  | 'idle_prompt'
  | 'elicitation_dialog';

/** Semantic session status derived from hooks. */
export type SessionHookStatus =
  | 'unknown'
  | 'working'
  | 'waiting'
  | 'complete'
  | 'error'
  | 'idle';

/** Sub-classification of `waiting` for richer UI feedback. */
export type WaitingReason =
  | 'permission' // permission_prompt — Claude wants to call a tool
  | 'idle' // idle_prompt — Claude finished a turn, awaiting next instruction
  | 'question'; // elicitation_dialog or AskUserQuestion — Claude asks a structured question

/**
 * Wire format of the body POSTed by `fleex hook` to `/api/hook`.
 * The `payload` field carries Claude's raw stdin (snake_case from Claude Code).
 */
export interface HookEventPayload {
  /** Event type (Fleex camelCase). */
  event: HookEventType;
  /** CWD captured at hook execution time (Claude's $PWD). */
  cwd: string;
  /** Milliseconds epoch — used for anti-replay (>30s rejected). */
  timestamp: number;
  /** Raw JSON body Claude passed through stdin (kept as-is). */
  payload: Record<string, unknown>;
}

/**
 * Mapping outcome: what the hook should change in the session.
 * Returning `null` means the event is observed (and logged) but does not
 * touch `hookStatus` — used for non-status events.
 */
export interface HookStatusUpdate {
  /** Next semantic status. */
  status: SessionHookStatus;
  /** Refined reason when status === 'waiting'. */
  waitingReason?: WaitingReason;
  /** Free-form message for tooltips (last assistant message, tool name…). */
  message?: string;
}

/**
 * Strict whitelist mapper — any input not in the whitelist returns `null` so
 * we never produce a false-positive `waiting`.
 *
 * Whitelist (per ticket #119, see audit log strategy):
 *   - userPromptSubmit                                → working
 *   - notification(permission_prompt|idle_prompt|elicitation_dialog) → waiting
 *   - preToolUse(tool_name=AskUserQuestion)           → waiting/question  (defensive — covers the case where Claude's
 *                                                                          native AskUserQuestion does not fire Notification)
 *   - stop                                            → complete
 *   - stopFailure                                     → error
 *   - sessionEnd                                      → idle
 *   - sessionStart                                    → null (observability only)
 */
export function mapHookEventToStatus(
  event: HookEventPayload,
): HookStatusUpdate | null {
  switch (event.event) {
    case 'userPromptSubmit':
      return { status: 'working' };

    case 'stop':
      return { status: 'complete' };

    case 'stopFailure': {
      const errorType = stringField(event.payload, 'error_type');
      return {
        status: 'error',
        message: errorType ?? stringField(event.payload, 'error_message') ?? undefined,
      };
    }

    case 'sessionEnd':
      return { status: 'idle' };

    case 'sessionStart':
      return null; // observability only — no status change

    case 'notification': {
      const kind = stringField(event.payload, 'notification_type');
      if (kind === 'permission_prompt') {
        return {
          status: 'waiting',
          waitingReason: 'permission',
          message: stringField(event.payload, 'message') ?? undefined,
        };
      }
      if (kind === 'idle_prompt') {
        return {
          status: 'waiting',
          waitingReason: 'idle',
          message:
            stringField(event.payload, 'message') ??
            stringField(event.payload, 'last_assistant_message') ??
            undefined,
        };
      }
      if (kind === 'elicitation_dialog') {
        return {
          status: 'waiting',
          waitingReason: 'question',
          message: stringField(event.payload, 'message') ?? undefined,
        };
      }
      // auth_success, elicitation_complete, elicitation_response, unknown… → observed, no status change
      return null;
    }

    case 'preToolUse': {
      // Only react for AskUserQuestion — the native Claude Code tool for structured questions.
      // All other tool calls (Bash, Edit, Read…) are observed via Notification/permission_prompt
      // when they need approval, not via PreToolUse, so we don't double-fire.
      const toolName = stringField(event.payload, 'tool_name');
      if (toolName === 'AskUserQuestion') {
        return {
          status: 'waiting',
          waitingReason: 'question',
        };
      }
      return null;
    }

    default:
      return null;
  }
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}

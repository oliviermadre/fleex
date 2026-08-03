import { describe, it, expect } from 'vitest';

import { mapHookEventToStatus, type HookEventPayload } from '@fleex/shared';

import { isCwdMatch } from '../../src/application/use-cases/process-hook-event.js';
import { SessionEntity } from '../../src/domain/entities.js';

function event(
  partial: Partial<HookEventPayload> & Pick<HookEventPayload, 'event'>,
): HookEventPayload {
  return {
    cwd: '/tmp/x',
    timestamp: Date.now(),
    payload: {},
    ...partial,
  };
}

describe('mapHookEventToStatus — whitelist', () => {
  it('userPromptSubmit → working', () => {
    const r = mapHookEventToStatus(event({ event: 'userPromptSubmit' }));
    expect(r).toEqual({ status: 'working' });
  });

  it('stop → complete', () => {
    expect(mapHookEventToStatus(event({ event: 'stop' }))).toEqual({ status: 'complete' });
  });

  it('stopFailure → error with error_type message', () => {
    const r = mapHookEventToStatus(
      event({ event: 'stopFailure', payload: { error_type: 'rate_limit' } }),
    );
    expect(r).toEqual({ status: 'error', message: 'rate_limit' });
  });

  it('sessionEnd → idle', () => {
    expect(mapHookEventToStatus(event({ event: 'sessionEnd' }))).toEqual({ status: 'idle' });
  });

  it('sessionStart → null (observability only)', () => {
    expect(mapHookEventToStatus(event({ event: 'sessionStart' }))).toBeNull();
  });

  it.each(['permission_prompt', 'idle_prompt', 'elicitation_dialog'])(
    'notification(%s) → waiting',
    (kind) => {
      const r = mapHookEventToStatus(
        event({ event: 'notification', payload: { notification_type: kind } }),
      );
      expect(r?.status).toBe('waiting');
    },
  );

  it('notification(permission_prompt) → waiting/permission', () => {
    const r = mapHookEventToStatus(
      event({
        event: 'notification',
        payload: { notification_type: 'permission_prompt', message: 'Bash' },
      }),
    );
    expect(r).toEqual({ status: 'waiting', waitingReason: 'permission', message: 'Bash' });
  });

  it('notification(idle_prompt) uses last_assistant_message as fallback message', () => {
    const r = mapHookEventToStatus(
      event({
        event: 'notification',
        payload: { notification_type: 'idle_prompt', last_assistant_message: 'Done.' },
      }),
    );
    expect(r).toEqual({ status: 'waiting', waitingReason: 'idle', message: 'Done.' });
  });

  it('notification(elicitation_dialog) → waiting/question', () => {
    const r = mapHookEventToStatus(
      event({ event: 'notification', payload: { notification_type: 'elicitation_dialog' } }),
    );
    expect(r).toEqual({ status: 'waiting', waitingReason: 'question', message: undefined });
  });

  // Anti-false-positive: unknown notification types must NOT produce a waiting state.
  it.each(['auth_success', 'elicitation_complete', 'unknown_future_type'])(
    'notification(%s) → null (not waiting)',
    (kind) => {
      expect(
        mapHookEventToStatus(
          event({ event: 'notification', payload: { notification_type: kind } }),
        ),
      ).toBeNull();
    },
  );

  it('preToolUse(AskUserQuestion) → waiting/question (defensive coverage)', () => {
    const r = mapHookEventToStatus(
      event({ event: 'preToolUse', payload: { tool_name: 'AskUserQuestion' } }),
    );
    expect(r).toEqual({ status: 'waiting', waitingReason: 'question' });
  });

  it('preToolUse(Bash) → null (other tools are observed via Notification, not PreToolUse)', () => {
    expect(
      mapHookEventToStatus(event({ event: 'preToolUse', payload: { tool_name: 'Bash' } })),
    ).toBeNull();
  });
});

describe('isCwdMatch', () => {
  it('matches exact paths', () => {
    expect(isCwdMatch('/a/b/c', '/a/b/c')).toBe(true);
  });

  it('matches sub-directories', () => {
    expect(isCwdMatch('/a/b/c/d/e', '/a/b/c')).toBe(true);
  });

  it('does not match parent directories (reverse)', () => {
    expect(isCwdMatch('/a/b', '/a/b/c')).toBe(false);
  });

  it('does not match prefix overlaps that are not sub-dirs', () => {
    // /a/b should NOT match /a/bc — they share a prefix but are different.
    expect(isCwdMatch('/a/bc', '/a/b')).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(isCwdMatch('', '/a')).toBe(false);
    expect(isCwdMatch('/a', '')).toBe(false);
  });

  it('normalizes trailing slashes', () => {
    expect(isCwdMatch('/a/b/c/', '/a/b/c')).toBe(true);
  });
});

describe('SessionEntity.applyHookUpdate', () => {
  function freshSession(): SessionEntity {
    return new SessionEntity(
      'sid',
      'fleex_claude_x',
      'claude',
      'running',
      '/tmp/wt',
      new Date(),
      null,
      null,
      null,
      null,
      null,
    );
  }

  it('applies an unknown→working transition', () => {
    const s = freshSession();
    expect(s.hookStatus).toBe('unknown');
    const changed = s.applyHookUpdate({ status: 'working' });
    expect(changed).toBe(true);
    expect(s.hookStatus).toBe('working');
    expect(s.hookStatusUpdatedAt).toBeInstanceOf(Date);
  });

  it('is idempotent — same status+reason+message → no event', () => {
    const s = freshSession();
    s.applyHookUpdate({ status: 'waiting', waitingReason: 'permission', message: 'Bash' });
    const updatedAt1 = s.hookStatusUpdatedAt;
    const changed = s.applyHookUpdate({
      status: 'waiting',
      waitingReason: 'permission',
      message: 'Bash',
    });
    expect(changed).toBe(false);
    expect(s.hookStatusUpdatedAt).toBe(updatedAt1);
  });

  it('does NOT regress from complete to idle (PTY exit silence guard)', () => {
    const s = freshSession();
    s.applyHookUpdate({ status: 'complete' });
    const changed = s.applyHookUpdate({ status: 'idle' });
    expect(changed).toBe(false);
    expect(s.hookStatus).toBe('complete');
  });

  it('does NOT regress from error to idle', () => {
    const s = freshSession();
    s.applyHookUpdate({ status: 'error', message: 'rate_limit' });
    const changed = s.applyHookUpdate({ status: 'idle' });
    expect(changed).toBe(false);
    expect(s.hookStatus).toBe('error');
  });

  it('does NOT regress from complete to waiting/idle (idle_prompt is sibling of Stop)', () => {
    const s = freshSession();
    s.applyHookUpdate({ status: 'complete' });
    const changed = s.applyHookUpdate({ status: 'waiting', waitingReason: 'idle' });
    expect(changed).toBe(false);
    expect(s.hookStatus).toBe('complete');
  });

  it('does NOT regress from error to waiting/idle', () => {
    const s = freshSession();
    s.applyHookUpdate({ status: 'error', message: 'rate_limit' });
    const changed = s.applyHookUpdate({ status: 'waiting', waitingReason: 'idle' });
    expect(changed).toBe(false);
    expect(s.hookStatus).toBe('error');
  });

  it('ALLOWS complete → waiting/permission (legitimate new tool call after completion)', () => {
    const s = freshSession();
    s.applyHookUpdate({ status: 'complete' });
    const changed = s.applyHookUpdate({
      status: 'waiting',
      waitingReason: 'permission',
      message: 'Bash',
    });
    expect(changed).toBe(true);
    expect(s.hookStatus).toBe('waiting');
    expect(s.hookWaitingReason).toBe('permission');
  });

  it('ALLOWS complete → waiting/question (AskUserQuestion after completion)', () => {
    const s = freshSession();
    s.applyHookUpdate({ status: 'complete' });
    const changed = s.applyHookUpdate({ status: 'waiting', waitingReason: 'question' });
    expect(changed).toBe(true);
    expect(s.hookStatus).toBe('waiting');
    expect(s.hookWaitingReason).toBe('question');
  });

  it('allows complete→working (new prompt after completion)', () => {
    const s = freshSession();
    s.applyHookUpdate({ status: 'complete' });
    const changed = s.applyHookUpdate({ status: 'working' });
    expect(changed).toBe(true);
    expect(s.hookStatus).toBe('working');
  });

  it('exposes hookStatus in toDTO()', () => {
    const s = freshSession();
    s.applyHookUpdate({ status: 'waiting', waitingReason: 'idle', message: 'awaiting' });
    const dto = s.toDTO();
    expect(dto.hookStatus).toBe('waiting');
    expect(dto.hookWaitingReason).toBe('idle');
    expect(dto.hookLastMessage).toBe('awaiting');
    expect(typeof dto.hookStatusUpdatedAt).toBe('string');
  });
});

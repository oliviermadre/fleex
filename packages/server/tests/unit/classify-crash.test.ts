import { describe, it, expect } from 'vitest';

import { classifyCrash, CRASH_MESSAGES } from '../../src/application/utils/classify-crash.js';

describe('classifyCrash', () => {
  // WHY: the real-world trigger for this whole feature — the org usage limit is
  // hit mid-run and the SDK throws. It MUST be classified so the crash card tells
  // the user to switch accounts / add credits rather than showing a raw stack.
  it('classifies an org usage-limit crash', () => {
    const c = classifyCrash(
      "Claude Code process exited with error result: You've hit your org's monthly usage limit.",
      { acknowledged: true },
    );
    expect(c.reason).toBe('usage_limit');
    expect(c.message).toBe(CRASH_MESSAGES.usage_limit);
  });

  // WHY: a not-logged-in session is one of the three named crash causes in the
  // ticket; the remediation ("claude login") is only useful if we detect it.
  it('classifies a not-authenticated crash', () => {
    for (const raw of [
      'Not logged in. Please run `claude login`.',
      'Error: unauthorized (401)',
      'invalid API key',
    ]) {
      expect(classifyCrash(raw, { acknowledged: true }).reason, raw).toBe('not_authenticated');
    }
  });

  // WHY: max-turns is surfaced via the SDK result subtype, but classifying the
  // text too keeps the mapping robust if it ever arrives as a thrown message.
  it('classifies a max-turns crash', () => {
    expect(classifyCrash('error_max_turns', { acknowledged: true }).reason).toBe('max_turns');
    expect(classifyCrash('reached the maximum turns', { acknowledged: true }).reason).toBe(
      'max_turns',
    );
  });

  // WHY: a pre-acknowledge failure with no known signature keeps the historical
  // `startup_error` reason and echoes the raw message (what the old chip showed).
  it('falls back to startup_error before acknowledge, preserving the raw message', () => {
    const c = classifyCrash('Could not create workspace directory for ticket', {
      acknowledged: false,
    });
    expect(c.reason).toBe('startup_error');
    expect(c.message).toBe('Could not create workspace directory for ticket');
  });

  // WHY: a post-acknowledge crash we can't classify still needs a usable card —
  // generic remediation, never an empty message.
  it('falls back to unknown after acknowledge, with a generic remediation when the message is empty', () => {
    const c = classifyCrash('', { acknowledged: true });
    expect(c.reason).toBe('unknown');
    expect(c.message).toBe(CRASH_MESSAGES.unknown);
  });

  it('keeps the raw message for an unknown post-acknowledge crash when present', () => {
    const c = classifyCrash('EPIPE: broken pipe', { acknowledged: true });
    expect(c.reason).toBe('unknown');
    expect(c.message).toBe('EPIPE: broken pipe');
  });
});

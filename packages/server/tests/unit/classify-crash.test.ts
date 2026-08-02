import { describe, it, expect } from 'vitest';
import { classifyCrash } from '../../src/application/utils/classify-crash.js';

describe('classifyCrash — precedence', () => {
  // WHY: `timeout`/`cancelled`/`server_restart` are policy decisions Fleex has
  // already made. If a stray SDK code or a matching regex could override them,
  // a user-cancelled run would be reported as a quota crash — the audit trail
  // would lie about who stopped the run.
  it('lets an explicit policy reason win over every other signal', () => {
    const c = classifyCrash({
      explicit: 'cancelled',
      assistantError: 'rate_limit',
      resultSubtype: 'error_max_turns',
      raw: "You've hit your org's monthly usage limit",
      acknowledged: true,
    });
    expect(c.reason).toBe('cancelled');
  });

  // WHY: a structured SDK code is authoritative; the regex layer only exists
  // because errors *thrown* by the CLI carry no code. Preferring the code keeps
  // us correct when the two disagree.
  it('prefers the structured SDK code over the free-form text', () => {
    const c = classifyCrash({
      assistantError: 'billing_error',
      raw: 'not logged in, run claude login',
      acknowledged: true,
    });
    expect(c.reason).toBe('billing');
  });

  // WHY: an assistant-level error is closer to the cause than the result
  // subtype, which is often just `error_during_execution` wrapping it.
  it('prefers the assistant error over the result subtype', () => {
    const c = classifyCrash({
      assistantError: 'rate_limit',
      resultSubtype: 'error_during_execution',
      acknowledged: true,
    });
    expect(c.reason).toBe('usage_limit');
  });
});

describe('classifyCrash — structured SDK codes', () => {
  // WHY: the whole point of this lot. These codes are the SDK's own contract;
  // mapping them removes the guesswork the regexes used to do.
  it('maps every SDKAssistantMessageError member', () => {
    const cases: Array<[string, string]> = [
      ['authentication_failed', 'not_authenticated'],
      // Not in the ticket's list but present in the installed SDK — an org that
      // disallows this OAuth app is an auth problem, same remediation.
      ['oauth_org_not_allowed', 'not_authenticated'],
      ['billing_error', 'billing'],
      ['rate_limit', 'usage_limit'],
      ['invalid_request', 'invalid_request'],
      ['server_error', 'server_error'],
      ['max_output_tokens', 'max_output_tokens'],
    ];
    for (const [code, reason] of cases) {
      expect(classifyCrash({ assistantError: code, acknowledged: true }).reason, code).toBe(reason);
    }
  });

  // WHY: the SDK's own `unknown` carries no information — it must not shadow a
  // perfectly classifiable raw message.
  it('falls through to the text when the SDK code is itself `unknown`', () => {
    const c = classifyCrash({
      assistantError: 'unknown',
      raw: "You've hit your org's monthly usage limit",
      acknowledged: true,
    });
    expect(c.reason).toBe('usage_limit');
  });

  // WHY: the SDK adds members over time. An unrecognised code must degrade to
  // the text/`unknown` path, never crash the classifier.
  it('tolerates an SDK code it has never seen', () => {
    const c = classifyCrash({ assistantError: 'some_future_code', acknowledged: true });
    expect(c.reason).toBe('unknown');
  });

  it('maps the SDKResultError subtypes', () => {
    const cases: Array<[string, string]> = [
      ['error_max_turns', 'max_turns'],
      ['error_max_budget_usd', 'max_budget'],
      ['error_max_structured_output_retries', 'output_format'],
    ];
    for (const [subtype, reason] of cases) {
      expect(classifyCrash({ resultSubtype: subtype, acknowledged: true }).reason, subtype).toBe(reason);
    }
  });

  // WHY: `error_during_execution` is a wrapper, not a cause — classifying it as
  // its own reason would hide the real error text underneath.
  it('does not treat error_during_execution as a cause of its own', () => {
    const c = classifyCrash({ resultSubtype: 'error_during_execution', raw: 'invalid API key', acknowledged: true });
    expect(c.reason).toBe('not_authenticated');
  });
});

describe('classifyCrash — text fallback', () => {
  // WHY: errors *thrown* by the CLI (not returned as SDK messages) carry no
  // structured code at all. The regex layer is the last resort that keeps the
  // three named causes of ticket #443 detectable.
  it('classifies an org usage-limit crash from raw text', () => {
    const c = classifyCrash({
      raw: "Claude Code process exited with error result: You've hit your org's monthly usage limit.",
      acknowledged: true,
    });
    expect(c.reason).toBe('usage_limit');
  });

  it('classifies a not-authenticated crash from raw text', () => {
    for (const raw of ['Not logged in. Please run `claude login`.', 'Error: unauthorized (401)', 'invalid API key']) {
      expect(classifyCrash({ raw, acknowledged: true }).reason, raw).toBe('not_authenticated');
    }
  });

  it('classifies a max-turns crash from raw text', () => {
    expect(classifyCrash({ raw: 'error_max_turns', acknowledged: true }).reason).toBe('max_turns');
    expect(classifyCrash({ raw: 'reached the maximum turns', acknowledged: true }).reason).toBe('max_turns');
  });

  // WHY: a failure before `acknowledge` never reached the SDK — workspace,
  // quota or auth setup. Keeping it distinct tells the user the run never
  // started, rather than implying the agent died mid-task.
  it('falls back to startup_error before acknowledge', () => {
    const c = classifyCrash({ raw: 'Could not create workspace directory for ticket', acknowledged: false });
    expect(c.reason).toBe('startup_error');
    expect(c.detail).toBe('Could not create workspace directory for ticket');
  });

  it('falls back to unknown after acknowledge', () => {
    expect(classifyCrash({ raw: 'EPIPE: broken pipe', acknowledged: true }).reason).toBe('unknown');
    expect(classifyCrash({ raw: '', acknowledged: true }).reason).toBe('unknown');
  });
});

describe('classifyCrash — detail is raw, never copy', () => {
  // WHY (D8): all user-facing copy lives in the web client, in English. If the
  // server ever put a sentence here the UI would show two competing messages —
  // and the French strings this lot deletes would creep back in.
  it('returns the raw technical text as detail, with no remediation sentence', () => {
    const raw = "API Error: 429 {\"type\":\"error\"}";
    const c = classifyCrash({ assistantError: 'rate_limit', raw, acknowledged: true });
    expect(c.reason).toBe('usage_limit');
    expect(c.detail).toBe(raw);
  });

  // WHY: an empty detail must stay undefined rather than becoming `''`, so the
  // card can decide to hide the "Technical details" section entirely.
  it('omits the detail when there is no technical text', () => {
    const c = classifyCrash({ assistantError: 'server_error', acknowledged: true });
    expect(c.detail).toBeUndefined();
  });

  // WHY: this is the regression guard for the French server-side copy the
  // ticket calls out. Any accented remediation string here is a bug.
  it('never emits localized server-side copy', () => {
    const samples = [
      classifyCrash({ raw: "You've hit your org's monthly usage limit", acknowledged: true }),
      classifyCrash({ raw: 'not logged in', acknowledged: true }),
      classifyCrash({ explicit: 'timeout', acknowledged: true }),
      classifyCrash({ raw: '', acknowledged: false }),
    ];
    for (const c of samples) {
      expect(c.detail ?? '').not.toMatch(/[éèêàçù]/);
    }
  });
});

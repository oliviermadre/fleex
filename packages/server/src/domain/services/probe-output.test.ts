import { describe, it, expect } from 'vitest';
import { parseProbeOutput, PROBE_TOOLTIP_MAX_CHARS, PROBE_TOOLTIP_MAX_LINES } from './probe-output.js';

const out = (stdout: string, exitCode = 0, stderr = '') => ({ stdout, stderr, exitCode });

describe('parseProbeOutput', () => {
  it('lets a JSON status win over the exit code, so a probe can report "warn" while exiting 0', () => {
    const parsed = parseProbeOutput(out('{"status":"warn","tooltip":"a\\nb","badge":"42"}'));
    expect(parsed).toEqual({ status: 'warn', tooltip: 'a\nb', badge: '42', source: 'json' });
  });

  it('trusts the JSON status even when the command exited non-zero', () => {
    expect(parseProbeOutput(out('{"status":"ok"}', 1)).status).toBe('ok');
  });

  it('falls back to the exit code when the JSON has no valid status', () => {
    expect(parseProbeOutput(out('{"tooltip":"x"}', 0))).toMatchObject({ status: 'ok', source: 'exit-code' });
    expect(parseProbeOutput(out('{"status":"green"}', 1))).toMatchObject({ status: 'ko', source: 'exit-code' });
  });

  it('treats invalid JSON as plain text: exit 0 → ok, non-zero → ko, output as tooltip', () => {
    expect(parseProbeOutput(out('{not json', 0))).toEqual({ status: 'ok', tooltip: '{not json', source: 'exit-code' });
    expect(parseProbeOutput(out('', 2, 'no credential\n'))).toEqual({ status: 'ko', tooltip: 'no credential', source: 'exit-code' });
  });

  it('reports a timeout as unknown, never ko — it proves nothing is broken', () => {
    expect(parseProbeOutput({ stdout: '', stderr: '', exitCode: 1, timedOut: true }))
      .toEqual({ status: 'unknown', tooltip: 'Probe failed: timeout', source: 'error' });
  });

  it('reports a spawn failure as unknown with its reason', () => {
    expect(parseProbeOutput({ stdout: '', stderr: '', exitCode: 1, error: 'gateway down' }))
      .toMatchObject({ status: 'unknown', tooltip: 'Probe failed: gateway down' });
  });

  it('caps the tooltip to its line and character budget', () => {
    const many = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    expect(parseProbeOutput(out(many)).tooltip!.split('\n')).toHaveLength(PROBE_TOOLTIP_MAX_LINES);
    expect(parseProbeOutput(out('x'.repeat(5000))).tooltip).toHaveLength(PROBE_TOOLTIP_MAX_CHARS);
  });

  it('truncates a badge to 6 characters and accepts numbers', () => {
    expect(parseProbeOutput(out('{"status":"ok","badge":"1234567890"}')).badge).toBe('123456');
    expect(parseProbeOutput(out('{"status":"ok","badge":4932}')).badge).toBe('4932');
  });
});

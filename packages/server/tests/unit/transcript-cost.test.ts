import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readPricedMessages, costInWindow } from '../../scripts/lib/transcript-cost.js';

/** The transcript is the ground truth the cost correction relies on — it must not double-count. */
describe('transcript pricing', () => {
  const line = (id: string, ts: string, usage: Record<string, unknown>, model = 'claude-sonnet-5-5') =>
    JSON.stringify({ timestamp: ts, requestId: `r-${id}`, message: { id, model, usage } });

  it('counts a message once even when the transcript repeats it per content block', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tx-'));
    const f = join(dir, 's.jsonl');
    const u = { input_tokens: 1000, output_tokens: 100 }; // sonnet 5.5: $2/M in, $10/M out → $0.003
    writeFileSync(f, [line('m1', '2026-10-03T08:00:00Z', u), line('m1', '2026-10-03T08:00:01Z', u), line('m2', '2026-10-03T09:00:00Z', u)].join('\n'));
    const msgs = readPricedMessages(f);
    expect(msgs).toHaveLength(2);
    expect(costInWindow(msgs, Date.parse('2026-10-03T07:59:00Z'), Date.parse('2026-10-03T08:30:00Z'))).toBeCloseTo(0.003, 10);
  });

  it('refuses to price a window containing an unknown model (no partial evidence)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tx-'));
    const f = join(dir, 's.jsonl');
    writeFileSync(f, line('m1', '2026-10-03T08:00:00Z', { input_tokens: 1 }, 'claude-unknown-9'));
    expect(costInWindow(readPricedMessages(f), 0, Date.now())).toBeNull();
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { MODEL_PRICING, priceFor, computeSessionCost } from '../../src/application/utils/cli-session-ingest.js';

/**
 * An unpriced model is not a loud failure: `computeSessionCost` still counts its
 * tokens but adds 0 USD, so the session silently reports as free. Fable is the
 * most expensive family in the table, which makes a missing entry the costliest
 * kind of gap. These tests pin the price down rather than just its presence.
 */
describe('priceFor — Fable 5.1', () => {
  it('is priced, and priced identically to Fable 5', () => {
    const p = priceFor('claude-fable-5-1');
    expect(p).not.toBeNull();
    expect(p).toEqual(priceFor('claude-fable-5'));
    expect(p!.inp).toBe(10e-6);
    expect(p!.out).toBe(50e-6);
  });

  it('derives cache rates from the input price rather than hand-writing them', () => {
    const p = priceFor('claude-fable-5-1')!;
    expect(p.read).toBeCloseTo(1e-6, 12); // ×0.1
    expect(p.w5).toBeCloseTo(12.5e-6, 12); // ×1.25
    expect(p.w1).toBeCloseTo(20e-6, 12); // ×2
  });

  it('resolves the dated-snapshot and fast-mode id variants to the same entry', () => {
    // The normaliser only strips `-\d{8}` and `-fast`; '-1' is part of the id, so
    // the base key must exist in its own right for these to resolve at all.
    expect(priceFor('claude-fable-5-1-20260401')).toEqual(priceFor('claude-fable-5-1'));
    expect(priceFor('claude-fable-5-1-fast')).toEqual(priceFor('claude-fable-5-1'));
  });
});

describe('computeSessionCost — a Fable 5.1 transcript', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fleex-fable-pricing-'));
    writeFileSync(
      join(dir, 'fable.jsonl'),
      JSON.stringify({
        entrypoint: 'cli', timestamp: '2026-06-18T10:00:00Z', type: 'assistant',
        message: { model: 'claude-fable-5-1', usage: {
          input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 10_000,
          cache_creation: { ephemeral_5m_input_tokens: 4000, ephemeral_1h_input_tokens: 0 },
        } },
      }) + '\n',
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('bills it instead of counting the tokens for free', async () => {
    const c = await computeSessionCost(join(dir, 'fable.jsonl'));

    // 1000*10e-6 + 2000*50e-6 + 10000*1e-6 + 4000*12.5e-6 = 0.17
    expect(c.cost).toBeCloseTo(0.17, 9);
    expect(c.cost).toBeGreaterThan(0);
    // The flag is how an unpriced model would otherwise surface downstream.
    expect(c.hasUnknownModel).toBe(false);
    expect(c.model).toBe('claude-fable-5-1');
  });
});

/**
 * `backfill-agentic-costs.ts` is standalone (it imports no workspace code) and
 * carries a byte-identical copy of the pricing table on purpose. Importing it
 * here would run its argv parsing and DB connection, so parity is asserted
 * against the source text: a backfill that disagrees with live ingest would
 * rewrite correct rows with wrong numbers.
 */
describe('pricing tables stay in sync', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

  /** Pull `'<id>': price(a, b)` pairs out of a single table literal. */
  function parseTable(source: string, declaration: string): Record<string, string> {
    const start = source.indexOf(declaration);
    expect(start, `table not found: ${declaration}`).toBeGreaterThanOrEqual(0);
    const body = source.slice(start, source.indexOf('\n};', start));
    const out: Record<string, string> = {};
    for (const [, id, args] of body.matchAll(/'([^']+)':\s*price\(([^)]*)\)/g)) {
      out[id!] = args!.replace(/\s+/g, '');
    }
    return out;
  }

  it('MODEL_PRICING and the backfill PRICING hold the same keys and values', () => {
    const live = parseTable(
      read('../../src/application/utils/cli-session-ingest.ts'),
      'export const MODEL_PRICING: Record<string, Price> = {',
    );
    const backfill = parseTable(
      read('../../scripts/backfill-agentic-costs.ts'),
      'const PRICING: Record<string, Price> = {',
    );

    // Guard the parser itself: a regex that matched nothing would pass vacuously.
    expect(Object.keys(live).length).toBeGreaterThan(5);
    expect(live['claude-fable-5-1']).toBe('10e-6,50e-6');
    expect(backfill).toEqual(live);
  });

  it('every runtime pricing key is reachable through priceFor', () => {
    for (const id of Object.keys(MODEL_PRICING)) expect(priceFor(id)).not.toBeNull();
  });
});

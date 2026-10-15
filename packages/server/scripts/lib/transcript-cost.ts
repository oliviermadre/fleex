/**
 * Price Claude Code transcript messages (public list price, standard tier).
 *
 * NOTE: duplicates the PRICING table of `backfill-agentic-costs.ts`, which
 * cannot be imported (it runs on import). Keep both in sync; fold them together
 * when that script is next touched.
 */
import { readFileSync } from 'node:fs';

type Price = { inp: number; out: number; read: number; w5: number; w1: number };
const price = (inp: number, out: number): Price => ({ inp, out, read: inp * 0.1, w5: inp * 1.25, w1: inp * 2 });
const PRICING: Record<string, Price> = {
  'claude-opus-5-5': { ...price(4e-6, 20e-6), read: 0.2e-6 },
  'claude-opus-5': price(5e-6, 25e-6),
  'claude-opus-4-8': price(5e-6, 25e-6),
  'claude-opus-4-7': price(5e-6, 25e-6),
  'claude-opus-4-6': price(5e-6, 25e-6),
  'claude-opus-4-5': price(5e-6, 25e-6),
  'claude-sonnet-5-5': price(2e-6, 10e-6),
  'claude-sonnet-5': price(2e-6, 10e-6),
  'claude-sonnet-4-6': price(3e-6, 15e-6),
  'claude-sonnet-4-5': price(3e-6, 15e-6),
  'claude-haiku-4-5': price(1e-6, 5e-6),
  'claude-haiku-4-5-20251001': price(1e-6, 5e-6),
  'claude-fable-5-1': price(10e-6, 50e-6),
  'claude-fable-5': price(10e-6, 50e-6),
  '<synthetic>': price(0, 0),
};
function priceFor(model: string): Price | null {
  return PRICING[model] ?? PRICING[model.replace(/-\d{8}$/, '').replace(/-fast$/, '')] ?? null;
}

export interface PricedMessage { at: number; cost: number; model: string; priced: boolean }

/**
 * One entry per API message. A transcript writes several lines per message
 * (one per content block) repeating its usage, so lines are de-duplicated on
 * message id + request id, keeping the last.
 */
export function readPricedMessages(path: string): PricedMessage[] {
  const byId = new Map<string, PricedMessage>();
  let anon = 0;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    let d: Record<string, unknown>;
    try { d = JSON.parse(line); } catch { continue; }
    const msg = d['message'] as Record<string, unknown> | undefined;
    const u = msg?.['usage'] as Record<string, number | Record<string, number>> | undefined;
    const ts = d['timestamp'];
    if (!u || typeof ts !== 'string') continue;
    const model = (msg?.['model'] as string) ?? '?';
    const p = priceFor(model);
    const n = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : 0);
    const cc = (u['cache_creation'] as Record<string, number> | undefined) ?? {};
    let w5 = cc['ephemeral_5m_input_tokens'] ?? 0;
    const w1 = cc['ephemeral_1h_input_tokens'] ?? 0;
    if (!w5 && !w1) w5 = n('cache_creation_input_tokens');
    const cost = p ? n('input_tokens') * p.inp + n('output_tokens') * p.out + n('cache_read_input_tokens') * p.read + w5 * p.w5 + w1 * p.w1 : 0;
    const key = msg?.['id'] ? `${msg['id']}:${d['requestId'] ?? ''}` : `anon:${anon++}`;
    byId.set(key, { at: Date.parse(ts), cost, model, priced: p != null });
  }
  return [...byId.values()];
}

/** Spend over [fromMs, toMs]; null when a message in the window has an unknown model. */
export function costInWindow(msgs: PricedMessage[], fromMs: number, toMs: number): number | null {
  let c = 0;
  for (const m of msgs) {
    if (m.at < fromMs || m.at > toMs) continue;
    if (!m.priced) return null;
    c += m.cost;
  }
  return c;
}

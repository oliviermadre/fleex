/**
 * Shared logic for ingesting a manual `claude` CLI session's cost from its
 * transcript. Used by both the real-time `SessionEnd` hook path
 * (IngestCliSessionUseCase) and the offline backfill script.
 *
 * A "Fleex session" is one whose cwd — or any ancestor — contains a
 * `.fleex.json` (`{ "ticketId": "<uuid>" }`), written at the workspace root.
 */
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// ── Pricing (USD per token, public list / standard tier) ────────────────────
export interface Price {
  inp: number;
  out: number;
  read: number;
  w5: number;
  w1: number;
}
const price = (inp: number, out: number): Price => ({
  inp,
  out,
  read: inp * 0.1,
  w5: inp * 1.25,
  w1: inp * 2,
});
export const MODEL_PRICING: Record<string, Price> = {
  'claude-opus-5': price(5e-6, 25e-6),
  'claude-opus-4-8': price(5e-6, 25e-6),
  'claude-opus-4-7': price(5e-6, 25e-6),
  'claude-opus-4-6': price(5e-6, 25e-6),
  'claude-opus-4-5': price(5e-6, 25e-6),
  'claude-sonnet-5': price(3e-6, 15e-6),
  'claude-sonnet-4-6': price(3e-6, 15e-6),
  'claude-sonnet-4-5': price(3e-6, 15e-6),
  'claude-haiku-4-5': price(1e-6, 5e-6),
  'claude-haiku-4-5-20251001': price(1e-6, 5e-6),
  'claude-fable-5': price(10e-6, 50e-6),
  '<synthetic>': price(0, 0), // Claude Code's non-API messages — no billable cost
};

/** Resolve a model id to a pricing entry (handles dated snapshots / -fast). */
export function priceFor(model: string): Price | null {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model]!;
  const base = model.replace(/-\d{8}$/, '').replace(/-fast$/, '');
  return MODEL_PRICING[base] ?? null;
}

/** Walk cwd → ancestors for a `.fleex.json`; return its `ticketId` (or null). */
export function detectFleexTicket(cwd: string): string | null {
  let dir = cwd;
  for (;;) {
    const fp = join(dir, '.fleex.json');
    if (existsSync(fp)) {
      try {
        const tid = JSON.parse(readFileSync(fp, 'utf-8'))?.ticketId;
        return typeof tid === 'string' && tid ? tid : null;
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export interface SessionCost {
  /** First entrypoint seen (`cli`, `sdk-ts`, `sdk-cli`, …) or null. */
  entrypoint: string | null;
  /** Dominant non-synthetic model, or null. */
  model: string | null;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  startedAt: string | null;
  completedAt: string | null;
  /** A model in the transcript had no known price → cost may be incomplete. */
  hasUnknownModel: boolean;
}

/** Aggregate token usage + cost from a Claude transcript JSONL file. */
export async function computeSessionCost(transcriptPath: string): Promise<SessionCost> {
  const raw = await readFile(transcriptPath, 'utf-8');
  const r: SessionCost = {
    entrypoint: null,
    model: null,
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    startedAt: null,
    completedAt: null,
    hasUnknownModel: false,
  };
  const modelTokens = new Map<string, number>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (!r.entrypoint && typeof d['entrypoint'] === 'string')
      r.entrypoint = d['entrypoint'] as string;
    const ts = typeof d['timestamp'] === 'string' ? (d['timestamp'] as string) : null;
    if (ts) {
      if (!r.startedAt || ts < r.startedAt) r.startedAt = ts;
      if (!r.completedAt || ts > r.completedAt) r.completedAt = ts;
    }
    const msg = d['message'] as Record<string, unknown> | undefined;
    const u = msg?.['usage'] as Record<string, unknown> | undefined;
    if (!u) continue;
    const model = (msg?.['model'] as string) ?? '?';
    const inp = (u['input_tokens'] as number) ?? 0;
    const out = (u['output_tokens'] as number) ?? 0;
    const rd = (u['cache_read_input_tokens'] as number) ?? 0;
    const cc = (u['cache_creation'] as Record<string, number> | undefined) ?? {};
    let w5 = cc['ephemeral_5m_input_tokens'] ?? 0;
    const w1 = cc['ephemeral_1h_input_tokens'] ?? 0;
    if (!w5 && !w1) w5 = (u['cache_creation_input_tokens'] as number) ?? 0;
    r.inputTokens += inp;
    r.outputTokens += out;
    r.cacheReadTokens += rd;
    r.cacheCreationTokens += w5 + w1;
    if (model !== '<synthetic>')
      modelTokens.set(model, (modelTokens.get(model) ?? 0) + inp + out + rd + w5 + w1);
    const p = priceFor(model);
    if (!p) {
      r.hasUnknownModel = true;
      continue;
    }
    r.cost += inp * p.inp + out * p.out + rd * p.read + w5 * p.w5 + w1 * p.w1;
  }
  // Dominant model by token volume.
  let best = -1;
  for (const [m, tok] of modelTokens)
    if (tok > best) {
      best = tok;
      r.model = m;
    }
  return r;
}

/** One reconstructed conversation turn (tool-call noise already stripped). */
export interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Reconstruct the human-readable conversation from a Claude transcript JSONL:
 * the ordered user/assistant *text* turns, with everything that is context
 * plumbing rather than dialogue discarded — because the decisions/arbitrations a
 * summary must preserve live in the exchange, not in the machinery that built the
 * context. Dropped:
 *  - `tool_use` requests / `tool_result` payloads / thinking blocks (tool spam);
 *  - subagent turns (`isSidechain`) — a dispatched agent's internal work;
 *  - system-injected meta lines (`isMeta`) — hook context, caveats;
 *  - inline wrappers that ride inside user text blocks (`<system-reminder>`,
 *    slash-command echoes, local command output) — see {@link stripInjectedNoise}.
 *
 * This both raises signal for the summary and keeps the prompt small, so long
 * sessions can't overflow the model's context window.
 *
 * Parsing mirrors {@link computeSessionCost}: same JSONL, malformed lines skipped.
 */
export async function reconstructTranscript(transcriptPath: string): Promise<TranscriptTurn[]> {
  const raw = await readFile(transcriptPath, 'utf-8');
  const turns: TranscriptTurn[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const type = d['type'];
    if (type !== 'user' && type !== 'assistant') continue;
    // Not part of the human↔LLM exchange: subagent sidechains and system-injected
    // meta are context-construction, not decisions.
    if (d['isSidechain'] === true || d['isMeta'] === true) continue;
    const msg = d['message'] as Record<string, unknown> | undefined;
    if (!msg) continue;
    const text = stripInjectedNoise(extractText(msg['content'])).trim();
    if (!text) continue;
    turns.push({ role: type, text });
  }
  return turns;
}

/**
 * Strip Claude Code's system-injected wrappers that ride inside otherwise-textual
 * user turns: system reminders, slash-command echoes, and local command output.
 * None of it is something the developer typed or the model reasoned about — it is
 * pure context plumbing, so it is both noise for a decision summary and a needless
 * context cost. A no-op when the wrappers are absent.
 */
function stripInjectedNoise(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .replace(/<local-command-stderr>[\s\S]*?<\/local-command-stderr>/g, '');
}

/** Collect the plain-text content of a message, ignoring non-text blocks. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join('\n');
}

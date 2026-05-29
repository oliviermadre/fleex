/**
 * Tally token usage from a Claude Code session transcript (JSONL).
 *
 * Each transcript line is a JSON object; assistant turns carry a
 * `message.usage` block. We sum usage across *every* assistant turn in the
 * file — including sidechains (sub-agent / Task tool calls) — so the total
 * reflects the full cost of the session, manual or otherwise.
 *
 * Pure and I/O-free so it can be unit-tested against fixture strings; the
 * caller is responsible for reading the file.
 */

export interface TranscriptUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Model that produced the most output tokens — the best single label for the run. */
  model: string | null;
  /** Assistant turns that reported usage (≈ number of model/agent calls). */
  assistantTurns: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function parseTranscriptUsage(jsonl: string): TranscriptUsage {
  const result: TranscriptUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    model: null,
    assistantTurns: 0,
    firstTimestamp: null,
    lastTimestamp: null,
  };

  // model name → output tokens, to pick the dominant model at the end.
  const outputByModel = new Map<string, number>();

  for (const rawLine of jsonl.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // tolerate partial / corrupt lines
    }

    const ts = typeof obj['timestamp'] === 'string' ? (obj['timestamp'] as string) : null;
    if (ts) {
      if (!result.firstTimestamp) result.firstTimestamp = ts;
      result.lastTimestamp = ts;
    }

    const message = obj['message'];
    if (!message || typeof message !== 'object') continue;
    const msg = message as Record<string, unknown>;

    const isAssistant = obj['type'] === 'assistant' || msg['role'] === 'assistant';
    const usage = msg['usage'];
    if (!isAssistant || !usage || typeof usage !== 'object') continue;

    const u = usage as RawUsage;
    const out = num(u.output_tokens);
    result.inputTokens += num(u.input_tokens);
    result.outputTokens += out;
    result.cacheReadTokens += num(u.cache_read_input_tokens);
    result.cacheCreationTokens += num(u.cache_creation_input_tokens);
    result.assistantTurns += 1;

    const model = typeof msg['model'] === 'string' ? (msg['model'] as string) : null;
    if (model) {
      outputByModel.set(model, (outputByModel.get(model) ?? 0) + out);
    }
  }

  let topModel: string | null = null;
  let topOut = -1;
  for (const [model, out] of outputByModel) {
    if (out > topOut) {
      topOut = out;
      topModel = model;
    }
  }
  result.model = topModel;

  return result;
}

/**
 * Extract human-readable conversation text (user prompts + assistant replies)
 * from a transcript, dropping tool noise. Used as input to the summarizer.
 *
 * Keeps the *tail* (last `maxChars`) since decisions accumulate toward the end
 * of a session. Returns an empty string if nothing readable is found.
 */
export function extractTranscriptText(jsonl: string, maxChars = 60_000): string {
  const parts: string[] = [];

  for (const rawLine of jsonl.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const message = obj['message'];
    if (!message || typeof message !== 'object') continue;
    const msg = message as Record<string, unknown>;
    const role = msg['role'];
    if (role !== 'user' && role !== 'assistant') continue;

    const text = extractContentText(msg['content']);
    if (text) parts.push(`${role === 'user' ? 'User' : 'Assistant'}: ${text}`);
  }

  const joined = parts.join('\n\n');
  return joined.length > maxChars ? joined.slice(joined.length - maxChars) : joined;
}

function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  const texts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as Record<string, unknown>;
      if (b['type'] === 'text' && typeof b['text'] === 'string') {
        texts.push((b['text'] as string).trim());
      }
    }
  }
  return texts.join('\n').trim();
}

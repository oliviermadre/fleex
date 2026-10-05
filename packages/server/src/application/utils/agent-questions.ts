import type { AgentQuestion } from '@fleex/shared';

const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 5;
const MIN_OPTIONS = 2;
const MAX_OPTION_CHARS = 80;
const MAX_PROMPT_CHARS = 200;

/**
 * Reduce whatever an agent put in `questions` to the shape the UI can render.
 * Tolerant by design: a bad entry is dropped, never the whole output. Returns
 * null when nothing usable is left, so "no questions" has a single spelling.
 */
export function sanitizeQuestions(raw: unknown): AgentQuestion[] | null {
  if (!Array.isArray(raw)) return null;
  const out: AgentQuestion[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_QUESTIONS) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const { prompt, options } = entry as Record<string, unknown>;
    if (typeof prompt !== 'string' || !prompt.trim()) continue;
    if (!Array.isArray(options)) continue;
    const kept: string[] = [];
    for (const o of options) {
      if (typeof o !== 'string') continue;
      const text = o.trim();
      if (!text || text.length > MAX_OPTION_CHARS || kept.includes(text)) continue;
      kept.push(text);
    }
    if (kept.length < MIN_OPTIONS) continue;
    out.push({ prompt: prompt.trim().slice(0, MAX_PROMPT_CHARS), options: kept.slice(0, MAX_OPTIONS) });
  }
  return out.length > 0 ? out : null;
}

/**
 * The questions worth persisting from an agent output: only when the agent is
 * actually waiting on the human (no buttons on finished work), and always
 * re-sanitized — the SDK's structured output reaches us without going through
 * parseAgentOutput.
 */
export function questionsToKeep(
  out: { mentionStatus?: unknown; questions?: unknown } | null | undefined,
): AgentQuestion[] | null {
  if (!out || out.mentionStatus !== 'waiting_for_info') return null;
  return sanitizeQuestions(out.questions);
}

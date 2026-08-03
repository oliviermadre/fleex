import type { AgentStructuredOutput, DeliverableType, DeliverableStatus } from '@fleex/shared';

/**
 * Options controlling how the deliverable `type` field is coerced.
 * - `validTypes`: when provided, a type outside this list is replaced with
 *   `fallbackType`. When omitted, any non-empty string is accepted as-is.
 * - `fallbackType`: substituted for missing/invalid types (default 'report').
 */
export interface ParseAgentOutputOptions {
  validTypes?: string[];
  fallbackType?: string;
}

/**
 * Attempts to extract a valid AgentStructuredOutput from raw agent result text.
 *
 * Three strategies in priority order:
 * 1. Try the entire trimmed string as JSON
 * 2. Extract from markdown code fences (```json ... ```)
 * 3. Find the last `{ ... }` pair in the text (handles prose before/after)
 *
 * Returns null if parsing fails or the shape doesn't match.
 */
export function parseAgentOutput(
  raw: string,
  options: ParseAgentOutputOptions = {},
): AgentStructuredOutput | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Strategy 1: entire string is JSON
  const result = tryParseAndValidate(trimmed, options);
  if (result) return result;

  // Strategy 2: extract from markdown code fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch?.[1]) {
    const fenced = tryParseAndValidate(fenceMatch[1].trim(), options);
    if (fenced) return fenced;
  }

  // Strategy 3: find the last top-level { ... } pair
  const lastBrace = findLastJsonObject(trimmed);
  if (lastBrace) {
    const braced = tryParseAndValidate(lastBrace, options);
    if (braced) return braced;
  }

  return null;
}

function tryParseAndValidate(
  text: string,
  options: ParseAgentOutputOptions,
): AgentStructuredOutput | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return validateShape(parsed, options);
}

function coerceType(raw: unknown, options: ParseAgentOutputOptions): DeliverableType {
  const fallback = options.fallbackType ?? 'report';
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  if (options.validTypes && !options.validTypes.includes(raw)) return fallback;
  return raw;
}

function validateShape(
  obj: unknown,
  options: ParseAgentOutputOptions,
): AgentStructuredOutput | null {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;

  const record = obj as Record<string, unknown>;

  // Must have at least one of the two keys
  if (!('deliverable' in record) && !('comment' in record)) return null;

  // Validate deliverable
  const deliverable = record['deliverable'];
  if (deliverable !== null && deliverable !== undefined) {
    if (typeof deliverable !== 'object' || Array.isArray(deliverable)) return null;
    const d = deliverable as Record<string, unknown>;
    if (typeof d['title'] !== 'string' || typeof d['markdown'] !== 'string') return null;
    // Validate status if present, otherwise fallback to 'draft'
    if (d['status'] !== undefined && d['status'] !== 'draft' && d['status'] !== 'final')
      return null;
  }

  // Validate comment
  const comment = record['comment'];
  if (comment !== null && comment !== undefined) {
    if (typeof comment !== 'string') return null;
  }

  // Validate mentionStatus (optional)
  const mentionStatus = record['mentionStatus'];
  if (
    mentionStatus !== undefined &&
    mentionStatus !== 'resolved' &&
    mentionStatus !== 'waiting_for_info'
  ) {
    // Invalid value — ignore it (default to resolved)
  }

  return {
    deliverable:
      deliverable != null
        ? {
            title: (deliverable as Record<string, unknown>)['title'] as string,
            markdown: (deliverable as Record<string, unknown>)['markdown'] as string,
            type: coerceType((deliverable as Record<string, unknown>)['type'], options),
            status:
              ((deliverable as Record<string, unknown>)['status'] as DeliverableStatus) ?? 'draft',
          }
        : null,
    comment: (comment as string) ?? null,
    ...(mentionStatus === 'resolved' || mentionStatus === 'waiting_for_info'
      ? { mentionStatus: mentionStatus as 'resolved' | 'waiting_for_info' }
      : {}),
  };
}

/**
 * Finds the last top-level JSON object `{ ... }` in the text by scanning
 * forward, tracking brace depth with correct escape handling.
 */
function findLastJsonObject(text: string): string | null {
  let lastStart = -1;
  let lastEnd = -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  let topLevelStart = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) topLevelStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && topLevelStart !== -1) {
        lastStart = topLevelStart;
        lastEnd = i;
      }
    }
  }

  if (lastStart === -1 || lastEnd === -1) return null;
  return text.slice(lastStart, lastEnd + 1);
}

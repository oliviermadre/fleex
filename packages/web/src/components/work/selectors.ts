/**
 * Pure view-model logic for the Work view: how the flat task list partitions
 * into the three queue sections, and how an agent's pending question is parsed
 * into inline answer options. Kept free of store/React imports so it is unit
 * tested in isolation (selectors.test.ts).
 */

/** The activity bucket a task falls in, mirrored from ticketActivityStore. */
export type QueueActivity = 'waiting' | 'running' | 'idle';

/**
 * A task as the queue needs it — a normalised projection of a ticket plus its
 * live activity, built in the component from ticketStore + ticketActivityStore.
 * The selectors below never touch a store, only this shape.
 */
export interface QueueItem {
  id: string;
  title: string;
  boardId: string | null;
  boardName: string | null;
  activity: QueueActivity;
  /** ms epoch the current activity started (for NEEDS YOU / RUNNING ordering). */
  since: number | null;
  /** ms epoch of the last activity of any kind (for IDLE ordering). */
  lastActivityAt: number | null;
}

export interface PartitionedQueue {
  needs: QueueItem[];
  running: QueueItem[];
  idle: QueueItem[];
}

/**
 * Split tasks into the three sections and order each per SPEC §3:
 *   NEEDS YOU (waiting) — oldest question first (since ascending)
 *   RUNNING           — most recently started first (since descending)
 *   IDLE              — most recently active first (lastActivityAt descending)
 * A task appears in exactly one section. Ordering is stable for ties.
 */
export function partitionQueue(tasks: readonly QueueItem[]): PartitionedQueue {
  const needs: QueueItem[] = [];
  const running: QueueItem[] = [];
  const idle: QueueItem[] = [];

  for (const t of tasks) {
    if (t.activity === 'waiting') needs.push(t);
    else if (t.activity === 'running') running.push(t);
    else idle.push(t);
  }

  needs.sort((a, b) => (a.since ?? 0) - (b.since ?? 0));
  running.sort((a, b) => (b.since ?? 0) - (a.since ?? 0));
  idle.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));

  return { needs, running, idle };
}

/** A contextual next-step chip shown above the composer. */
export interface Suggestion {
  id: string;
  label: string;
  /** A ticket status this chip moves the ticket to, when that's its action. */
  moveTo?: 'reviewing' | 'done';
  /** An @mention this chip seeds into the composer, when that's its action. */
  mention?: string;
}

export interface SuggestionInput {
  status: string;
  type: string | null;
  hasPR: boolean;
}

/**
 * The ordered suggestion chips for a task (SPEC §5), limited to what Phase 1 can
 * actually perform: the two status moves, and two persona mentions the composer
 * seeds (real delegation threads are Phase 3). Workflow/panel/attach chips join
 * as their backing actions land, so the rule set stays truthful about what a
 * click does.
 */
export function suggestionsFor(t: SuggestionInput): Suggestion[] {
  const out: Suggestion[] = [];
  if (t.status === 'doing') out.push({ id: 'move-reviewing', label: '→ Move to Reviewing', moveTo: 'reviewing' });
  if (t.status === 'reviewing') out.push({ id: 'mark-done', label: '✓ Mark done', moveTo: 'done' });
  out.push({ id: 'see-with-dev', label: '⇄ See with the dev', mention: '@agent:builder ' });
  if (t.type === 'think') out.push({ id: 'see-with-pm', label: '⇄ See with the PM', mention: '@agent:pm ' });
  return out;
}

/**
 * Parse the answer options out of an agent's question text. Supports the three
 * shapes the prototype and real agents produce, checked in order:
 *   - lettered:  "a) Run now  b) Wait"  /  "A. Run now"
 *   - numbered:  "1. Run now  2. Wait"  /  "1) Wait"
 *   - bulleted:  lines starting with -, *, or •
 * Returns [] when no option list is found (free reply only). Options are trimmed
 * and empty ones dropped; a single option is treated as none (needs ≥ 2).
 */
export function parseInlineOptions(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');

  // Bulleted list — one option per line.
  const bulletRe = /^\s*[-*•]\s+(.+?)\s*$/;
  const bulleted = lines
    .map((l) => l.match(bulletRe)?.[1])
    .filter((v): v is string => !!v && v.trim().length > 0);
  if (bulleted.length >= 2) return bulleted.map((s) => s.trim());

  // Lettered options — may be inline on one line: "a) X b) Y" or line-led "A. X".
  const lettered = matchInlineMarkers(text, /(?:^|\s)([a-z])[).]\s+/gi);
  if (lettered.length >= 2) return lettered;

  // Numbered options — "1. X 2. Y" inline, or line-led "1) X".
  const numbered = matchInlineMarkers(text, /(?:^|\s)(\d{1,2})[).]\s+/g);
  if (numbered.length >= 2) return numbered;

  return [];
}

/**
 * Split `text` on a repeating marker regex (e.g. "a) ", "1. ") and return each
 * segment between consecutive markers, trimmed. The regex matches an optional
 * leading space then the marker; `markerStart` is where the marker begins (end
 * of the previous segment) and `contentStart` where the option text begins.
 */
function matchInlineMarkers(text: string, re: RegExp): string[] {
  const markers: { markerStart: number; contentStart: number }[] = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    const leadingWs = m[0].length - m[0].trimStart().length;
    markers.push({ markerStart: m.index + leadingWs, contentStart: m.index + m[0].length });
  }
  if (markers.length < 2) return [];

  const out: string[] = [];
  for (let i = 0; i < markers.length; i++) {
    const from = markers[i]!.contentStart;
    const to = i + 1 < markers.length ? markers[i + 1]!.markerStart : text.length;
    const seg = text.slice(from, to).trim().replace(/[.,;]$/, '').trim();
    if (seg) out.push(seg);
  }
  return out.length >= 2 ? out : [];
}

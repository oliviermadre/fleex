/**
 * `@scratchpad:` references in markdown.
 *
 * Lives in `shared` because both ends need the same parse: the web renders the
 * references and the server resolves them into backlinks. Two implementations
 * would drift, and a reference that renders but does not resolve is worse than
 * no reference at all.
 *
 * Fleex notes are a closed set — the global note plus one per repository — so a
 * value that is neither `global` nor `owner/name` names nothing and is declined
 * rather than guessed at.
 */

/** Storage key of the global note. */
export const GLOBAL_NOTE_KEY = '__global__';

export interface NoteRef {
  /** The matched text, e.g. `@scratchpad:acme/app`. */
  raw: string;
  /** Storage key: `__global__`, or a lowercased `owner/name`. */
  key: string;
  /** Character offsets in the source text, so a renderer can splice. */
  start: number;
  end: number;
}

/**
 * Matches `@scratchpad:<value>` where value is one or two `/`-joined segments.
 *
 * Each segment must END on a word character: without that, the greedy `[\w.-]+`
 * eats the period closing a sentence, producing a key no note ever matches.
 * Classification of the captured value happens in `normaliseNoteKey`, not here —
 * a regex that also decided what is a valid note would be unreadable.
 */
const NOTE_REF_RE = /@scratchpad:([\w.-]*\w(?:\/[\w.-]*\w)?)/g;

/** Valid repo key shape, once lowercased. */
const REPO_KEY_RE = /^[\w.-]+\/[\w.-]+$/;

/**
 * Resolve a captured reference value to a storage key, or `null` if it names no
 * note. `global` in any casing is the global note; `owner/name` is a repository
 * note, lowercased so a reference matches however it was typed.
 */
export function normaliseNoteKey(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (v === 'global') return GLOBAL_NOTE_KEY;
  return REPO_KEY_RE.test(v) ? v : null;
}

/** Every note reference in a piece of markdown, in source order. */
export function parseNoteRefs(text: string): NoteRef[] {
  const refs: NoteRef[] = [];
  // A fresh regex per call: a shared global regex carries `lastIndex` between
  // calls and would skip matches on the second document it saw.
  const re = new RegExp(NOTE_REF_RE.source, 'g');

  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const key = normaliseNoteKey(match[1]!);
    if (key === null) continue;
    refs.push({ raw: match[0], key, start: match.index, end: match.index + match[0].length });
  }
  return refs;
}

/** Distinct note keys a document references, for backlink indexing. */
export function collectNoteRefs(text: string): string[] {
  return [...new Set(parseNoteRefs(text).map((ref) => ref.key))];
}

/**
 * Whether `text` references the note `key`.
 *
 * Backlinks are computed by scanning candidate documents, which is the right
 * trade at this scale: a handful of notes is cheaper to scan than a link table
 * is to keep consistent through every edit.
 */
export function referencesNote(text: string, key: string): boolean {
  return collectNoteRefs(text).includes(key);
}

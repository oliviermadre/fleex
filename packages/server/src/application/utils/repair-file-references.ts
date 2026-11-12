/**
 * The assistant is a text-only model: it sees a user's screenshot as the markdown
 * `![x](/api/files/<uuid>)` and, to relay it to an agent, retypes the 36-character
 * uuid by hand. It sometimes changes a character (…e9a6 → …e9c6), the file is then
 * not found and the agent receives a dead link instead of the image.
 *
 * This repairs such a reference when exactly one attachment already present on the
 * ticket is within a few characters of it, and reports the ones it cannot repair so
 * the model can be told to copy the id exactly.
 */

const FILE_ID = '[0-9a-zA-Z]{8}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{12}';
const FILE_REF = new RegExp(`/api/files/(${FILE_ID})`, 'g');

/** Typos the repair accepts: a retyped uuid differs by a character or two, never by a different file. */
const MAX_DISTANCE = 3;

export interface FileRefRepair {
  text: string;
  /** References whose id was corrected to the attachment they obviously meant. */
  repaired: Array<{ from: string; to: string }>;
  /** References to a file that is not on the ticket and has no close match. */
  unresolved: string[];
}

/** Attachment ids already referenced by the given texts (comment bodies of the ticket). */
export function knownFileIds(texts: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const text of texts) for (const m of text.matchAll(FILE_REF)) ids.add(m[1]!.toLowerCase());
  return ids;
}

function distance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

export function repairFileReferences(text: string, known: ReadonlySet<string>): FileRefRepair {
  const repaired: FileRefRepair['repaired'] = [];
  const unresolved: string[] = [];
  const out = text.replace(FILE_REF, (whole, id: string) => {
    const lower = id.toLowerCase();
    if (known.has(lower)) return whole;
    let best: string | null = null;
    let bestDistance = MAX_DISTANCE + 1;
    let tie = false;
    for (const candidate of known) {
      const d = distance(lower, candidate);
      if (d < bestDistance) { best = candidate; bestDistance = d; tie = false; }
      else if (d === bestDistance) tie = true;
    }
    if (best && !tie) {
      repaired.push({ from: id, to: best });
      return `/api/files/${best}`;
    }
    unresolved.push(id);
    return whole;
  });
  return { text: out, repaired, unresolved };
}

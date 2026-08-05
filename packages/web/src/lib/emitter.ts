import type { PrimitiveKind } from './primitives';

/**
 * A deliverable's author is stored as a free-form string that encodes which
 * agentic primitive produced it: `workflow:Spec Dev PR`, `panel:archi-committee`,
 * `skill:…`, or a bare persona name (`jarvis`, `builder`, `system`).
 *
 * The Documents view shows the primitive as an icon instead of the prefix, so
 * the label stays readable and the iconography matches the rest of the app.
 * Step granularity (`workflow:X → Step`) is already collapsed server-side —
 * see migration 030 — but the suffix is stripped here too so the parser is
 * correct on any input.
 */
export interface ParsedEmitter {
  kind: PrimitiveKind;
  /** Display name, prefix and step suffix removed. */
  name: string;
}

const PREFIXES: { prefix: string; kind: PrimitiveKind }[] = [
  { prefix: 'workflow:', kind: 'workflow' },
  { prefix: 'panel:', kind: 'panel' },
  { prefix: 'skill:', kind: 'skill' },
];

/** The step separator written by the workflow engine (U+2192, space-padded). */
const STEP_SEPARATOR = ' → ';

export function parseEmitter(raw: string): ParsedEmitter {
  const withoutStep = raw.split(STEP_SEPARATOR)[0]!.trim();
  for (const { prefix, kind } of PREFIXES) {
    if (withoutStep.startsWith(prefix)) {
      return { kind, name: withoutStep.slice(prefix.length).trim() || withoutStep };
    }
  }
  // Anything unprefixed is a persona (or a pseudo-agent like `system` / `cli`).
  return { kind: 'persona', name: withoutStep };
}

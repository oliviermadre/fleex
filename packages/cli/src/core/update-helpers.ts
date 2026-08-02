/**
 * Shared pure helpers for the write commands (`agent update`, `skill update`,
 * `panel update`).
 *
 * These commands are consumed primarily by LLM agents that discover the CLI
 * through `fleex documentation`, so every failure path here uses the exact
 * error-message catalog from the spec: each message names the offending flag,
 * the value received, the allowed values, and the corrective command — an
 * agent reading stderr must be able to self-correct in one turn.
 *
 * Everything in this module is deliberately free of API calls so it stays
 * unit-testable under vitest/node.
 */
import { readFile } from 'node:fs/promises';

import { die } from './colors.ts';

export const EXECUTION_MODES = ['claude_code', 'message'] as const;

export function assertValidExecutionMode(v: string): void {
  if (!EXECUTION_MODES.includes(v as (typeof EXECUTION_MODES)[number])) {
    die(`Invalid execution mode "${v}". Allowed values: claude_code | message.`);
  }
}

/** Repeatable-option accumulator for Commander (e.g. --add-member a --add-member b). */
export function accumulate(val: string, prev: string[] = []): string[] {
  return [...prev, val];
}

/** Die when both the inline flag and its `-file` twin are set (e.g. --soul + --soul-file). */
export function assertInlineFileExclusive(base: string, inline?: string, file?: string): void {
  if (inline !== undefined && file !== undefined) {
    die(`Use either --${base} or --${base}-file, not both.`);
  }
}

/** Die when more than one `-file` flag wants to read stdin ("-"). */
export function assertSingleStdin(fileFlags: Array<{ flag: string; value?: string }>): void {
  const stdinFlags = fileFlags.filter((f) => f.value === '-');
  if (stdinFlags.length > 1) {
    die(
      `Only one flag may read from stdin ("-") per invocation. Got: ${stdinFlags
        .map((f) => `${f.flag} -`)
        .join(', ')}.`,
    );
  }
}

/**
 * The memory field has two write modes — replace (--memory/--memory-file) and
 * append (--memory-append/--memory-append-file) — that never combine.
 */
export function assertMemoryFlagsExclusive(opts: {
  memory?: string;
  memoryFile?: string;
  memoryAppend?: string;
  memoryAppendFile?: string;
}): void {
  const replace = opts.memory !== undefined || opts.memoryFile !== undefined;
  const append = opts.memoryAppend !== undefined || opts.memoryAppendFile !== undefined;
  if (replace && append) {
    die(
      'Use either --memory/--memory-file (replace) or --memory-append/--memory-append-file (append), not both.',
    );
  }
  assertInlineFileExclusive('memory', opts.memory, opts.memoryFile);
  assertInlineFileExclusive('memory-append', opts.memoryAppend, opts.memoryAppendFile);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Resolve the value of a text field fed by an inline flag and/or a `-file`
 * flag. Returns undefined when neither channel is set (field untouched).
 * `file === '-'` reads stdin. Exclusivity must have been asserted beforehand.
 */
export async function readTextInput(inline?: string, file?: string): Promise<string | undefined> {
  if (inline !== undefined) return inline;
  if (file === undefined) return undefined;
  if (file === '-') return readStdin();
  try {
    return await readFile(file, 'utf8');
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    die(`Cannot read file "${file}": ${cause}.`);
  }
}

/** Map the literal "none" to null (clears a nullable ref); pass anything else through. */
export function noneToNull(v?: string): string | null | undefined {
  if (v === undefined) return undefined;
  return v === 'none' ? null : v;
}

/** Append `addition` to the existing memory with a blank-line separator (never erases). */
export function appendMemory(existing: string | null | undefined, addition: string): string {
  return existing ? `${existing}\n\n${addition}` : addition;
}

/** Parse "<persona>[:<model>]" — split on the FIRST colon. */
export function parsePersonaModelSpec(spec: string): { personaRef: string; model?: string } {
  const idx = spec.indexOf(':');
  if (idx === -1) return { personaRef: spec };
  return { personaRef: spec.slice(0, idx), model: spec.slice(idx + 1) };
}

/** Combine the mutually exclusive --enable/--disable flags into one value. */
export function resolveEnabledFlags(enable?: boolean, disable?: boolean): boolean | undefined {
  if (enable && disable) die('Use either --enable or --disable, not both.');
  if (enable) return true;
  if (disable) return false;
  return undefined;
}

/** Die with the "nothing to do" catalog message for an update command. */
export function dieNoUpdates(resource: 'agent' | 'skill' | 'panel'): never {
  die(
    `No updates specified. Pass at least one modification flag — run 'fleex ${resource} update --help' for the full list.`,
  );
}

// ── Panel member merge ───────────────────────────────────────────────────────

export interface PanelMemberLike {
  personaId: string;
  order: number;
  modelOverride: string;
}

/** A persona reference as the user typed it (`ref`) plus its resolved UUID. */
export interface MemberRef {
  ref: string;
  personaId: string;
}

export interface MemberAdd extends MemberRef {
  model?: string;
}

export interface MemberSetModel extends MemberRef {
  model: string;
}

/**
 * Apply incremental member edits (add / rm / set-model / reorder) to the
 * current member list and return the full merged array, `order` reindexed
 * 0..n-1. Adds are applied before removals so a single invocation can replace
 * the last member. Dies with the catalog messages on any invalid edit.
 */
export function applyMemberEdits(
  current: PanelMemberLike[],
  edits: {
    add: MemberAdd[];
    rm: MemberRef[];
    setModel: MemberSetModel[];
    order?: MemberRef[];
  },
  memberName: (personaId: string) => string,
): PanelMemberLike[] {
  const members = [...current]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((m) => ({ ...m }));

  for (const add of edits.add) {
    if (members.some((m) => m.personaId === add.personaId)) {
      die(
        `"${add.ref}" is already a member of this panel. Use --set-member-model ${add.ref}:<model> to change its model.`,
      );
    }
    members.push({
      personaId: add.personaId,
      order: members.length,
      modelOverride: add.model ?? 'inherited',
    });
  }

  for (const rm of edits.rm) {
    const idx = members.findIndex((m) => m.personaId === rm.personaId);
    if (idx === -1) die(`"${rm.ref}" is not a member of this panel.`);
    members.splice(idx, 1);
  }
  if (members.length === 0) {
    die(
      'Cannot remove the last member — a panel needs at least one. Add a replacement with --add-member first.',
    );
  }

  for (const sm of edits.setModel) {
    const m = members.find((x) => x.personaId === sm.personaId);
    if (!m) {
      die(
        `"${sm.ref}" is not a member of this panel. Use --add-member ${sm.ref}:${sm.model} to add it.`,
      );
    }
    m.modelOverride = sm.model;
  }

  if (edits.order) {
    const orderIds = edits.order.map((o) => o.personaId);
    const currentIds = members.map((m) => m.personaId);
    const isCompletePermutation =
      orderIds.length === currentIds.length &&
      new Set(orderIds).size === orderIds.length &&
      currentIds.every((id) => orderIds.includes(id));
    if (!isCompletePermutation) {
      die(
        `--member-order must list every current member exactly once. Current members: ${currentIds
          .map(memberName)
          .join(', ')}.`,
      );
    }
    members.sort((a, b) => orderIds.indexOf(a.personaId) - orderIds.indexOf(b.personaId));
  }

  members.forEach((m, i) => {
    m.order = i;
  });
  return members;
}

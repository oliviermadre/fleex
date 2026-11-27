/**
 * The Assistant's one guard: a file write outside the conversation folder.
 *
 * The session runs in `bypassPermissions` like a persona: Bash, MCP and every
 * `fleex` command run without asking. Only `Write`, `Edit` and `NotebookEdit`
 * aimed (symlinks followed) outside the conversation folder wait for the user:
 * a `PreToolUse` hook awaits the decision and answers `allow` or `deny`
 * itself, which works whatever the permission mode.
 */
import fs from 'node:fs';
import { isInside, resolveReal } from './work-dir.ts';

export const GUARDED_TOOLS = ['Write', 'Edit', 'NotebookEdit'] as const;
export type GuardedTool = (typeof GUARDED_TOOLS)[number];

/** What the confirmation card shows. */
export interface OutsideWriteRequest {
  /** tool_use id of the call. */
  id: string;
  tool: GuardedTool;
  /** Absolute, symlink-resolved target. */
  path: string;
  diff: string;
  isNewFile: boolean;
}

export type OutsideWriteDecision = 'allow' | 'deny' | 'always';

export interface GuardDeps {
  workDir: () => string;
  /** "Always allow in this conversation" is on — read live, never captured. */
  outsideWritesAllowed: () => boolean;
  /** Ask the user; resolves with their answer (a Stop resolves `deny`). */
  ask: (req: OutsideWriteRequest) => Promise<OutsideWriteDecision>;
  /** A call let through by the standing approval, for the ⚡ marker. */
  onAutoAllowed?: (id: string) => void;
  /** The user answered `always`. */
  onAlways?: () => void;
}

const CONTEXT = 3;
const NEW_FILE_PREVIEW_LINES = 40;
/** Line-diff budget: beyond it, a whole-file replacement is shown instead. */
const MAX_DIFF_CELLS = 4_000_000;

function readOrNull(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/** Unified-style line diff (no hunk headers): ' ' kept, '-' removed, '+' added, with context folding. */
export function lineDiff(before: string, after: string, context = CONTEXT): string {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > MAX_DIFF_CELLS) {
    return [...a.map((l) => `-${l}`), ...b.map((l) => `+${l}`)].join('\n');
  }
  // LCS table, bottom-up.
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const ops: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push(` ${a[i]}`);
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      ops.push(`+${b[j]}`);
      j++;
    } else {
      ops.push(`-${a[i]}`);
      i++;
    }
  }
  // Keep `context` unchanged lines around each change, fold the rest.
  const keep = ops.map(() => false);
  ops.forEach((op, k) => {
    if (op[0] === ' ') return;
    for (let d = Math.max(0, k - context); d <= Math.min(ops.length - 1, k + context); d++) keep[d] = true;
  });
  const out: string[] = [];
  let folded = false;
  ops.forEach((op, k) => {
    if (keep[k]) {
      out.push(op);
      folded = false;
    } else if (!folded) {
      out.push('…');
      folded = true;
    }
  });
  return out.join('\n');
}

/** The preview a confirmation card shows for this write. */
export function previewWrite(tool: GuardedTool, input: Record<string, unknown>, absPath: string): { diff: string; isNewFile: boolean } {
  const current = readOrNull(absPath);
  const isNewFile = current === null;
  if (tool === 'Write') {
    const content = typeof input.content === 'string' ? input.content : '';
    if (isNewFile) {
      const lines = content.split('\n');
      const head = lines.slice(0, NEW_FILE_PREVIEW_LINES).map((l) => `+${l}`);
      if (lines.length > NEW_FILE_PREVIEW_LINES) head.push(`… ${lines.length - NEW_FILE_PREVIEW_LINES} more lines`);
      return { diff: head.join('\n'), isNewFile };
    }
    return { diff: lineDiff(current, content), isNewFile };
  }
  if (tool === 'Edit') {
    const oldS = typeof input.old_string === 'string' ? input.old_string : '';
    const newS = typeof input.new_string === 'string' ? input.new_string : '';
    if (current !== null && oldS && current.includes(oldS)) {
      const replaced = input.replace_all === true ? current.split(oldS).join(newS) : current.replace(oldS, () => newS);
      return { diff: lineDiff(current, replaced), isNewFile };
    }
    return { diff: lineDiff(oldS, newS), isNewFile };
  }
  // NotebookEdit: the targeted cell and its new source.
  const cell = typeof input.cell_id === 'string' ? input.cell_id : typeof input.cell_number === 'number' ? `#${input.cell_number}` : 'new cell';
  const source = typeof input.new_source === 'string' ? input.new_source : '';
  return { diff: [`cell ${cell} (${String(input.edit_mode ?? 'replace')})`, ...source.split('\n').map((l) => `+${l}`)].join('\n'), isNewFile };
}

/** File path a guarded tool writes to. */
export function targetOf(tool: string, input: Record<string, unknown>): string | undefined {
  const p = tool === 'NotebookEdit' ? input.notebook_path : input.file_path;
  return typeof p === 'string' && p ? p : undefined;
}

type HookOutput = {
  continue?: boolean;
  hookSpecificOutput?: { hookEventName: 'PreToolUse'; permissionDecision: 'allow' | 'deny'; permissionDecisionReason?: string };
};

/** One `PreToolUse` callback: let writes inside the folder through, ask for the others. */
export function createOutsideWriteHook(deps: GuardDeps) {
  return async (input: { tool_name?: string; tool_input?: unknown; tool_use_id?: string }, toolUseId: string | undefined): Promise<HookOutput> => {
    const tool = input.tool_name as GuardedTool;
    if (!GUARDED_TOOLS.includes(tool)) return {};
    const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
    const target = targetOf(tool, toolInput);
    if (!target) return {};
    const dir = deps.workDir();
    if (isInside(target, dir, dir)) return {};

    const id = toolUseId ?? input.tool_use_id ?? '';
    if (deps.outsideWritesAllowed()) {
      deps.onAutoAllowed?.(id);
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
    }
    const abs = resolveReal(target, dir);
    const decision = await deps.ask({ id, tool, path: abs, ...previewWrite(tool, toolInput, abs) });
    if (decision === 'always') deps.onAlways?.();
    if (decision === 'deny') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            `The user refused this write to ${abs}, outside the conversation folder ${dir}. ` +
            'Nothing was written. Do not retry it; offer to write in the conversation folder instead.',
        },
      };
    }
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
  };
}

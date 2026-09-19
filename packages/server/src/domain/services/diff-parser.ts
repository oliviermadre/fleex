import type { DiffFile, DiffHunk, DiffLine } from '@fleex/shared';

/**
 * Parse a unified `git diff` patch into structured files/hunks for the Work
 * view's Diff panel. Pure and tolerant: unknown lines are ignored and a
 * truncated trailing hunk is kept as far as it parsed (the route caps raw
 * patch size, so the tail may be clipped mid-hunk).
 */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  if (!patch.trim()) return files;

  const lines = patch.split('\n');

  let current: {
    aPath: string | null;
    bPath: string | null;
    additions: number;
    deletions: number;
    binary: boolean;
    hunks: DiffHunk[];
  } | null = null;
  let hunk: { header: string; lines: DiffLine[] } | null = null;

  const flushFile = () => {
    if (!current) return;
    if (hunk) {
      current.hunks.push(hunk);
      hunk = null;
    }
    // Deleted files have `+++ /dev/null`, so fall back to the a/ path.
    const path = pickPath(current.bPath) ?? pickPath(current.aPath) ?? '';
    files.push({
      path,
      additions: current.additions,
      deletions: current.deletions,
      hunks: current.hunks,
      ...(current.binary ? { binary: true } : {}),
    });
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flushFile();
      const parsed = parseDiffGitHeader(line);
      current = {
        aPath: parsed?.aPath ?? null,
        bPath: parsed?.bPath ?? null,
        additions: 0,
        deletions: 0,
        binary: false,
        hunks: [],
      };
      continue;
    }

    if (!current) continue;

    if (line.startsWith('--- ')) {
      current.aPath = stripDevNull(line.slice(4), 'a/');
      continue;
    }
    if (line.startsWith('+++ ')) {
      current.bPath = stripDevNull(line.slice(4), 'b/');
      continue;
    }
    if (line.startsWith('Binary files ')) {
      current.binary = true;
      continue;
    }
    if (line.startsWith('@@')) {
      if (hunk) current.hunks.push(hunk);
      hunk = { header: line, lines: [] };
      continue;
    }
    if (!hunk) continue;

    // Ignore the "no newline at end of file" marker (both `\ ` git variants).
    if (line.startsWith('\\')) continue;

    const prefix = line[0];
    const text = line.slice(1);
    if (prefix === '+') {
      current.additions += 1;
      hunk.lines.push({ kind: 'add', text });
    } else if (prefix === '-') {
      current.deletions += 1;
      hunk.lines.push({ kind: 'del', text });
    } else if (prefix === ' ') {
      hunk.lines.push({ kind: 'ctx', text });
    }
    // A bare empty string (context line that is itself empty) has prefix
    // undefined; git always emits a leading space for context, so treat a
    // truly empty line as an empty context line.
    else if (line === '') {
      hunk.lines.push({ kind: 'ctx', text: '' });
    }
  }

  flushFile();
  return files;
}

/**
 * New-side line numbers of added/modified lines in a single-file unified diff —
 * used to paint the Code editor's gutter (Monaco line decorations). Deletions
 * don't advance the new-side counter; the `@@ … +c,d @@` header sets it.
 */
export function changedLineNumbers(patch: string): number[] {
  const result: number[] = [];
  if (!patch.trim()) return result;

  let newLine = 0;
  let inHunk = false;

  for (const line of patch.split('\n')) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      newLine = parseInt(header[1]!, 10);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"

    const prefix = line[0];
    if (prefix === '+') {
      result.push(newLine);
      newLine += 1;
    } else if (prefix === '-') {
      // deletion — new-side line number does not advance
    } else {
      // context (leading space) or a truly empty context line
      newLine += 1;
    }
  }

  return result;
}

/** Drop the `a/`/`b/` prefix; return null when the side is /dev/null. */
function stripDevNull(raw: string, prefix: 'a/' | 'b/'): string | null {
  const value = raw.trim();
  if (value === '/dev/null') return null;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function pickPath(value: string | null): string | null {
  return value && value.length > 0 ? value : null;
}

/**
 * Extract a/ and b/ paths from a `diff --git a/x b/x` header. Uses the a/…b/
 * split point; falls back to a plain space split for simple paths. Paths with
 * spaces are handled by locating the ` b/` boundary.
 */
function parseDiffGitHeader(line: string): { aPath: string; bPath: string } | null {
  const body = line.slice('diff --git '.length);
  const bMarker = ' b/';
  const idx = body.indexOf(bMarker);
  if (idx === -1) return null;
  const aPart = body.slice(0, idx); // "a/path"
  const bPart = body.slice(idx + 1); // "b/path"
  return {
    aPath: aPart.startsWith('a/') ? aPart.slice(2) : aPart,
    bPath: bPart.startsWith('b/') ? bPart.slice(2) : bPart,
  };
}

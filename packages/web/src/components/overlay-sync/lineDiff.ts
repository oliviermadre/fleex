export type DiffRowType = 'same' | 'add' | 'del';

export interface DiffRow {
  /** Overlay (existing) line, null when the line only exists locally. */
  left: string | null;
  /** Local (incoming) line, null when the line only exists in the overlay. */
  right: string | null;
  type: DiffRowType;
}

/** Above this line count we skip the O(n·m) LCS and align by index instead. */
const LCS_LINE_CAP = 1500;

/**
 * Side-by-side line diff between the overlay content (`left`) and the local
 * content (`right`). Uses LCS for an accurate alignment on reasonably sized
 * files, falling back to index alignment for very large inputs.
 */
export function computeLineDiff(overlay: string, local: string): DiffRow[] {
  const a = overlay.split('\n');
  const b = local.split('\n');

  if (a.length > LCS_LINE_CAP || b.length > LCS_LINE_CAP) {
    return alignByIndex(a, b);
  }
  return alignByLcs(a, b);
}

function alignByIndex(a: string[], b: string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const left = i < a.length ? a[i]! : null;
    const right = i < b.length ? b[i]! : null;
    rows.push({
      left,
      right,
      type: left === right ? 'same' : left === null ? 'add' : right === null ? 'del' : 'del',
    });
  }
  return rows;
}

function alignByLcs(a: string[], b: string[]): DiffRow[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ left: a[i]!, right: b[j]!, type: 'same' });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      rows.push({ left: a[i]!, right: null, type: 'del' });
      i++;
    } else {
      rows.push({ left: null, right: b[j]!, type: 'add' });
      j++;
    }
  }
  while (i < n) rows.push({ left: a[i++]!, right: null, type: 'del' });
  while (j < m) rows.push({ left: null, right: b[j++]!, type: 'add' });
  return rows;
}

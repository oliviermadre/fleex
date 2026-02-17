/** Encode a filesystem path to Claude's project directory naming convention. */
export function encodePath(cwd: string): string {
  return '-' + cwd.slice(1).replace(/[/.]/g, '-');
}

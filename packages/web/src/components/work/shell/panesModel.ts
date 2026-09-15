/**
 * Resolves which session each shell pane shows. Binding is fully explicit: pane i
 * shows the session pinned to slot i (workStore.shellPaneIds) and nothing else — no
 * auto-fill. An unset/null slot stays empty; a binding to a session that no longer
 * exists (killed) resolves to empty; a session is never shown in two panes (that
 * would be two tmux clients on one session — the resize war we already fought).
 */
export function resolvePanes(
  sessionIds: readonly string[],
  paneCount: number,
  bindings: readonly (string | null)[],
): (string | null)[] {
  const existing = new Set(sessionIds);
  const used = new Set<string>();
  const result: (string | null)[] = [];

  for (let i = 0; i < paneCount; i++) {
    const b = bindings[i] ?? null;
    if (b && existing.has(b) && !used.has(b)) {
      result[i] = b;
      used.add(b);
    } else {
      result[i] = null;
    }
  }

  return result;
}

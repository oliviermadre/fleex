/**
 * Tab bar + split panes for one ticket's shells. Shared by both hosts — the bottom
 * drawer (⌘J) and shell mode (⌘⇧J). Owns the focused-pane index and resolves which
 * session each pane shows (panesModel). Binding is explicit and pane-local: the tab
 * bar is a session roster (new / rename / kill), and panes bind via their own title
 * dropdown / empty-pane menu — a tab click never re-binds a pane. The split preset
 * and pane bindings are remembered per ticket, so one ticket's layout or sessions
 * never leak into another's.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkStore, selectShellLayout, selectShellPaneIds, type ShellLayout } from '../../../stores/workStore';
import { terminalManager } from '../../../services/terminalManager';
import { ShellTabBar } from './ShellTabBar';
import { ShellPanes } from './ShellPanes';
import { useShellSessions } from './useShellSessions';
import { paneCount } from './shellLayout';
import { resolvePanes } from './panesModel';

export function ShellSurface({ ticketId }: { ticketId: string }) {
  const { sessions, creating, newShell, killShell, renameShell } = useShellSessions(ticketId);
  const layout = useWorkStore(selectShellLayout(ticketId));
  const bindings = useWorkStore(selectShellPaneIds(ticketId));
  const setTicketShellLayout = useWorkStore((s) => s.setShellLayout);
  const bindTicketShellPane = useWorkStore((s) => s.bindShellPane);

  const setLayout = useCallback(
    (next: ShellLayout) => setTicketShellLayout(ticketId, next),
    [setTicketShellLayout, ticketId],
  );
  const bindShellPane = useCallback(
    (paneIndex: number, id: string | null) => bindTicketShellPane(ticketId, paneIndex, id),
    [bindTicketShellPane, ticketId],
  );

  const count = paneCount(layout);
  const [focusedPane, setFocusedPane] = useState(0);
  useEffect(() => {
    if (focusedPane >= count) setFocusedPane(count - 1);
  }, [count, focusedPane]);

  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);
  const resolved = useMemo(
    () => resolvePanes(sessionIds, count, bindings),
    [sessionIds, count, bindings],
  );
  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const shownIds = useMemo(() => new Set(resolved.filter((id): id is string => !!id)), [resolved]);
  const unshown = useMemo(() => sessions.filter((s) => !shownIds.has(s.id)), [sessions, shownIds]);

  // Open a new shell and pin it to the pane that asked for it (pane menus only —
  // the tab-bar "+" creates an unbound shell that lands in the roster).
  const newShellInPane = async (paneIndex: number) => {
    const id = await newShell();
    if (id) bindShellPane(paneIndex, id);
  };

  const focusPane = (i: number) => {
    setFocusedPane(i);
    const id = resolved[i];
    if (id) terminalManager.get(id)?.terminal.focus();
  };

  // Cycle the focused pane through the ticket's sessions (skipping ones already
  // shown in another pane, since a session lives in one pane only).
  const cycleFocusedSession = (dir: 1 | -1) => {
    const current = resolved[focusedPane] ?? null;
    const shownElsewhere = new Set(
      resolved.filter((id, i): id is string => !!id && i !== focusedPane),
    );
    const candidates = sessions.filter((s) => s.id === current || !shownElsewhere.has(s.id)).map((s) => s.id);
    if (candidates.length === 0) return;
    const curIdx = current ? candidates.indexOf(current) : -1;
    const nextIdx =
      curIdx < 0
        ? dir > 0
          ? 0
          : candidates.length - 1
        : (curIdx + dir + candidates.length) % candidates.length;
    bindShellPane(focusedPane, candidates[nextIdx]!);
  };

  // ⌘1-4 focus a pane. ⌘⇧←/→ depends on the layout: in a split it moves focus
  // between panes (TL→TR→BL→BR); with a single pane it cycles that pane's session
  // (there's nowhere else to move focus). Only one surface mounts at a time (drawer
  // XOR shell mode), so this listener isn't duplicated.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (!e.shiftKey) {
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= count) {
          e.preventDefault();
          focusPane(n - 1);
        }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (count > 1) focusPane((focusedPane + dir + count) % count);
        else cycleFocusedSession(dir);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, focusedPane, resolved, sessions]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShellTabBar
        sessions={sessions}
        shownIds={shownIds}
        creating={creating}
        onSelectTab={(id) => bindShellPane(focusedPane, id)}
        onNewShell={() => void newShell()}
        onKill={killShell}
        onRename={renameShell}
        layout={layout}
        onLayoutChange={setLayout}
      />
      <ShellPanes
        layout={layout}
        resolved={resolved}
        sessionById={sessionById}
        unshown={unshown}
        focusedPane={focusedPane}
        setFocusedPane={setFocusedPane}
        showFocus={count > 1}
        creating={creating}
        onBindToPane={bindShellPane}
        onUnbindPane={(i) => bindShellPane(i, null)}
        onNewShellInPane={newShellInPane}
      />
    </div>
  );
}

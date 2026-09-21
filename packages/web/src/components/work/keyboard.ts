/**
 * Work view keyboard map. Phase 1 handles ⌥N (new task), Esc (cancel new task),
 * and ⌘⇧↑/↓ to move between tasks in the queue's displayed order (wrapping, like
 * the Sessions view). Phase 2 adds ⌘J (toggle shell drawer) and ⌘⇧J (toggle shell
 * mode); ⌘1-4 (focus a pane) is owned by the mounted shell grid, not here.
 * ⌃< / ⌃⇧< cycle the center mode (Chat → Shell → Code → Workflow when present).
 * Text-target shortcuts are ignored while typing in a field, except Esc; the meta
 * combos (⌘J/⌘⇧J and queue nav) fire regardless, like the app's other ⌘ shortcuts.
 */
import { useEffect } from 'react';
import { useWorkStore } from '../../stores/workStore';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';
import { activeMode, cycleMode } from './modes';

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

/** @param orderedIds task ids in the queue's displayed order (needs → running → idle). */
export function useWorkKeyboard(orderedIds: readonly string[]): void {
  const setView = useWorkStore((s) => s.setView);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      // ⌃< / ⌃⇧< (">") — cycle the center mode forward / backward in switcher order.
      // Control, not ⌘: on ISO Mac keyboards macOS keeps ⌘< for window cycling. The
      // physical key is matched too, since Shift turns "<" into ">".
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'IntlBackslash' || e.key === '<' || e.key === '>')) {
        const store = useWorkStore.getState();
        if (store.view !== 'task' || !store.modeTicketId) return;
        e.preventDefault();
        const hasWorkflowRuns = (useWorkflowRunStore.getState().runsByTicket[store.modeTicketId]?.length ?? 0) > 0;
        store.setMode(cycleMode(activeMode(store, hasWorkflowRuns), e.shiftKey ? -1 : 1, hasWorkflowRuns));
        return;
      }

      // ⌘⇧↑/↓ — move selection through the queue, wrapping at the ends.
      if (meta && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (orderedIds.length === 0) return;
        e.preventDefault();
        const current = useWorkStore.getState().selectedTicketId;
        const idx = current ? orderedIds.indexOf(current) : -1;
        const next =
          e.key === 'ArrowUp'
            ? idx <= 0
              ? orderedIds.length - 1
              : idx - 1
            : idx >= orderedIds.length - 1
              ? 0
              : idx + 1;
        useWorkStore.getState().selectTicket(orderedIds[next]!);
        return;
      }

      // ⌘⇧J — toggle shell mode (center takeover). Checked before ⌘J so the shift
      // combo isn't swallowed by the plain-J branch.
      if (meta && e.shiftKey && (e.key.toLowerCase() === 'j' || e.code === 'KeyJ')) {
        e.preventDefault();
        useWorkStore.getState().setShellMode(!useWorkStore.getState().shellMode);
        return;
      }
      // ⌘J — toggle the shell drawer.
      if (meta && !e.shiftKey && (e.key.toLowerCase() === 'j' || e.code === 'KeyJ')) {
        e.preventDefault();
        useWorkStore.getState().setShellOpen(!useWorkStore.getState().shellOpen);
        return;
      }

      // ⌥N — new task (Alt+N). Not while typing.
      if (e.altKey && (e.key.toLowerCase() === 'n' || e.code === 'KeyN') && !isTypingTarget(e.target)) {
        e.preventDefault();
        useWorkStore.getState().setView('new');
        return;
      }
      // Esc — close the composer. The ENTRY and RESOLVING screens own Esc
      // themselves (refuse a recognized link, cancel a running import → back to
      // ENTRY) and must not be torn down from under them by this window-level
      // handler, so it only closes once the draft reached the composer stage.
      if (
        e.key === 'Escape'
        && useWorkStore.getState().view === 'new'
        && useWorkStore.getState().draft.stage === 'compose'
      ) {
        setView('task');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setView, orderedIds]);
}

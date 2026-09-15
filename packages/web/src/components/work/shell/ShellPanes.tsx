/**
 * The split grid of shell panes. The layout preset (workStore.shellLayout, chosen
 * only from the tab bar) drives how many panes show and their arrangement; which
 * session each pane shows is resolved upstream (ShellSurface + panesModel) and
 * passed in as `resolved`. Panes never change the layout — a pane's ✕ unbinds its
 * session (leaving the pane empty), and its title switches the binding.
 *
 * Focus is pane-local (a 1px indigo ring + xterm focus): clicking a pane focuses
 * it; ⌘1-4 / ⌘⇧←/→ are owned by ShellSurface. Terminal re-fitting is handled by
 * each pane's own useTerminal (debounced ResizeObserver), never here.
 */
import type { CSSProperties } from 'react';
import type { Session } from '@fleex/shared';
import { terminalManager } from '../../../services/terminalManager';
import { paneCount, type ShellLayout } from './shellLayout';
import { ShellPane } from './ShellPane';

/** Grid container template per preset. */
function containerStyle(layout: ShellLayout): CSSProperties {
  switch (layout) {
    case '1':
      return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
    case 'cols':
      return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
    case 'rows':
      return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr 1fr' };
    case 'three':
    case 'grid':
      return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
  }
}

/** In the "one + two stacked" preset the first pane spans both rows. */
function paneStyle(layout: ShellLayout, i: number): CSSProperties | undefined {
  if (layout !== 'three') return undefined;
  if (i === 0) return { gridColumn: '1', gridRow: '1 / span 2' };
  if (i === 1) return { gridColumn: '2', gridRow: '1' };
  return { gridColumn: '2', gridRow: '2' };
}

export function ShellPanes({
  layout,
  resolved,
  sessionById,
  unshown,
  focusedPane,
  setFocusedPane,
  showFocus,
  creating,
  onBindToPane,
  onUnbindPane,
  onNewShellInPane,
}: {
  /** The ticket's split preset. */
  layout: ShellLayout;
  resolved: (string | null)[];
  sessionById: Map<string, Session>;
  /** Sessions not currently shown in any pane — offered by the bind menu. */
  unshown: Session[];
  focusedPane: number;
  setFocusedPane: (i: number) => void;
  /** Show the focus ring — only meaningful with more than one pane. */
  showFocus: boolean;
  creating: boolean;
  onBindToPane: (paneIndex: number, id: string) => void;
  onUnbindPane: (paneIndex: number) => void;
  onNewShellInPane: (paneIndex: number) => void;
}) {
  const count = paneCount(layout);

  const focusPane = (i: number) => {
    setFocusedPane(i);
    const id = resolved[i];
    if (id) terminalManager.get(id)?.terminal.focus();
  };

  return (
    <div className="grid min-h-0 flex-1 gap-px bg-[var(--theme-border)] p-px" style={containerStyle(layout)}>
      {Array.from({ length: count }, (_, i) => {
        const id = resolved[i];
        const session = id ? sessionById.get(id) ?? null : null;
        return (
          // flex wrapper so ShellPane stretches to the full cell height — a block
          // wrapper let the pane collapse to its header, attaching the terminal at 1
          // row and (with tmux window-size=latest) dragging the shared session down.
          <div key={i} className="flex min-h-0 min-w-0" style={paneStyle(layout, i)}>
            <ShellPane
              session={session}
              focused={showFocus && i === focusedPane}
              bindable={unshown}
              onFocus={() => focusPane(i)}
              onUnbind={() => onUnbindPane(i)}
              onBind={(sid) => onBindToPane(i, sid)}
              onNewShell={() => onNewShellInPane(i)}
              creating={creating}
            />
          </div>
        );
      })}
    </div>
  );
}

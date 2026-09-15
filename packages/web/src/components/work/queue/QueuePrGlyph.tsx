/**
 * The queue row's PR indicator: one GitHub PR icon whose shape and colour give the
 * ticket's most actionable PR state, with a count when it has several. Hovering or
 * focusing it opens a card listing every PR, each a link to GitHub; the card stays
 * open while the pointer travels into it (safePolygon) and renders in a portal so
 * the queue's scroll container never clips it. With a single PR the icon itself
 * opens that PR; with several, clicking the icon does nothing.
 */
import { useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { cn } from '../../../lib/cn';
import { tintText, type TintHue } from '../../../lib/tints';
import type { WorkPrLink, WorkPrState } from '../types';
import { aggregatePrState } from './prLinks';

const HUE: Record<WorkPrState, TintHue> = { open: 'green', draft: 'gray', merged: 'purple', closed: 'red' };
const LABEL: Record<WorkPrState, string> = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' };

/** GitHub octicons: git-pull-request, -draft, git-merge, -closed. */
const ICON_PATH: Record<WorkPrState, string> = {
  open: 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z',
  draft: 'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z',
  merged: 'M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z',
  closed: 'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z',
};

/** Unknown (not loaded yet) reads as a faint open-PR icon. */
function stateColor(state: WorkPrState | null): string {
  return state ? tintText(HUE[state]) : 'text-[var(--theme-text-faint)]';
}

function PrIcon({ state }: { state: WorkPrState | null }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d={ICON_PATH[state ?? 'open']} />
    </svg>
  );
}

/** Keep clicks and keys inside the glyph or its card from selecting the queue row. */
const stopRow = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

const formatLines = (n: number) => n.toLocaleString('en-US');

export function QueuePrGlyph({ prs }: { prs: WorkPrLink[] }) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const hover = useHover(context, { delay: { open: 120 }, handleClose: safePolygon() });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  const state = aggregatePrState(prs);
  const single = prs.length === 1 ? prs[0]! : null;
  const triggerClass = cn(
    'flex shrink-0 items-center gap-0.5 rounded px-[3px] py-0.5 transition-colors hover:bg-[var(--theme-bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-accent)]',
    stateColor(state),
  );
  const glyph = (
    <>
      <PrIcon state={state} />
      {prs.length > 1 && <span className="font-mono text-[9.5px] font-semibold leading-none">{prs.length}</span>}
    </>
  );

  return (
    <>
      {single ? (
        <a
          ref={refs.setReference}
          href={single.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${single.label} on GitHub`}
          className={triggerClass}
          {...getReferenceProps({ onClick: stopRow, onKeyDown: stopRow })}
        >
          {glyph}
        </a>
      ) : (
        <span
          ref={refs.setReference}
          tabIndex={0}
          aria-label={`${prs.length} pull requests`}
          className={cn(triggerClass, 'cursor-default')}
          {...getReferenceProps({ onClick: stopRow, onKeyDown: stopRow })}
        >
          {glyph}
        </span>
      )}

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-50 w-[300px] max-w-[calc(100vw-16px)] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-1 shadow-xl"
            {...getFloatingProps({ onClick: stopRow, onKeyDown: stopRow })}
          >
            <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--theme-text-muted)]">
              {prs.length === 1 ? '1 pull request' : `${prs.length} pull requests`}
            </div>
            {prs.map((pr) => (
              <a
                key={pr.ref}
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5 hover:bg-[var(--theme-bg-hover)]"
              >
                <span className={stateColor(pr.state)}>
                  <PrIcon state={pr.state} />
                </span>
                <span className="truncate font-mono text-[11.5px] text-[var(--theme-text-primary)]">{pr.label}</span>
                <span className={cn('font-mono text-[10px] uppercase tracking-[0.04em]', stateColor(pr.state))}>
                  {pr.state ? LABEL[pr.state] : '…'}
                </span>
                {(pr.title || pr.additions != null) && (
                  <span className="col-start-2 col-end-4 truncate text-[11.5px] text-[var(--theme-text-secondary)]">
                    {pr.title}
                    {pr.title && pr.additions != null && ' · '}
                    {pr.additions != null && (
                      <span className={cn('font-mono text-[10.5px]', tintText('green'))}>+{formatLines(pr.additions)}</span>
                    )}
                    {pr.deletions != null && (
                      <span className={cn('ml-1 font-mono text-[10.5px]', tintText('red'))}>−{formatLines(pr.deletions)}</span>
                    )}
                  </span>
                )}
              </a>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

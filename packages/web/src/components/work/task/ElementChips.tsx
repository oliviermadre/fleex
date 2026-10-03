/**
 * Elements picked in the ticket browser, waiting above the work composer. They
 * are serialized into the comment body on send (see composeBody).
 */
import { useState } from 'react';
import { useBrowserStore } from '../../../stores/browserStore';
import { ElementContextCard } from '../../shared/ElementContextCard';
import { elementLabel, type PendingElement } from '../../shared/elementContext';

const NONE: PendingElement[] = [];

export function ElementChips({ ticketId }: { ticketId: string }) {
  const elements = useBrowserStore((s) => s.pendingElements[ticketId]) ?? NONE;
  const removeElement = useBrowserStore((s) => s.removeElement);
  const [openId, setOpenId] = useState<string | null>(null);
  if (elements.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {elements.map((el) => (
        <div key={el.id} className="relative">
          <div className="flex h-7 max-w-[280px] items-center gap-1 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] pl-2 pr-1 text-xs">
            <button type="button" onClick={() => setOpenId(openId === el.id ? null : el.id)} className="flex min-w-0 items-center gap-1.5 text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l7 17 2.5-7.5L20 10z" /></svg>
              <span className="truncate font-mono">{elementLabel(el.context)}</span>
            </button>
            <button type="button" title="Remove" onClick={() => removeElement(ticketId, el.id)} className="px-1 text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]">×</button>
          </div>
          {openId === el.id && (
            <div className="absolute bottom-full left-0 z-30 mb-2 max-h-[60vh] w-[420px] overflow-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-2 shadow-lg">
              <p className="px-1 pb-1 text-xs text-[var(--theme-text-muted)]">Included with your message</p>
              {el.captureFailed && <p className="px-1 pb-1 text-xs text-[var(--theme-text-muted)]">Screenshot unavailable</p>}
              <ElementContextCard context={el.context} screenshotUrl={el.screenshotUrl} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

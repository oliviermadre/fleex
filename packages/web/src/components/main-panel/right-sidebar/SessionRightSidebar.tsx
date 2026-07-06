import { useEffect, useRef } from 'react';
import { clampRightSidebarWidth, useUIStore } from '../../../stores/uiStore';
import { SidebarTopPanel } from './SidebarTopPanel';
import { SidebarBottomPanel } from './SidebarBottomPanel';
import { SidebarSplitHandle } from './SidebarSplitHandle';
import { SidebarWidthHandle } from './SidebarWidthHandle';

const COLLAPSED_WIDTH = 55;

interface Props {
  /** Parent tmux session tab the sidebar is bound to (its bottom terminals are scoped to this session). */
  parentSessionId: string;
  /** Ticket display ID — for naming new sidebar tmux sessions. */
  ticketDisplayId: number;
  /** cwd for new sidebar terminals. */
  cwd: string;
  /** Repo keys (org/name) assigned to the ticket — one scratchpad tab per repo, in addition to Global. */
  repoKeys: string[];
  /** Repo key of the current worktree session — selected by default in the scratchpad tab strip. */
  defaultRepoKey: string | null;
  /** Ref to the container wrapping (main panel + this sidebar) — used to cap width at 75% of that area. */
  parentRef: React.RefObject<HTMLDivElement | null>;
}

export function SessionRightSidebar({
  parentSessionId,
  ticketDisplayId,
  cwd,
  repoKeys,
  defaultRepoKey,
  parentRef,
}: Props) {
  const width = useUIStore((s) => s.rightSidebarWidth);
  const ratio = useUIStore((s) => s.rightSidebarSplitRatio);
  const collapsed = useUIStore((s) => s.rightSidebarCollapsed);
  const toggleRightSidebar = useUIStore((s) => s.toggleRightSidebar);
  const setRightSidebarWidth = useUIStore((s) => s.setRightSidebarWidth);
  const containerRef = useRef<HTMLDivElement>(null);

  // Re-clamp width whenever the parent area changes (window resize, nav expand/collapse,
  // contentPanel resize). Also fires once on mount to clamp any out-of-bounds persisted value.
  useEffect(() => {
    const el = parentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const parentWidth = entries[0]?.contentRect.width ?? el.getBoundingClientRect().width;
      if (parentWidth <= 0) return;
      const current = useUIStore.getState().rightSidebarWidth;
      const clamped = clampRightSidebarWidth(current, parentWidth);
      if (clamped !== current) setRightSidebarWidth(clamped);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [parentRef, setRightSidebarWidth]);

  if (collapsed) {
    return <CollapsedSidebar onExpand={toggleRightSidebar} />;
  }

  return (
    <>
      <SidebarWidthHandle parentRef={parentRef} />
      <div
        ref={containerRef}
        className="flex flex-col bg-[var(--theme-bg-surface)] border-l border-white/[0.06] flex-shrink-0 overflow-hidden"
        style={{ width: `${width}px` }}
      >
        <div className="flex flex-col min-h-0 overflow-hidden" style={{ flexBasis: `${ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}>
          <SidebarTopPanel
            parentSessionId={parentSessionId}
            repoKeys={repoKeys}
            defaultRepoKey={defaultRepoKey}
          />
        </div>
        <SidebarSplitHandle containerRef={containerRef} />
        <div className="flex flex-col min-h-0 overflow-hidden flex-1">
          <SidebarBottomPanel
            parentSessionId={parentSessionId}
            ticketDisplayId={ticketDisplayId}
            cwd={cwd}
          />
        </div>
      </div>
    </>
  );
}

function CollapsedSidebar({ onExpand }: { onExpand: () => void }) {
  return (
    <div
      className="flex flex-col items-center border-l border-[var(--theme-border)] bg-[var(--theme-bg-surface)] flex-shrink-0"
      style={{ width: `${COLLAPSED_WIDTH}px` }}
    >
      <button
        type="button"
        onClick={onExpand}
        title="Expand sidebar"
        className="flex w-full items-center justify-center border-b border-[var(--theme-border)] py-2.5 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
          <line x1="10" y1="1.5" x2="10" y2="14.5" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onExpand}
        title="Scratchpads"
        className="flex w-full flex-col items-center justify-center gap-1 py-2.5 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v11a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13.5v-11z" />
          <path d="M5.5 5h5M5.5 7.5h5M5.5 10h3" strokeWidth="1" />
        </svg>
        <span className="max-w-full truncate text-[10px] font-medium leading-none tracking-tight text-[var(--theme-text-faint)]">
          Notes
        </span>
      </button>
      <button
        type="button"
        onClick={onExpand}
        title="Auxiliary terminals"
        className="flex w-full flex-col items-center justify-center gap-1 py-2.5 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
          <polyline points="4.5,6.5 7,9 4.5,11.5" />
          <line x1="9" y1="11.5" x2="11.5" y2="11.5" />
        </svg>
        <span className="max-w-full truncate text-[10px] font-medium leading-none tracking-tight text-[var(--theme-text-faint)]">
          Term
        </span>
      </button>
    </div>
  );
}

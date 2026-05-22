import { useRef } from 'react';
import { useUIStore } from '../../../stores/uiStore';
import { SidebarTopPanel } from './SidebarTopPanel';
import { SidebarBottomPanel } from './SidebarBottomPanel';
import { SidebarSplitHandle } from './SidebarSplitHandle';
import { SidebarWidthHandle } from './SidebarWidthHandle';

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
}

export function SessionRightSidebar({
  parentSessionId,
  ticketDisplayId,
  cwd,
  repoKeys,
  defaultRepoKey,
}: Props) {
  const width = useUIStore((s) => s.rightSidebarWidth);
  const ratio = useUIStore((s) => s.rightSidebarSplitRatio);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <SidebarWidthHandle />
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

/**
 * The right tool strip (60px): icon + label buttons that toggle the one-at-a-time
 * right tool window (JetBrains model — clicking the active tool closes it). Ships
 * Context, Diff, Code and Deliverables; Threads (Phase 3) is still absent. Diff
 * shows a dot when the branch has changes. The bottom Shell button toggles the
 * drawer rather than a right panel, so it lives outside the panel-toggling group.
 */
import { cn } from '../../../lib/cn';
import { useWorkStore, type RightPanel } from '../../../stores/workStore';
import type { WorkTask } from '../types';

interface Tool {
  key: Exclude<RightPanel, null>;
  label: string;
  icon: React.ReactNode;
}

const TOOLS: Tool[] = [
  {
    key: 'context',
    label: 'Context',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="14" y1="4" x2="14" y2="20" />
      </svg>
    ),
  },
  {
    key: 'diff',
    label: 'Diff',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="10" />
        <line x1="9.5" y1="7.5" x2="14.5" y2="7.5" />
        <line x1="9.5" y1="16.5" x2="14.5" y2="16.5" />
      </svg>
    ),
  },
  {
    key: 'code',
    label: 'Code',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m9 8-4 4 4 4" />
        <path d="m15 8 4 4-4 4" />
      </svg>
    ),
  },
  {
    key: 'deliv',
    label: 'Delivs',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <line x1="8" y1="8" x2="16" y2="8" />
        <line x1="8" y1="12" x2="16" y2="12" />
        <line x1="8" y1="16" x2="13" y2="16" />
      </svg>
    ),
  },
];

export function ToolStrip({ task, delivCount = 0 }: { task: WorkTask | null; delivCount?: number }) {
  const rightPanel = useWorkStore((s) => s.rightPanel);
  const toggleRightPanel = useWorkStore((s) => s.toggleRightPanel);
  const shellOpen = useWorkStore((s) => s.shellOpen);
  const shellMode = useWorkStore((s) => s.shellMode);
  const setShellOpen = useWorkStore((s) => s.setShellOpen);
  const codeMode = useWorkStore((s) => s.codeMode);
  const setCodeMode = useWorkStore((s) => s.setCodeMode);
  const shellActive = shellOpen || shellMode;

  return (
    <nav className="flex w-[60px] shrink-0 flex-col items-center gap-1 border-l border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-2">
      {TOOLS.map((tool) => {
        // Code is a center-takeover mode, not a right panel.
        const isCode = tool.key === 'code';
        const active = isCode ? codeMode : rightPanel === tool.key;
        const badge = tool.key === 'deliv' && delivCount > 0 ? (delivCount > 99 ? '99+' : String(delivCount)) : null;
        const dot = tool.key === 'diff' && (task?.changedLines ?? 0) > 0;
        return (
          <button
            key={tool.key}
            type="button"
            disabled={!task}
            onClick={() => (isCode ? setCodeMode(!codeMode) : toggleRightPanel(tool.key))}
            className={cn(
              'relative flex w-[52px] flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] transition-colors disabled:opacity-40',
              active
                ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]'
                : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
            )}
          >
            {badge && (
              <span className="absolute right-1.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--theme-accent)] px-1 text-[9px] font-semibold text-[var(--theme-accent-fg)]">
                {badge}
              </span>
            )}
            {dot && (
              <span className="absolute right-2 top-1 h-1.5 w-1.5 rounded-full bg-[var(--tint-yellow-solid)]" />
            )}
            {tool.icon}
            {tool.label}
          </button>
        );
      })}

      {/* Shell toggles the bottom drawer (⌘J), not a right panel — pinned bottom. */}
      <button
        type="button"
        disabled={!task}
        onClick={() => setShellOpen(!shellOpen)}
        title="Toggle shell drawer (⌘J)"
        className={cn(
          'mt-auto flex w-[52px] flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] transition-colors disabled:opacity-40',
          shellActive
            ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]'
            : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
        )}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="m7 9 3 3-3 3" />
          <line x1="13" y1="15" x2="17" y2="15" />
        </svg>
        Shell
      </button>
    </nav>
  );
}

/**
 * The always-visible center-mode switch for the Work view: Chat / Code / Shell /
 * Workflow. Lives in the top bar so switching modes is consistent. Chat = none of
 * the takeover flags; the takeover modes are mutually exclusive in the store.
 * Workflow only appears when the selected ticket actually has workflow runs
 * (mirrors the old ticket-detail "Workflow" tab). Rendered icon-only to stay
 * compact with four items; each item expands to show its label on hover.
 */
import { useWorkStore } from '../../stores/workStore';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';
import { cn } from '../../lib/cn';

type Mode = 'chat' | 'code' | 'shell' | 'workflow';

/** `ticketId` is the RESOLVED selected task (queue fallback included), not the raw
 * persisted selection — so the Workflow item shows even on a fallback selection. */
export function ModeSwitcher({ ticketId }: { ticketId: string | null }) {
  const codeMode = useWorkStore((s) => s.codeMode);
  const shellMode = useWorkStore((s) => s.shellMode);
  const workflowMode = useWorkStore((s) => s.workflowMode);
  const setCodeMode = useWorkStore((s) => s.setCodeMode);
  const setShellMode = useWorkStore((s) => s.setShellMode);
  const setWorkflowMode = useWorkStore((s) => s.setWorkflowMode);

  const hasWorkflowRuns = useWorkflowRunStore((s) =>
    ticketId ? (s.runsByTicket[ticketId]?.length ?? 0) > 0 : false,
  );

  // Workflow only counts as active while the ticket still has runs — switching to
  // a run-less ticket falls back to Chat without losing the flag.
  const active: Mode = codeMode
    ? 'code'
    : shellMode
      ? 'shell'
      : workflowMode && hasWorkflowRuns
        ? 'workflow'
        : 'chat';

  const select = (mode: Mode) => {
    if (mode === 'chat') {
      setCodeMode(false);
      setShellMode(false);
      setWorkflowMode(false);
    } else if (mode === 'code') {
      setCodeMode(true);
    } else if (mode === 'shell') {
      setShellMode(true);
    } else {
      setWorkflowMode(true);
    }
  };

  const items: { mode: Mode; label: string; title: string; icon: React.ReactNode }[] = [
    {
      mode: 'chat',
      label: 'Chat',
      title: 'Chat',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8l-3 2.5V11.5H2.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" />
        </svg>
      ),
    },
    {
      mode: 'code',
      label: 'Code',
      title: 'Code editor',
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 8-4 4 4 4" />
          <path d="m15 8 4 4-4 4" />
        </svg>
      ),
    },
    {
      mode: 'shell',
      label: 'Shell',
      title: 'Shell (⌘⇧J)',
      icon: <span className="font-mono text-[11px] leading-none">›_</span>,
    },
    // Only offered when the ticket has workflow runs — like the old detail tab.
    ...(hasWorkflowRuns
      ? [{
          mode: 'workflow' as Mode,
          label: 'Workflow',
          title: 'Workflow run view',
          icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3.5" width="6" height="6" rx="1.2" />
              <rect x="15" y="14.5" width="6" height="6" rx="1.2" />
              <path d="M9 6.5h3.5a2 2 0 0 1 2 2v7" />
            </svg>
          ),
        }]
      : []),
  ];

  return (
    // The whole switch is the hover group, so hovering any item unfurls ALL four
    // labels at once (icon-only at rest keeps it compact with four items).
    <div className="group/modes flex shrink-0 items-center gap-0.5 rounded-md border border-[var(--theme-border)] p-0.5">
      {items.map((it) => {
        const isActive = active === it.mode;
        return (
          <button
            key={it.mode}
            type="button"
            onClick={() => select(it.mode)}
            title={it.title}
            aria-label={it.label}
            className={cn(
              'flex cursor-pointer items-center rounded px-1.5 py-0.5 text-[11px] transition-colors',
              isActive
                ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]'
                : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
            )}
          >
            {it.icon}
            <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-150 group-hover/modes:ml-1 group-hover/modes:max-w-[72px] group-hover/modes:opacity-100">
              {it.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

import { cn } from '../../lib/cn';
import { isTerminalAlive, usePinnedActionsStore } from '../../stores/pinnedActionsStore';
import { Tooltip } from '../ui/Tooltip';
import { ICON_BTN } from './PinnedActionButton';

/**
 * The Terminals button of the Work top bar: where every terminal lives — the
 * action terminals and the free shells. A click (or ⌃`) shows or hides the
 * panel and never re-runs a command; with no terminal at all it opens a shell.
 * Its badge counts the terminals still running; a faint dot flags tabs whose
 * command ended but that are still open.
 */
export function TerminalsButton() {
  const terminals = usePinnedActionsStore((s) => s.terminals);
  const runs = usePinnedActionsStore((s) => s.runs);
  const minimized = usePinnedActionsStore((s) => s.terminalMinimized);
  const toggleTerminals = usePinnedActionsStore((s) => s.toggleTerminals);

  const running = terminals.filter((t) => isTerminalAlive(t, runs)).length;
  const finished = terminals.length - running;
  const visible = terminals.length > 0 && !minimized;
  const label = terminals.length === 0
    ? 'New terminal · ⌃`'
    : `Terminals — ${running} running${finished ? ` · ${finished} finished` : ''} · ⌃\``;

  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={visible}
        data-terminals-button
        onClick={() => void toggleTerminals()}
        className={cn(ICON_BTN, visible && 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)]')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--theme-text-secondary)]" aria-hidden>
          <path d="m4 17 6-6-6-6" /><path d="M12 19h8" />
        </svg>
        {running > 0 && (
          <span
            data-testid="terminals-badge"
            className="absolute -right-1 -top-1.5 rounded bg-[var(--theme-accent)] px-[3px] py-px text-[8px] font-semibold leading-none tabular-nums text-[var(--theme-bg-surface)] ring-1 ring-[var(--theme-bg-surface)]"
          >
            {running}
          </span>
        )}
        {finished > 0 && (
          <span
            data-testid="terminals-finished-dot"
            className="absolute -bottom-0.5 -right-0.5 h-[6px] w-[6px] rounded-full bg-[var(--theme-text-faint)] ring-2 ring-[var(--theme-bg-surface)]"
          />
        )}
      </button>
    </Tooltip>
  );
}

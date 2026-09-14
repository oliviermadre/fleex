/**
 * The single, always-visible Chat / Code / Shell switch for the Work center.
 * Lives in the top bar so switching modes is consistent (previously each surface
 * had its own differently-placed "Back to chat"). Chat = neither mode; the two
 * center-takeover modes are mutually exclusive in the store.
 */
import { useWorkStore } from '../../stores/workStore';
import { cn } from '../../lib/cn';

type Mode = 'chat' | 'code' | 'shell';

export function ModeSwitcher() {
  const codeMode = useWorkStore((s) => s.codeMode);
  const shellMode = useWorkStore((s) => s.shellMode);
  const setCodeMode = useWorkStore((s) => s.setCodeMode);
  const setShellMode = useWorkStore((s) => s.setShellMode);

  const active: Mode = codeMode ? 'code' : shellMode ? 'shell' : 'chat';

  const select = (mode: Mode) => {
    if (mode === 'chat') {
      setCodeMode(false);
      setShellMode(false);
    } else if (mode === 'code') {
      setCodeMode(true);
    } else {
      setShellMode(true);
    }
  };

  const items: { mode: Mode; label: string; icon: React.ReactNode; title: string }[] = [
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
  ];

  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-[var(--theme-border)] p-0.5">
      {items.map((it) => {
        const isActive = active === it.mode;
        return (
          <button
            key={it.mode}
            type="button"
            onClick={() => select(it.mode)}
            title={it.title}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors',
              isActive
                ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]'
                : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
            )}
          >
            {it.icon}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

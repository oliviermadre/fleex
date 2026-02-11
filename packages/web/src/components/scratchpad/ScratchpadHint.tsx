import { useUIStore } from '../../stores/uiStore';

export function ScratchpadHint() {
  const altHeld = useUIStore((s) => s.altHeld);
  const scratchpadOpen = useUIStore((s) => s.scratchpadOpen);
  const toggleScratchpad = useUIStore((s) => s.toggleScratchpad);

  if (!altHeld || scratchpadOpen) return null;

  return (
    <button
      className="scratchpad-hint"
      onClick={toggleScratchpad}
    >
      <svg className="w-3.5 h-3.5 text-[var(--theme-text-secondary)]" viewBox="0 0 16 16" fill="none">
        <path
          d="M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v11a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 13.5v-11z"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path d="M5.5 5h5M5.5 7.5h5M5.5 10h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
      <kbd className="text-[10px] font-mono font-semibold text-[var(--theme-text-primary)] leading-none">
        ⌥⇧P
      </kbd>
    </button>
  );
}

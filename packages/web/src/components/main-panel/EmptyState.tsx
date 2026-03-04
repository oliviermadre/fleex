import { useUIStore } from '../../stores/uiStore';
import { Button } from '../ui/Button';
import { HotkeyBadge } from '../ui/HotkeyBadge';

export function EmptyState() {
  const openCreateModal = useUIStore((s) => s.openCreateModal);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-[var(--theme-text-muted)]">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--theme-text-faint)]">
        <rect x="6" y="8" width="36" height="32" rx="4" />
        <line x1="6" y1="16" x2="42" y2="16" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        <circle cx="18" cy="12" r="1.5" fill="currentColor" />
        <circle cx="24" cy="12" r="1.5" fill="currentColor" />
        <line x1="14" y1="26" x2="20" y2="26" />
        <line x1="12" y1="32" x2="28" y2="32" />
      </svg>
      <p className="text-sm">Select a session or create a new one</p>
      <div className="relative">
        <Button variant="primary" size="sm" onClick={openCreateModal}>
          New Session
        </Button>
        <HotkeyBadge hotkey="⇧⌘N" position="top-right" />
      </div>
    </div>
  );
}

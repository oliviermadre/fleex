import { cn } from '../../lib/cn';
import { useConfirmStore } from '../../stores/confirmStore';
import { Modal } from './Modal';

/**
 * Global host that renders the confirmation modal driven by `useConfirmStore`.
 * Mount once near the app root; `useConfirm()` triggers it from anywhere.
 * Escape / backdrop click / Cancel all resolve the promise to `false`.
 */
export function ConfirmModalHost() {
  const request = useConfirmStore((s) => s.request);
  const handleConfirm = useConfirmStore((s) => s.handleConfirm);
  const handleCancel = useConfirmStore((s) => s.handleCancel);

  if (!request) return null;

  const {
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = true,
  } = request;

  return (
    <Modal open onClose={handleCancel} maxWidth="max-w-sm">
      <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">{title}</h3>
      {message != null && (
        <p className="mt-2 text-xs text-[var(--theme-text-secondary)]">{message}</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          className="rounded-md px-3 py-1.5 text-xs text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
          onClick={handleCancel}
        >
          {cancelLabel}
        </button>
        <button
          className={cn(
            'rounded-md px-3 py-1.5 text-xs text-white transition-colors',
            danger
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)]',
          )}
          onClick={handleConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

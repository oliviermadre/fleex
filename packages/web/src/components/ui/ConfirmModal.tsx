import { Button } from './Button';
import { Modal } from './Modal';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal open={open} onClose={onCancel} maxWidth="max-w-sm">
      <h2 className="text-sm font-semibold text-[var(--theme-text-primary)]">{title}</h2>
      <div className="mt-2 text-xs text-[var(--theme-text-secondary)]">{message}</div>
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          size="sm"
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

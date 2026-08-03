import { useState, useEffect } from 'react';

import { Button } from './Button';
import { Input } from './Input';
import { Modal } from './Modal';

interface NameInputModalProps {
  open: boolean;
  title: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (name: string) => void;
  onClose: () => void;
}

export function NameInputModal({
  open,
  title,
  placeholder,
  confirmLabel = 'Créer',
  onConfirm,
  onClose,
}: NameInputModalProps) {
  const [value, setValue] = useState('');

  // Reset value when modal opens
  useEffect(() => {
    if (open) setValue('');
  }, [open]);

  const trimmed = value.trim();
  const isValid = trimmed.length > 0;

  const handleConfirm = () => {
    if (!isValid) return;
    onConfirm(trimmed);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && isValid) {
      e.preventDefault();
      handleConfirm();
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-sm">
      <h2 className="mb-4 text-sm font-semibold text-[var(--theme-text-primary)]">{title}</h2>

      <Input
        autoFocus
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Annuler
        </Button>
        <Button variant="primary" size="sm" disabled={!isValid} onClick={handleConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

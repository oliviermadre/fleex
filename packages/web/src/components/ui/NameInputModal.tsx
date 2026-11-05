import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { Input } from './Input';
import { Button } from './Button';
import { EmojiInput } from './EmojiInput';
import { normalizeEmoji } from '../../lib/boardEmoji';

interface NameInputModalProps {
  open: boolean;
  title: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Pre-filled name (rename); blank by default. */
  defaultValue?: string;
  /** Show an emoji field left of the name, pre-filled with `defaultValue`. */
  emoji?: { defaultValue: string };
  /** `emoji` is the normalised emoji, or undefined when the field is absent or left blank. */
  onConfirm: (name: string, emoji?: string) => void;
  onClose: () => void;
}

export function NameInputModal({
  open,
  title,
  placeholder,
  confirmLabel = 'Créer',
  defaultValue = '',
  emoji,
  onConfirm,
  onClose,
}: NameInputModalProps) {
  const [value, setValue] = useState('');
  const [emojiValue, setEmojiValue] = useState('');
  const defaultEmoji = emoji?.defaultValue ?? '';

  // Reset values when modal opens
  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setEmojiValue(defaultEmoji);
    }
  }, [open, defaultEmoji, defaultValue]);

  const trimmed = value.trim();
  const isValid = trimmed.length > 0;

  const handleConfirm = () => {
    if (!isValid) return;
    onConfirm(trimmed, emoji ? normalizeEmoji(emojiValue) ?? undefined : undefined);
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
      <h2 className="mb-4 text-sm font-semibold text-[var(--theme-text-primary)]">
        {title}
      </h2>

      <div className="flex items-center gap-2">
        {emoji && (
          <EmojiInput value={emojiValue} onChange={setEmojiValue} onKeyDown={handleKeyDown} />
        )}
        <div className="min-w-0 flex-1">
          <Input
            autoFocus
            className="w-full"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Annuler
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!isValid}
          onClick={handleConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

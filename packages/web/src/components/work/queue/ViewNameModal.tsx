/**
 * Name (and optional emoji) of a saved view — to create one from the queue's
 * current filters, or to rename one. The name is checked as it's typed, once a
 * first submit has shown an error (empty, over 60 chars, already used).
 */
import { useEffect, useState } from 'react';
import { Modal } from '../../ui/Modal';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { EmojiInput } from '../../ui/EmojiInput';
import { normalizeEmoji } from '../../../lib/boardEmoji';
import { viewNameError, type SavedView } from '../../../stores/savedViewsStore';

interface Props {
  open: boolean;
  title: string;
  confirmLabel: string;
  /** Pre-filled values (rename); a new view starts blank. */
  initial?: { name: string; emoji: string | null };
  /** The view being renamed, so its own name isn't a duplicate. */
  exceptId?: string;
  views: readonly SavedView[];
  /** One line summing up what the view will hold (create only). */
  summary?: string;
  /** Resolves true when done (the modal closes), false to stay open. */
  onConfirm: (name: string, emoji: string | null) => Promise<boolean>;
  onClose: () => void;
}

export function ViewNameModal({ open, title, confirmLabel, initial, exceptId, views, summary, onConfirm, onClose }: Props) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setEmoji(initial?.emoji ?? '');
    setError(null);
    setBusy(false);
    // Reset on open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    const err = viewNameError(name, views, exceptId);
    setError(err);
    if (err || busy) return;
    setBusy(true);
    const ok = await onConfirm(name.trim(), normalizeEmoji(emoji));
    setBusy(false);
    if (ok) onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-sm">
      <h2 className="mb-4 text-sm font-semibold text-[var(--theme-text-primary)]">{title}</h2>
      <div className="flex items-center gap-2">
        <EmojiInput value={emoji} onChange={setEmoji} onKeyDown={onKeyDown} placeholder="▤" />
        <div className="min-w-0 flex-1">
          <Input
            autoFocus
            aria-label="View name"
            aria-invalid={!!error}
            className="w-full"
            placeholder="e.g. ODYS AI by priority"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(viewNameError(e.target.value, views, exceptId));
            }}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
      <div role="alert" className="mt-1.5 min-h-[16px] text-[11px] text-[var(--theme-danger)]">
        {error}
      </div>
      {summary && (
        <div className="mt-1 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-2.5 py-1.5 text-[11px] text-[var(--theme-text-secondary)]">
          {summary}
          <div className="mt-0.5 text-[var(--theme-text-faint)]">The search is never saved in a view.</div>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void submit()}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

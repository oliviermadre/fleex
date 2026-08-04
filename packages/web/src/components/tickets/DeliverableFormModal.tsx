import { useState, useRef, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import * as api from '../../services/api';
import { useToastStore } from '../../stores/toastStore';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';
import { tint } from '../../lib/tints';
import { MarkdownEditor } from '../markdown/MarkdownEditor';

interface DeliverableFormModalProps {
  open: boolean;
  onClose: () => void;
  ticketId: string;
}

export function DeliverableFormModal({ open, onClose, ticketId }: DeliverableFormModalProps) {
  const selectableTypes = useDeliverableTypesStore((s) => s.types).filter((t) => !t.system);
  const defaultType = selectableTypes.some((t) => t.id === 'report') ? 'report' : (selectableTypes[0]?.id ?? 'report');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<string>(defaultType);
  const [status, setStatus] = useState<'draft' | 'final'>('final');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  // Saving mid-upload persists the `![Uploading …](fleex-upload-…)` placeholder.
  const [uploading, setUploading] = useState(false);
  const [titleError, setTitleError] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resetForm = useCallback(() => {
    setTitle('');
    setType(defaultType);
    setStatus('final');
    setContent('');
    setTitleError('');
  }, [defaultType]);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) {
      setTitleError('Title is required');
      return;
    }
    setSaving(true);
    try {
      await api.createDeliverable(ticketId, {
        title: title.trim(),
        type,
        content,
        status,
        agentName: 'user',
      });
      useToastStore.getState().addToast('success', 'Deliverable created');
      handleClose();
    } catch {
      // error toast handled by api.ts
    } finally {
      setSaving(false);
    }
  }, [ticketId, title, type, content, status, handleClose]);

  return (
    <Modal open={open} onClose={handleClose} maxWidth="max-w-2xl">
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--theme-text-primary)]">
            Add deliverable
          </h2>
          <button
            onClick={handleClose}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-danger)]/15 hover:text-[var(--theme-danger)]"
          >
            &times;
          </button>
        </div>

        {/* Title */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--theme-text-secondary)]">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (titleError) setTitleError('');
            }}
            placeholder="Deliverable title"
            className={`rounded-md border px-3 py-2 text-sm bg-[var(--theme-bg-input)] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] outline-none transition-colors focus:border-[var(--theme-accent)] ${
              titleError ? 'border-[var(--theme-danger)]' : 'border-[var(--theme-border)]'
            }`}
            autoFocus
          />
          {titleError && (
            <span className="text-xs text-[var(--theme-danger)]">{titleError}</span>
          )}
        </div>

        {/* Type + Status row */}
        <div className="flex items-end gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-[var(--theme-text-secondary)]">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-input)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none transition-colors focus:border-[var(--theme-accent)]"
            >
              {selectableTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--theme-text-secondary)]">Status</label>
            <button
              type="button"
              onClick={() => setStatus((s) => (s === 'draft' ? 'final' : 'draft'))}
              className={`rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                status === 'draft'
                  ? tint('yellow')
                  : tint('green')
              }`}
            >
              {status === 'draft' ? 'Draft' : 'Final'}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--theme-text-secondary)]">Content</label>
          <div className="flex h-80">
            <MarkdownEditor
              surfaceKind="deliverable_content"
              defaultMode="split"
              profile="doc"
              value={content}
              onChange={setContent}
              textareaRef={textareaRef}
              enableFileUpload
              onUploadingChange={setUploading}
              placeholder="Markdown content, URL, or HTML..."
            />
          </div>
          <span className="text-[10px] text-[var(--theme-text-faint)]">
            Supports Markdown, file upload (drag & drop or paste), and raw HTML
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={handleClose}
            className="rounded-md border border-[var(--theme-border)] px-4 py-1.5 text-xs font-medium text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || uploading}
            className="rounded-md bg-[var(--theme-accent)] px-4 py-1.5 text-xs font-medium text-[var(--theme-accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save deliverable'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

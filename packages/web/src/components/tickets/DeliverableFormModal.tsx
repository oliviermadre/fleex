import { useState, useRef, useCallback, useEffect } from 'react';
import type { TicketDeliverable } from '@fleex/shared';
import { Modal } from '../ui/Modal';
import { useFileUpload } from '../../hooks/useFileUpload';
import * as api from '../../services/api';
import { useToastStore } from '../../stores/toastStore';

const DELIVERABLE_TYPES = [
  { value: 'prd', label: 'PRD' },
  { value: 'spec', label: 'SPEC' },
  { value: 'plan', label: 'PLAN' },
  { value: 'code', label: 'CODE' },
  { value: 'report', label: 'REPORT' },
  { value: 'url', label: 'URL' },
  { value: 'html', label: 'HTML' },
] as const;

interface DeliverableFormModalProps {
  open: boolean;
  onClose: () => void;
  ticketId: string;
  /** When provided, the modal edits this deliverable instead of creating one. */
  deliverable?: TicketDeliverable | null;
}

export function DeliverableFormModal({ open, onClose, ticketId, deliverable }: DeliverableFormModalProps) {
  const isEditing = !!deliverable;
  const [title, setTitle] = useState('');
  const [type, setType] = useState<string>('report');
  const [status, setStatus] = useState<'draft' | 'final'>('final');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [titleError, setTitleError] = useState('');

  // Sync form state with the target deliverable whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setTitle(deliverable?.title ?? '');
    setType(deliverable?.type ?? 'report');
    setStatus(deliverable?.status ?? 'final');
    setContent(deliverable?.content ?? '');
    setTitleError('');
  }, [open, deliverable]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { isUploading, isDragOver, pasteHandler, dragProps, openFilePicker } = useFileUpload({
    textareaRef,
    value: content,
    onChange: setContent,
  });

  const resetForm = useCallback(() => {
    setTitle('');
    setType('report');
    setStatus('final');
    setContent('');
    setTitleError('');
  }, []);

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
      if (isEditing && deliverable) {
        await api.updateDeliverable(ticketId, deliverable.id, {
          title: title.trim(),
          content,
          status,
        });
        useToastStore.getState().addToast('success', 'Deliverable updated');
      } else {
        await api.createDeliverable(ticketId, {
          title: title.trim(),
          type,
          content,
          status,
          agentName: 'user',
        });
        useToastStore.getState().addToast('success', 'Deliverable created');
      }
      handleClose();
    } catch {
      // error toast handled by api.ts
    } finally {
      setSaving(false);
    }
  }, [ticketId, title, type, content, status, handleClose, isEditing, deliverable]);

  return (
    <Modal open={open} onClose={handleClose} maxWidth="max-w-2xl">
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--theme-text-primary)]">
            {isEditing ? 'Edit deliverable' : 'Add deliverable'}
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
              disabled={isEditing}
              title={isEditing ? 'Type cannot be changed after creation' : undefined}
              className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-input)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none transition-colors focus:border-[var(--theme-accent)] disabled:opacity-60"
            >
              {DELIVERABLE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
              {isEditing && !DELIVERABLE_TYPES.some((t) => t.value === type) && (
                <option value={type}>{type.toUpperCase()}</option>
              )}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--theme-text-secondary)]">Status</label>
            <button
              type="button"
              onClick={() => setStatus((s) => (s === 'draft' ? 'final' : 'draft'))}
              className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                status === 'draft'
                  ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              }`}
            >
              {status === 'draft' ? 'Draft' : 'Final'}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--theme-text-secondary)]">Content</label>
            <button
              type="button"
              onClick={openFilePicker}
              className="text-[10px] text-[var(--theme-text-faint)] transition-colors hover:text-[var(--theme-text-secondary)]"
            >
              {isUploading ? 'Uploading...' : 'Attach file'}
            </button>
          </div>
          <div
            {...dragProps}
            className={`relative rounded-md border transition-colors ${
              isDragOver ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)]/5' : 'border-[var(--theme-border)]'
            }`}
          >
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onPaste={pasteHandler}
              placeholder="Markdown content, URL, or HTML..."
              rows={12}
              className="w-full resize-y rounded-md bg-[var(--theme-bg-input)] px-3 py-2 text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] outline-none"
            />
            {isDragOver && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-[var(--theme-accent)]/10">
                <span className="text-sm font-medium text-[var(--theme-accent)]">Drop file here</span>
              </div>
            )}
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
            disabled={saving || isUploading}
            className="rounded-md bg-[var(--theme-accent)] px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : isEditing ? 'Save changes' : 'Save deliverable'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

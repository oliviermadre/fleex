/**
 * The ticket description as the opening block of the Work stream. Read-only by
 * default; when `editable`, an Edit button (on hover / focus) or a double-click
 * swaps the render for the markdown editor with explicit Save / Cancel — unlike
 * the ticket detail's autosave, the stream is a reading surface, so nothing is
 * persisted until the user says so. Save goes through `ticketStore.updateTicket`
 * (logs activity, refreshes every view). The draft is local: a `ticket:updated`
 * arriving mid-edit only refreshes the read view once the editor closes, and
 * switching task drops it (the parent keys this block by ticket).
 */
import { useRef, useState } from 'react';
import { useTicketStore } from '../../../stores/ticketStore';
import { MarkdownEditor } from '../../markdown/MarkdownEditor';
import { MentionMenu } from '../../markdown/MentionMenu';
import { useAllMentionOptions } from '../../markdown/useAllMentionOptions';
import { useMentionAutocomplete } from '../../markdown/useMentionAutocomplete';
import { MessageMarkdown } from './MessageMarkdown';

interface Props {
  ticketId: string;
  description: string | null;
  editable?: boolean;
}

const DocIcon = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 2h5l3 3v9H4z" />
    <path d="M9 2v3h3" />
    <line x1="6" y1="8.5" x2="10" y2="8.5" />
    <line x1="6" y1="11" x2="9" y2="11" />
  </svg>
);

export function DescriptionBlock({ ticketId, description, editable = false }: Props) {
  const current = description ?? '';
  const isEmpty = current.trim().length === 0;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const mentionOptions = useAllMentionOptions();
  const mentionAc = useMentionAutocomplete({ options: mentionOptions, value: draft, onChange: setDraft, textareaRef });

  const startEdit = () => {
    setDraft(current);
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    if (saving) return;
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    if (saving || uploading) return;
    if (draft === current) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await useTicketStore.getState().updateTicket(ticketId, { description: draft });
      setEditing(false);
    } catch {
      setError("Couldn't save description");
    } finally {
      setSaving(false);
    }
  };

  if (!editing && isEmpty) {
    if (!editable) return null;
    return (
      <button
        type="button"
        onClick={startEdit}
        className="rounded-lg border border-dashed border-[var(--theme-border)] px-3 py-2.5 text-left text-[12px] text-[var(--theme-text-faint)] transition-colors hover:border-[var(--theme-border-input)] hover:text-[var(--theme-text-secondary)]"
      >
        + Add a description
      </button>
    );
  }

  return (
    <div
      className="group/desc overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2.5"
      onDoubleClick={editable && !editing ? startEdit : undefined}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-[var(--theme-text-muted)]">
        <DocIcon />
        DESCRIPTION
        {editable && !editing && (
          <button
            type="button"
            onClick={startEdit}
            title="Edit description"
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium tracking-normal text-[var(--theme-text-faint)] opacity-0 transition-opacity hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)] focus-visible:opacity-100 group-hover/desc:opacity-100"
          >
            ✎ Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <div className="flex h-[280px] min-h-0">
            <MarkdownEditor
              surfaceKind="ticket_description"
              defaultMode="write"
              value={draft}
              onChange={setDraft}
              textareaRef={textareaRef}
              enableFileUpload
              onUploadingChange={setUploading}
              placeholder="Add a description (markdown supported)..."
              textareaProps={{
                autoFocus: true,
                onChange: mentionAc.onScan,
                onKeyDown: (e) => {
                  mentionAc.onKeyDown(e);
                  if (e.defaultPrevented) return;
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void save();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancel();
                  }
                },
                onBlur: () => {
                  setTimeout(mentionAc.close, 150);
                },
              }}
              overlay={
                mentionAc.open && mentionAc.filtered.length > 0 ? (
                  <MentionMenu
                    options={mentionAc.filtered}
                    selectedIndex={mentionAc.index}
                    onSelect={mentionAc.accept}
                    position={{ bottom: 8, left: 8 }}
                  />
                ) : null
              }
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            {error && <span className="mr-auto text-[11px] text-[var(--theme-danger)]">{error}</span>}
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="rounded-md px-2.5 py-1 text-[12px] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || uploading}
              title="Save (⌘↵)"
              className="flex items-center gap-1.5 rounded-md bg-[var(--theme-accent)] px-2.5 py-1 text-[12px] font-medium text-[var(--theme-accent-fg)] hover:opacity-90 disabled:opacity-50"
            >
              {saving && (
                <span
                  aria-hidden
                  className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              )}
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="min-w-0 text-[13px] text-[var(--theme-text-primary)]">
          <MessageMarkdown body={current} />
        </div>
      )}
    </div>
  );
}

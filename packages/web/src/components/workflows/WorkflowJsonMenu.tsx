import { useRef, useState } from 'react';
import type { WorkflowDocument } from '@fleex/shared';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { toast } from '../../lib/toast';
import { WorkflowImportModal } from './WorkflowImportModal';
import { serializeWorkflowDocument, workflowJsonFileName } from './workflowJson';

interface Props {
  /** The document for what the editor shows right now (unsaved edits included). */
  getDocument: () => WorkflowDocument;
  editorSlug: string;
  onImport: (doc: WorkflowDocument) => void;
}

/** `{ } JSON ▾` in the workflow editor header: copy / download / import. */
export function WorkflowJsonMenu({ getDocument, editorSlug, onImport }: Props) {
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({ placement: 'bottom-end' });
  const [importText, setImportText] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = (action: () => void) => () => { setOpen(false); action(); };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serializeWorkflowDocument(getDocument()));
      toast.success('Workflow JSON copied');
    } catch (err) {
      console.warn('[workflow-json] clipboard write failed', err);
      toast.error('Clipboard unavailable — use Download instead');
    }
  };

  const download = () => {
    const doc = getDocument();
    const url = URL.createObjectURL(new Blob([serializeWorkflowDocument(doc)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = workflowJsonFileName(doc.slug);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const itemClass = 'flex w-full items-center px-3 py-1.5 text-left text-xs text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-hover)]';
  const sectionClass = 'px-3 pb-0.5 pt-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-faint)]';

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        type="button"
        className="text-xs px-3 py-1 rounded border font-mono"
        style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
        title="Import or export this workflow as JSON"
      >{'{ } JSON ▾'}</button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-[200px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          >
            <div className={sectionClass}>Export</div>
            <button type="button" role="menuitem" className={itemClass} onClick={run(() => void copy())}>Copy to clipboard</button>
            <button type="button" role="menuitem" className={itemClass} onClick={run(download)}>Download .json</button>
            <div className="my-1 border-t border-[var(--theme-border)]" />
            <div className={sectionClass}>Import</div>
            <button type="button" role="menuitem" className={itemClass} onClick={run(() => fileRef.current?.click())}>Import from file…</button>
            <button type="button" role="menuitem" className={itemClass} onClick={run(() => setImportText(''))}>Paste JSON…</button>
          </div>
        </FloatingPortal>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        data-testid="menu-file-input"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) setImportText(await file.text());
        }}
      />

      <WorkflowImportModal
        open={importText !== null}
        initialText={importText ?? ''}
        editorSlug={editorSlug}
        onClose={() => setImportText(null)}
        onReplace={(doc) => { setImportText(null); onImport(doc); }}
      />
    </>
  );
}

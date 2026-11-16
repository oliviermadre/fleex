import { useEffect, useRef, useState } from 'react';
import type { ShapeIssue, Violation, WorkflowDocument } from '@fleex/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { applyWorkflowDryRun } from '../../services/api';
import { cn } from '../../lib/cn';
import { parseWorkflowJson } from './workflowJson';

export const IMPORT_VALIDATION_DEBOUNCE_MS = 300;

interface Props {
  open: boolean;
  /** Text to start from (the content of a file picked from the menu). */
  initialText: string;
  /** The editor's slug: kept on import, and the slug the dry-run checks against. */
  editorSlug: string;
  onClose: () => void;
  onReplace: (doc: WorkflowDocument) => void;
}

type Check =
  | { stage: 'empty' }
  | { stage: 'invalid_json'; message: string }
  | { stage: 'invalid_shape'; issues: ShapeIssue[] }
  | { stage: 'checking'; doc: WorkflowDocument }
  | { stage: 'checked'; doc: WorkflowDocument; errors: Violation[]; warnings: Violation[] }
  | { stage: 'unchecked'; doc: WorkflowDocument };

/** Steps 1 and 2 block; step 3 (the workspace's references) only informs. */
function localCheck(text: string): Check {
  if (!text.trim()) return { stage: 'empty' };
  const parsed = parseWorkflowJson(text);
  if (parsed.ok) return { stage: 'checking', doc: parsed.doc };
  if (parsed.parseError !== null) return { stage: 'invalid_json', message: parsed.parseError };
  return { stage: 'invalid_shape', issues: parsed.shapeIssues };
}

export function WorkflowImportModal({ open, initialText, editorSlug, onClose, onReplace }: Props) {
  const [text, setText] = useState(initialText);
  // Each result remembers the text it was computed for: during the debounce
  // window (or after a reopen) a result for older text must not be importable.
  const [result, setResult] = useState<{ text: string; check: Check }>({ text: '', check: { stage: 'empty' } });
  const check = result.check;
  const [clipboardDenied, setClipboardDenied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setText(initialText); setClipboardDenied(false); }
  }, [open, initialText]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const local = localCheck(text);
      setResult({ text, check: local });
      if (local.stage !== 'checking') return;
      // The editor keeps its slug, so references are checked as if the
      // document already lived under it (no false SLUG_TAKEN).
      applyWorkflowDryRun({ ...local.doc, slug: editorSlug })
        .then(({ errors, warnings }) => { if (!cancelled) setResult({ text, check: { stage: 'checked', doc: local.doc, errors, warnings } }); })
        .catch((err) => {
          console.warn('[workflow-json] dry-run failed', err);
          if (!cancelled) setResult({ text, check: { stage: 'unchecked', doc: local.doc } });
        });
    }, IMPORT_VALIDATION_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, text, editorSlug]);

  const pasteFromClipboard = async () => {
    try {
      setText(await navigator.clipboard.readText());
      setClipboardDenied(false);
    } catch {
      setClipboardDenied(true);
    }
  };

  const loadFile = async (file: File | undefined) => {
    if (file) setText(await file.text());
  };

  const doc = result.text === text && (check.stage === 'checked' || check.stage === 'unchecked') ? check.doc : null;
  const referenceIssues = check.stage === 'checked' ? [...check.errors, ...check.warnings] : [];
  const anyway = check.stage === 'unchecked' || referenceIssues.length > 0;
  const slugIgnored = doc && doc.slug !== editorSlug ? doc.slug : null;

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3 text-[var(--theme-text-primary)]">
        <div>
          <h2 className="text-base font-semibold">Import workflow JSON</h2>
          <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
            Same format as <code>fleex workflow apply</code> / <code>show --json</code>. Paste with ⌘V, choose a file or drop a .json here.
          </p>
        </div>

        <textarea
          aria-label="Workflow JSON"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void loadFile(e.dataTransfer.files[0]); }}
          spellCheck={false}
          placeholder='{ "slug": "…", "name": "…", "entryStepId": "…", "steps": [ … ], "edges": [ … ] }'
          className="h-60 w-full resize-y rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-2 font-mono text-xs focus:border-[var(--theme-accent)] focus:outline-none"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={pasteFromClipboard}>Paste from clipboard</Button>
          <Button size="sm" onClick={() => fileRef.current?.click()}>Choose file…</Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            data-testid="import-file-input"
            onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ''; }}
          />
          {clipboardDenied && (
            <span className="text-xs text-[var(--theme-warning)]">Clipboard access denied — paste with ⌘V</span>
          )}
        </div>

        <CheckReport check={check} slugIgnored={slugIgnored} editorSlug={editorSlug} />

        <p className="text-xs text-[var(--theme-text-muted)]">
          This replaces the current editor content. <strong className="text-[var(--theme-text-primary)]">Nothing is saved until you click Save Workflow.</strong>
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!doc} onClick={() => doc && onReplace(doc)}>
            {anyway ? 'Replace editor anyway' : 'Replace editor'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CheckReport({ check, slugIgnored, editorSlug }: { check: Check; slugIgnored: string | null; editorSlug: string }) {
  if (check.stage === 'empty') return null;
  const rows: { tone: 'error' | 'warning' | 'info'; path: string; message: string }[] = [];
  if (slugIgnored) rows.push({ tone: 'info', path: '$.slug', message: `Slug "${slugIgnored}" from file ignored — keeping "${editorSlug}"` });
  if (check.stage === 'invalid_json') rows.push({ tone: 'error', path: '—', message: `Invalid JSON: ${check.message}` });
  if (check.stage === 'invalid_shape') check.issues.forEach((i) => rows.push({ tone: 'error', path: i.path, message: i.message }));
  if (check.stage === 'unchecked') rows.push({ tone: 'warning', path: '—', message: 'Could not check references against this workspace' });
  if (check.stage === 'checked') {
    [...check.errors, ...check.warnings].forEach((v) => rows.push({ tone: 'warning', path: v.path, message: v.message }));
  }

  const summary =
    check.stage === 'invalid_json' ? 'Invalid JSON'
    : check.stage === 'invalid_shape' ? `${check.issues.length} shape error${check.issues.length > 1 ? 's' : ''} — fix the document to import it`
    : check.stage === 'checking' ? 'Checking references against this workspace…'
    : check.stage === 'unchecked' ? 'References not checked — you can still import'
    : rows.some((r) => r.tone === 'warning') ? 'Importable — fix the flagged references in the editor before saving'
    : 'Ready to import';

  return (
    <div className="rounded-md border border-[var(--theme-border)]" data-testid="import-check">
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        {check.stage === 'checking' && <Spinner size={10} />}
        <span className={cn(
          (check.stage === 'invalid_json' || check.stage === 'invalid_shape') && 'text-[var(--theme-danger)]',
          check.stage === 'checked' && rows.every((r) => r.tone === 'info') && 'text-[var(--theme-success)]',
        )}>{summary}</span>
      </div>
      {rows.length > 0 && (
        <ul className="max-h-40 overflow-y-auto border-t border-[var(--theme-border)] text-xs">
          {rows.map((r, i) => (
            <li key={i} className="grid grid-cols-[1rem_10rem_1fr] items-baseline gap-2 px-3 py-1.5">
              <span className={cn(
                r.tone === 'error' && 'text-[var(--theme-danger)]',
                r.tone === 'warning' && 'text-[var(--theme-warning)]',
                r.tone === 'info' && 'text-[var(--theme-text-muted)]',
              )}>{r.tone === 'error' ? '✖' : r.tone === 'warning' ? '⚠' : 'ℹ'}</span>
              <code className="truncate text-[var(--theme-text-secondary)]" title={r.path}>{r.path}</code>
              <span>{r.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

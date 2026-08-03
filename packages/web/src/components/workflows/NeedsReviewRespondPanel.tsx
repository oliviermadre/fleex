import { useState } from 'react';

import { useDraft } from '../../hooks/useDraft';
import { tintClasses } from '../../lib/tints';
import { LazyMarkdown } from '../markdown/LazyMarkdown';
import { Button } from '../ui/Button';

interface Props {
  runId: string;
  stepRunId: string;
  // The agent's question / status comment (output.comment from the step run).
  // Treated as markdown — the comment field is contractually `string | null`
  // but agents conventionally emit markdown (bold, lists, inline `code`,
  // @mentions), and ticket comments are rendered with react-markdown
  // elsewhere in the app. Plain text passes through unchanged.
  question: string | null | undefined;
  // Posts the response as a ticket comment, then retries the step so the agent
  // re-runs with the comment now in its ticket context.
  onSubmit: (response: string) => Promise<void>;
}

export function NeedsReviewRespondPanel({ runId, stepRunId, question, onSubmit }: Props) {
  const {
    draft: response,
    setDraft: setResponse,
    clearDraft,
  } = useDraft(`needs_review_response_${runId}_${stepRunId}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = response.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      // Only clear the in-progress response once it is successfully posted —
      // on failure we keep it so the user doesn't lose their text.
      clearDraft();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`space-y-3 rounded-md border ${tintClasses('yellow').borderColor} ${tintClasses('yellow').bg} p-3`}
    >
      <div>
        <div
          className={`text-xs font-medium uppercase tracking-wide ${tintClasses('yellow').text}`}
        >
          Waiting for your input
        </div>
        {question && (
          <div className="needs-review-markdown mt-2 max-h-[460px] overflow-y-auto pr-1 text-xs text-[var(--theme-text-primary)]">
            <LazyMarkdown content={question} preset="basic" />
          </div>
        )}
      </div>
      <textarea
        placeholder="Your response — will be posted as a ticket comment, then the step retries."
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        rows={4}
        disabled={busy}
        className="w-full resize-y rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-2 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] outline-none focus:border-[var(--theme-accent)] focus:ring-1 focus:ring-[var(--theme-accent)] disabled:opacity-50"
      />
      {error && <div className="text-xs text-[var(--theme-danger)]">{error}</div>}
      <div className="flex justify-end">
        <Button variant="primary" size="sm" disabled={busy || !response.trim()} onClick={submit}>
          {busy ? 'Sending…' : 'Send & retry'}
        </Button>
      </div>
    </div>
  );
}

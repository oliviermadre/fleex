import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Button } from '../ui/Button';

interface Props {
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

export function NeedsReviewRespondPanel({ question, onSubmit }: Props) {
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = response.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      setResponse('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-amber-400">
          Waiting for your input
        </div>
        {question && (
          <div className="needs-review-markdown mt-2 max-h-[460px] overflow-y-auto pr-1 text-xs text-[var(--theme-text-primary)]">
            <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {question}
            </Markdown>
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
      {error && <div className="text-xs text-red-400">{error}</div>}
      <div className="flex justify-end">
        <Button variant="primary" size="sm" disabled={busy || !response.trim()} onClick={submit}>
          {busy ? 'Sending…' : 'Send & retry'}
        </Button>
      </div>
    </div>
  );
}

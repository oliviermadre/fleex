import { useState } from 'react';

import { cn } from '../../lib/cn';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';

interface CreateWorkflowModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateWorkflowModal({ open, onClose }: CreateWorkflowModalProps) {
  const create = useWorkflowTemplateStore((s) => s.create);
  const selectWorkflow = useWorkflowTemplateStore((s) => s.selectWorkflow);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [emoji, setEmoji] = useState('🔧');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleCreate = async () => {
    if (!name.trim() || !slug.trim()) {
      setError('Name and slug are required');
      return;
    }
    if (!/^[a-z0-9_-]+$/.test(slug)) {
      setError('Slug must contain only lowercase letters, numbers, hyphens, and underscores');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const entryId = `s-${Date.now()}`;
      const t = await create({
        name: name.trim(),
        slug: slug.trim(),
        emoji,
        description: description.trim(),
        steps: [
          {
            id: entryId,
            name: 'Entry Step',
            executorType: 'agent',
            executorRef: '',
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
        entryStepId: entryId,
        enabled: true,
      });
      selectWorkflow(t.id);
      onClose();
      setName('');
      setSlug('');
      setEmoji('🔧');
      setDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workflow');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[var(--theme-text-primary)]">New Workflow</h2>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Feature Delivery"
              className="w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
              Slug <span className="text-[var(--theme-text-faint)]">(used as @workflow:slug)</span>
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}
              placeholder="feature-delivery"
              className="w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 font-mono text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
              Emoji
            </label>
            <input
              type="text"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              className="w-20 rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-center text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
              Description <span className="text-[var(--theme-text-faint)]">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Automates the end-to-end feature delivery process…"
              rows={3}
              className="w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)] resize-none"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-[var(--theme-danger)]">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)]"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={busy || !name.trim() || !slug.trim()}
            className={cn(
              'rounded bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-[var(--theme-accent-fg)] transition-colors hover:bg-[var(--theme-accent-hover)]',
              (busy || !name.trim() || !slug.trim()) && 'opacity-50 cursor-not-allowed',
            )}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

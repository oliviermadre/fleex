import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePanelStore } from '../../stores/panelStore';
import { cn } from '../../lib/cn';

interface CreatePanelModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreatePanelModal({ open, onClose }: CreatePanelModalProps) {
  const navigate = useNavigate();
  const createPanel = usePanelStore((s) => s.createPanel);
  const selectPanel = usePanelStore((s) => s.selectPanel);
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (!open) return null;

  const handleCreate = async () => {
    if (!name.trim() || !displayName.trim()) {
      setError('Name and display name are required');
      return;
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
      setError('Name must be lowercase alphanumeric with hyphens/underscores');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const panel = await createPanel({
        name: name.trim(),
        displayName: displayName.trim(),
        description: description.trim(),
        members: [],
        orchestratorModel: 'claude-sonnet-5',
        defaultMemberModel: 'claude-sonnet-5',
        orchestratorPrompt: '',
        enabled: true,
      });
      selectPanel(panel.id);
      navigate(`/agents/panel/${panel.id}`, { replace: true });
      onClose();
      setName('');
      setDisplayName('');
      setDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create panel');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[var(--theme-text-primary)]">Create Panel</h2>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
              Name (slug)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
              placeholder="archi-committee"
              className="w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
              autoFocus
            />
            <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
              Used in <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">@panel:{name || 'name'}</code> mentions
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Architecture Committee"
              className="w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
              Description (optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Multi-expert architectural review panel"
              className="w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 text-xs text-[var(--theme-danger)]">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)]"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className={cn(
              'rounded bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-[var(--theme-accent-fg)] transition-colors hover:bg-[var(--theme-accent-hover)]',
              creating && 'opacity-50',
            )}
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

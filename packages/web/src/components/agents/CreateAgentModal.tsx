import { useState } from 'react';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { ModelSelect } from './ModelSelect';
import { cn } from '../../lib/cn';

interface CreateAgentModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateAgentModal({ open, onClose }: CreateAgentModalProps) {
  const createPersona = useAgentPersonaStore((s) => s.createPersona);
  const selectPersona = useAgentPersonaStore((s) => s.selectPersona);
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [model, setModel] = useState('claude-sonnet-5');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (!open) return null;

  const handleCreate = async () => {
    if (!name.trim() || !displayName.trim()) {
      setError('Name and display name are required');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      setError('Name must contain only letters, numbers, hyphens, and underscores');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const persona = await createPersona({ name: name.trim(), displayName: displayName.trim(), model });
      selectPersona(persona.id);
      onClose();
      setName('');
      setDisplayName('');
      setModel('claude-sonnet-5');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent');
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
        <h2 className="text-lg font-semibold text-[var(--theme-text-primary)]">Create Agent Persona</h2>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
              Slug Name (for @agent:name mentions)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
              placeholder="my-agent"
              className="w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="My Agent"
              className="w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
              Model
            </label>
            <ModelSelect value={model} onChange={setModel} ariaLabel="Model" />
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

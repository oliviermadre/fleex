import { useState } from 'react';
import { useSkillStore } from '../../stores/skillStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { cn } from '../../lib/cn';

interface CreateSkillModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateSkillModal({ open, onClose }: CreateSkillModalProps) {
  const createSkill = useSkillStore((s) => s.createSkill);
  const selectSkill = useSkillStore((s) => s.selectSkill);
  const personas = useAgentPersonaStore((s) => s.personas);
  const [commandName, setCommandName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [personaId, setPersonaId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (!open) return null;

  const handleCreate = async () => {
    if (!commandName.trim() || !displayName.trim()) {
      setError('Command name and display name are required');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(commandName)) {
      setError('Command name must contain only letters, numbers, hyphens, and underscores');
      return;
    }
    if (!personaId) {
      setError('Please select an agent persona');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const skill = await createSkill({
        commandName: commandName.trim(),
        name: commandName.trim(),
        displayName: displayName.trim(),
        markdownContent: '',
        personaId,
      });
      selectSkill(skill.id);
      onClose();
      setCommandName('');
      setDisplayName('');
      setPersonaId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create skill');
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
        <h2 className="text-lg font-semibold text-[var(--theme-text-primary)]">Create Skill</h2>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
              Command Name (unique slug)
            </label>
            <input
              type="text"
              value={commandName}
              onChange={(e) => setCommandName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
              placeholder="pr-review"
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
              placeholder="PR Review"
              className="w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
              Agent Persona
            </label>
            <select
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              className="w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
            >
              <option value="">Select a persona...</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
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
              'rounded bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--theme-accent-hover)]',
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

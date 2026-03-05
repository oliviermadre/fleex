import { useState, useCallback, useEffect } from 'react';
import type { AgentPersona } from '@fleex/shared';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';

interface AgentConfigTabProps {
  persona: AgentPersona;
}

export function AgentConfigTab({ persona }: AgentConfigTabProps) {
  const updatePersona = useAgentPersonaStore((s) => s.updatePersona);

  const [name, setName] = useState(persona.name);
  const [displayName, setDisplayName] = useState(persona.displayName);
  const [model, setModel] = useState(persona.model);
  const [humanMentionName, setHumanMentionName] = useState(persona.humanMentionName ?? '');

  useEffect(() => {
    setName(persona.name);
    setDisplayName(persona.displayName);
    setModel(persona.model);
    setHumanMentionName(persona.humanMentionName ?? '');
  }, [persona]);

  const save = useCallback(
    async (changes: Record<string, unknown>) => {
      try {
        await updatePersona(persona.id, changes);
      } catch (err) {
        console.error('Failed to save persona config:', err);
      }
    },
    [persona.id, updatePersona],
  );

  return (
    <div className="flex flex-col gap-5 overflow-y-auto p-6">
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
          Slug Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
          onBlur={() => {
            if (name !== persona.name && name.trim()) {
              save({ name });
            }
          }}
          className="w-full max-w-sm rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
        />
        <p className="mt-1 text-xs text-[var(--theme-text-faint)]">
          Used for @agent:{name} mentions in comments
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
          onBlur={() => {
            if (displayName !== persona.displayName && displayName.trim()) {
              save({ displayName });
            }
          }}
          className="w-full max-w-sm rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
          Model
        </label>
        <select
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            save({ model: e.target.value });
          }}
          className="w-full max-w-sm rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
        >
          <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
          <option value="claude-opus-4-6">Claude Opus 4.6</option>
          <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
          Human Mention Name Override
        </label>
        <input
          type="text"
          value={humanMentionName}
          onChange={(e) => setHumanMentionName(e.target.value)}
          onBlur={() => {
            const val = humanMentionName.trim() || null;
            if (val !== persona.humanMentionName) {
              save({ humanMentionName: val });
            }
          }}
          placeholder="Leave empty to use global setting"
          className="w-full max-w-sm rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
        />
        <p className="mt-1 text-xs text-[var(--theme-text-faint)]">
          Per-agent override for human @mention names (null uses global config)
        </p>
      </div>
    </div>
  );
}

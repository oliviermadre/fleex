import { useState, useCallback, useEffect } from 'react';

import type { AgentPersona, ExecutionMode } from '@fleex/shared';

import { useAgentPersonaStore } from '../../stores/agentPersonaStore';

import { ModelSelect } from './ModelSelect';

interface AgentConfigTabProps {
  persona: AgentPersona;
}

export function AgentConfigTab({ persona }: AgentConfigTabProps) {
  const updatePersona = useAgentPersonaStore((s) => s.updatePersona);

  const [name, setName] = useState(persona.name);
  const [displayName, setDisplayName] = useState(persona.displayName);
  const [model, setModel] = useState(persona.model);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(persona.executionMode);
  const [humanMentionName, setHumanMentionName] = useState(persona.humanMentionName ?? '');

  useEffect(() => {
    setName(persona.name);
    setDisplayName(persona.displayName);
    setModel(persona.model);
    setExecutionMode(persona.executionMode);
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
        <ModelSelect
          value={model}
          onChange={(v) => {
            setModel(v);
            save({ model: v });
          }}
          className="max-w-sm"
          ariaLabel="Model"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
          Execution Mode
        </label>
        <select
          value={executionMode}
          onChange={(e) => {
            const val = e.target.value as ExecutionMode;
            setExecutionMode(val);
            save({ executionMode: val });
          }}
          className="w-full max-w-sm rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
        >
          <option value="claude_code">Claude Code</option>
          <option value="message">Message</option>
        </select>
        <p className="mt-1 text-xs text-[var(--theme-text-faint)]">
          {executionMode === 'claude_code'
            ? 'Full filesystem access, tools, worktree — for coding tasks'
            : 'Fast completion, no tools — for analysis, review, opinions'}
        </p>
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

import { useState, useCallback, useEffect, useRef } from 'react';
import type { AgentPersona } from '@fleex/shared';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { MarkdownEditor } from '../markdown/MarkdownEditor';
import { PersonaCoachPanel } from './PersonaCoachPanel';

interface AgentMarkdownTabProps {
  persona: AgentPersona;
  field: 'soulMd' | 'identityMd' | 'memoryMd';
}

const FIELD_LABELS: Record<string, { title: string; description: string }> = {
  soulMd: {
    title: 'Soul',
    description: 'Core personality, values, and behavioral guidelines for this agent.',
  },
  identityMd: {
    title: 'Identity',
    description: 'Role definition, expertise areas, and how this agent presents itself.',
  },
  memoryMd: {
    title: 'Memory',
    description: 'Persistent learnings and context accumulated across sessions. Can be updated by the agent.',
  },
};

export function AgentMarkdownTab({ persona, field }: AgentMarkdownTabProps) {
  const updatePersona = useAgentPersonaStore((s) => s.updatePersona);
  const [content, setContent] = useState(persona[field]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const meta = FIELD_LABELS[field]!;

  useEffect(() => {
    setContent(persona[field]);
  }, [persona, field]);

  const debouncedSave = useCallback(
    (value: string) => {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        try {
          await updatePersona(persona.id, { [field]: value });
        } catch (err) {
          console.error(`Failed to save ${field}:`, err);
        }
      }, 1000);
    },
    [persona.id, field, updatePersona],
  );

  useEffect(() => {
    return () => clearTimeout(saveTimerRef.current);
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      setContent(value);
      debouncedSave(value);
    },
    [debouncedSave],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Tab header */}
      <div className="border-b border-[var(--theme-border)] px-6 py-3">
        <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">{meta.title}</h3>
        <p className="text-xs text-[var(--theme-text-muted)]">{meta.description}</p>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        <div className="flex min-h-64 flex-1">
          <MarkdownEditor
            surfaceKind="agent_persona_md"
            defaultMode="write"
            value={content}
            onChange={handleChange}
            placeholder={`Write ${meta.title.toLowerCase()} content in Markdown...`}
            textareaProps={{ spellCheck: false }}
          />
        </div>

        {/* Only under Memory: the coach amends learned lessons, not tone or role. */}
        {field === 'memoryMd' && (
          <PersonaCoachPanel
            personaId={persona.id}
            onApplied={(memoryMd) => setContent(memoryMd)}
          />
        )}
      </div>
    </div>
  );
}

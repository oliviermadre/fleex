import { useState, useCallback, useEffect, useRef } from 'react';
import type { AgentPersona } from '@fleex/shared';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { cn } from '../../lib/cn';

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
  const [showPreview, setShowPreview] = useState(false);
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

  const handleChange = (value: string) => {
    setContent(value);
    debouncedSave(value);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Tab header */}
      <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-6 py-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">{meta.title}</h3>
          <p className="text-xs text-[var(--theme-text-muted)]">{meta.description}</p>
        </div>
        <button
          onClick={() => setShowPreview(!showPreview)}
          className={cn(
            'rounded px-2 py-1 text-xs transition-colors',
            showPreview
              ? 'bg-[var(--theme-accent)] text-white'
              : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
          )}
        >
          {showPreview ? 'Edit' : 'Preview'}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {showPreview ? (
          <div className="h-full overflow-y-auto p-6">
            <div className="prose prose-invert max-w-none whitespace-pre-wrap text-sm text-[var(--theme-text-secondary)]">
              {content || <span className="italic text-[var(--theme-text-faint)]">Empty</span>}
            </div>
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            className="h-full w-full resize-none bg-[var(--theme-bg-primary)] p-6 font-mono text-sm text-[var(--theme-text-primary)] outline-none placeholder:text-[var(--theme-text-faint)]"
            placeholder={`Write ${meta.title.toLowerCase()} content in Markdown...`}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}

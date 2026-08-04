import { useState, useCallback, useEffect } from 'react';
import type { Skill } from '@fleex/shared';
import { useSkillStore } from '../../stores/skillStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { cn } from '../../lib/cn';
import { tint } from '../../lib/tints';
import { MarkdownEditor } from '../markdown/MarkdownEditor';

const TABS = [
  { key: 'config' as const, label: 'Config' },
  { key: 'markdown' as const, label: 'Instructions' },
];

interface SkillEditorProps {
  skill: Skill;
}

function SkillConfigTab({ skill }: SkillEditorProps) {
  const updateSkill = useSkillStore((s) => s.updateSkill);
  const personas = useAgentPersonaStore((s) => s.personas);

  const [commandName, setCommandName] = useState(skill.commandName);
  const [displayName, setDisplayName] = useState(skill.displayName);
  const [personaId, setPersonaId] = useState(skill.personaId);
  const [enabled, setEnabled] = useState(skill.enabled);

  useEffect(() => {
    setCommandName(skill.commandName);
    setDisplayName(skill.displayName);
    setPersonaId(skill.personaId);
    setEnabled(skill.enabled);
  }, [skill]);

  const save = useCallback(
    async (changes: Record<string, unknown>) => {
      try {
        await updateSkill(skill.id, changes);
      } catch (err) {
        console.error('Failed to save skill config:', err);
      }
    },
    [skill.id, updateSkill],
  );

  return (
    <div className="flex flex-col gap-5 overflow-y-auto p-6">
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
          Command Name
        </label>
        <input
          type="text"
          value={commandName}
          onChange={(e) => setCommandName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
          onBlur={() => {
            if (commandName !== skill.commandName && commandName.trim()) {
              save({ commandName, name: commandName });
            }
          }}
          className="w-full max-w-sm rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
        />
        <p className="mt-1 text-xs text-[var(--theme-text-faint)]">
          Unique slug for the skill command
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
            if (displayName !== skill.displayName && displayName.trim()) {
              save({ displayName });
            }
          }}
          className="w-full max-w-sm rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--theme-text-muted)]">
          Agent Persona
        </label>
        <select
          value={personaId}
          onChange={(e) => {
            setPersonaId(e.target.value);
            save({ personaId: e.target.value });
          }}
          className="w-full max-w-sm rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
        >
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-[var(--theme-text-faint)]">
          The agent persona that will execute this skill
        </p>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-[var(--theme-text-muted)]">Enabled</label>
        <button
          onClick={() => {
            const next = !enabled;
            setEnabled(next);
            save({ enabled: next });
          }}
          className={cn(
            'relative h-5 w-9 rounded-full transition-colors',
            enabled ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-text-faint)]/30',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
              enabled ? 'left-[18px]' : 'left-0.5',
            )}
          />
        </button>
        <span className="text-xs text-[var(--theme-text-faint)]">
          {enabled ? 'Visible in SmartSession dropdown' : 'Hidden from SmartSession dropdown'}
        </span>
      </div>
    </div>
  );
}

function SkillMarkdownTab({ skill }: SkillEditorProps) {
  const updateSkill = useSkillStore((s) => s.updateSkill);
  const [content, setContent] = useState(skill.markdownContent);

  useEffect(() => {
    setContent(skill.markdownContent);
  }, [skill.markdownContent]);

  const handleBlur = useCallback(() => {
    if (content !== skill.markdownContent) {
      updateSkill(skill.id, { markdownContent: content }).catch((err) =>
        console.error('Failed to save skill markdown:', err),
      );
    }
  }, [content, skill.id, skill.markdownContent, updateSkill]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      <p className="mb-2 text-xs text-[var(--theme-text-muted)]">
        Markdown instructions sent to the agent when this skill is executed against a ticket.
      </p>
      <MarkdownEditor
        surfaceKind="skill_instructions"
        defaultMode="write"
        value={content}
        onChange={setContent}
        placeholder={'# Skill Instructions\n\nDescribe the workflow the agent should perform...'}
        textareaProps={{ onBlur: handleBlur }}
      />
    </div>
  );
}

export function SkillEditor() {
  const skills = useSkillStore((s) => s.skills);
  const selectedSkillId = useSkillStore((s) => s.selectedSkillId);
  const [activeTab, setActiveTab] = useState<'config' | 'markdown'>('config');

  const skill = skills.find((s) => s.id === selectedSkillId);

  if (!skill) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--theme-text-faint)]">
        Select a skill to edit
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-primary)]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--theme-border)] px-3" style={{ height: 'var(--header-height)' }}>
        <div className="flex items-center gap-1.5 min-w-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--theme-text-secondary)]">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
          <span className="text-sm font-semibold font-mono text-[var(--theme-text-primary)] truncate">
            {skill.displayName}
          </span>
        </div>

        <span className={cn(
          'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
          skill.enabled
            ? tint('green')
            : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-muted)]',
        )}>
          {skill.enabled ? 'Enabled' : 'Disabled'}
        </span>

        <span className="shrink-0 truncate text-xs text-[var(--theme-text-faint)]">
          /{skill.commandName}
        </span>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 overflow-x-auto">
        {TABS.map((tab) => (
          <div
            key={tab.key}
            role="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'relative flex items-center px-3 py-2 text-xs whitespace-nowrap transition-colors',
              activeTab === tab.key
                ? 'text-[var(--theme-text-primary)]'
                : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
            )}
          >
            {tab.label}
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--theme-accent)]" />
            )}
          </div>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {activeTab === 'config' && <SkillConfigTab skill={skill} />}
        {activeTab === 'markdown' && <SkillMarkdownTab skill={skill} />}
      </div>
    </div>
  );
}

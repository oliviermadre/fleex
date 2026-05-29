import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ExecutionMode, PanelMember } from '@fleex/shared';
import { usePanelStore } from '../../stores/panelStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useModels } from '../../hooks/useModels';
import { cn } from '../../lib/cn';

function PanelEmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--theme-bg-primary)]">
      <div className="flex flex-col items-center gap-3 text-center">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--theme-text-faint)]">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <p className="text-sm text-[var(--theme-text-muted)]">Select a panel to edit</p>
      </div>
    </div>
  );
}

export function PanelDetailView() {
  const navigate = useNavigate();
  const panels = usePanelStore((s) => s.panels);
  const selectedPanelId = usePanelStore((s) => s.selectedPanelId);
  const updatePanel = usePanelStore((s) => s.updatePanel);
  const deletePanel = usePanelStore((s) => s.deletePanel);
  const personas = useAgentPersonaStore((s) => s.personas);
  const { models } = useModels();
  const memberModelOptions = [
    { value: 'inherited', label: 'Inherited from persona' },
    ...models.map((m) => ({ value: m.id, label: m.label })),
  ];

  const panel = panels.find((p) => p.id === selectedPanelId);

  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('claude_code');
  const [orchestratorModel, setOrchestratorModel] = useState('claude-sonnet-4-6');
  const [defaultMemberModel, setDefaultMemberModel] = useState('claude-sonnet-4-6');
  const [orchestratorPrompt, setOrchestratorPrompt] = useState('');
  const [orchestratorPersonaId, setOrchestratorPersonaId] = useState<string | null>(null);
  const [members, setMembers] = useState<PanelMember[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Sync form state when panel changes
  useEffect(() => {
    if (panel) {
      setName(panel.name);
      setDisplayName(panel.displayName);
      setDescription(panel.description ?? '');
      setExecutionMode(panel.executionMode);
      setOrchestratorModel(panel.orchestratorModel);
      setDefaultMemberModel(panel.defaultMemberModel);
      setOrchestratorPrompt(panel.orchestratorPrompt ?? '');
      setOrchestratorPersonaId(panel.orchestratorPersonaId ?? null);
      setMembers(panel.members);
      setEnabled(panel.enabled);
      setErrors([]);
    }
  }, [panel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!panel) return <PanelEmptyState />;

  const availablePersonas = personas.filter(
    (p) => !members.some((m) => m.personaId === p.id)
  );

  const validate = (): boolean => {
    const errs: string[] = [];
    if (!name.trim()) errs.push('Name (slug) is required');
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) errs.push('Name must be lowercase alphanumeric with hyphens/underscores');
    if (!displayName.trim()) errs.push('Display name is required');
    if (members.length < 2) errs.push('At least 2 members are required');
    setErrors(errs);
    return errs.length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await updatePanel(panel.id, {
        name: name.trim(),
        displayName: displayName.trim(),
        description: description.trim(),
        executionMode,
        members,
        orchestratorModel,
        orchestratorPersonaId,
        defaultMemberModel,
        orchestratorPrompt: orchestratorPrompt.trim(),
        enabled,
      });
      setErrors([]);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Failed to save']);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete panel "${panel.displayName}"? This cannot be undone.`)) return;
    await deletePanel(panel.id);
    navigate('/agents', { replace: true });
  };

  const addMember = (personaId: string) => {
    setMembers([
      ...members,
      { personaId, order: members.length, modelOverride: 'inherited' },
    ]);
  };

  const removeMember = (index: number) => {
    setMembers(members.filter((_, i) => i !== index).map((m, i) => ({ ...m, order: i })));
  };

  const updateMemberModel = (index: number, modelOverride: string) => {
    setMembers(members.map((m, i) => (i === index ? { ...m, modelOverride } : m)));
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-primary)]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--theme-border)] px-3" style={{ height: 'var(--header-height)' }}>
        <div className="flex items-center gap-1.5 min-w-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--theme-text-secondary)]">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span className="text-sm font-semibold font-mono text-[var(--theme-text-primary)] truncate">
            {panel.displayName}
          </span>
        </div>

        <span className="shrink-0 rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-text-muted)]">
          {(models.find((m) => m.id === panel.orchestratorModel)?.label
            ?? panel.orchestratorModel).replace(/^Claude /, '')}
        </span>

        <span className="shrink-0 truncate text-xs text-[var(--theme-text-faint)]">
          @panel:{panel.name}
        </span>

        {!panel.enabled && (
          <span className="shrink-0 rounded bg-yellow-400/10 px-1.5 py-0.5 text-[10px] text-yellow-400">
            Disabled
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setEnabled(!enabled)}
            className="flex h-6 items-center gap-1.5 rounded px-2 text-xs font-medium text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
          >
            {enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={handleDelete}
            className="flex h-6 items-center gap-1.5 rounded px-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-400/10"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Form content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          {errors.length > 0 && (
            <div className="rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2">
              {errors.map((err, i) => (
                <p key={i} className="text-xs text-red-400">{err}</p>
              ))}
            </div>
          )}

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-[var(--theme-text-secondary)]">Name (slug)</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                placeholder="archi-committee"
                className="w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
              />
              <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
                Used in <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">@panel:{name || 'name'}</code> mentions
              </p>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-[var(--theme-text-secondary)]">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Architecture Committee"
                className="w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--theme-text-secondary)]">Description</label>
            <textarea
              className="w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
              rows={2}
              placeholder="Multi-expert architectural review panel..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--theme-text-secondary)]">Execution Mode</label>
            <select
              className="w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
              value={executionMode}
              onChange={(e) => setExecutionMode(e.target.value as ExecutionMode)}
            >
              <option value="claude_code">Claude Code</option>
              <option value="message">Message</option>
            </select>
            <p className="text-xs text-[var(--theme-text-muted)]">
              {executionMode === 'claude_code'
                ? 'Members have full filesystem access, tools, and worktree — for code-grounded analysis'
                : 'Fast completion, no tools — for opinions, reviews, and discussion-only panels'}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--theme-text-secondary)]">
              Orchestrator Persona <span className="font-normal text-[var(--theme-text-muted)]">(optional)</span>
            </label>
            <select
              className="w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
              value={orchestratorPersonaId ?? ''}
              onChange={(e) => setOrchestratorPersonaId(e.target.value || null)}
            >
              <option value="">None (default synthesis)</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>{p.displayName || p.name}</option>
              ))}
            </select>
            <p className="text-xs text-[var(--theme-text-muted)]">
              If set, the persona's soul, identity and memory will be used as system prompt for the synthesis
            </p>
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-[var(--theme-text-secondary)]">Orchestrator Model</label>
              <select
                className="w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
                value={orchestratorModel}
                onChange={(e) => setOrchestratorModel(e.target.value)}
              >
                {models.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-[var(--theme-text-muted)]">Model used to generate the synthesis</p>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-[var(--theme-text-secondary)]">Default Member Model</label>
              <select
                className="w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
                value={defaultMemberModel}
                onChange={(e) => setDefaultMemberModel(e.target.value)}
              >
                {models.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-[var(--theme-text-muted)]">Fallback model for members set to "inherited"</p>
            </div>
          </div>

          {/* Members */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-[var(--theme-text-secondary)]">
                Members ({members.length})
              </label>
            </div>

            {members.length === 0 && (
              <p className="py-4 text-center text-xs text-[var(--theme-text-muted)]">
                No members added. Select personas to participate in this panel.
              </p>
            )}

            {members.map((member, i) => {
              const persona = personas.find((p) => p.id === member.personaId);
              return (
                <div
                  key={member.personaId}
                  className="flex items-center gap-3 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2"
                >
                  <span className="text-xs text-[var(--theme-text-muted)]">#{i + 1}</span>
                  <span className="flex-1 text-sm text-[var(--theme-text-primary)]">
                    {persona?.displayName ?? 'Unknown'}
                    <span className="ml-2 text-xs text-[var(--theme-text-muted)]">{persona?.name}</span>
                  </span>
                  <select
                    className="rounded border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
                    value={member.modelOverride}
                    onChange={(e) => updateMemberModel(i, e.target.value)}
                  >
                    {memberModelOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button
                    className="text-[var(--theme-text-faint)] transition-colors hover:text-red-400"
                    onClick={() => removeMember(i)}
                    title="Remove"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="4" y1="4" x2="12" y2="12" />
                      <line x1="12" y1="4" x2="4" y2="12" />
                    </svg>
                  </button>
                </div>
              );
            })}

            {availablePersonas.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  className="flex-1 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-sm text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      addMember(e.target.value);
                      e.target.value = '';
                    }
                  }}
                >
                  <option value="" disabled>+ Add a persona...</option>
                  {availablePersonas.map((p) => (
                    <option key={p.id} value={p.id}>{p.displayName} ({p.name})</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Orchestrator Prompt */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--theme-text-secondary)]">
              Synthesis Prompt <span className="font-normal text-[var(--theme-text-muted)]">(optional)</span>
            </label>
            <textarea
              className="w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 font-mono text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
              rows={4}
              placeholder="Custom instructions for the orchestrator that generates the synthesis. Leave empty for the default synthesis behavior."
              value={orchestratorPrompt}
              onChange={(e) => setOrchestratorPrompt(e.target.value)}
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className={cn(
                'rounded bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--theme-accent-hover)]',
                saving && 'opacity-50',
              )}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

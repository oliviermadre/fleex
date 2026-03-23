import { useState, useEffect } from 'react';
import type { Panel, PanelMember, CreatePanelRequest, UpdatePanelRequest } from '@fleex/shared';
import { usePanelStore } from '../../stores/panelStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { cn } from '../../lib/cn';

const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { value: 'claude-opus-4-5-20250929', label: 'Claude Opus 4.5' },
  { value: 'claude-haiku-4-5-20250929', label: 'Claude Haiku 4.5' },
];

const MEMBER_MODEL_OPTIONS = [
  { value: 'inherited', label: 'Inherited from persona' },
  ...MODEL_OPTIONS,
];

export function PanelsSettingsTab() {
  const { panels, loaded, loadPanels, createPanel, updatePanel, deletePanel } = usePanelStore();
  const { personas, loaded: personasLoaded, loadPersonas } = useAgentPersonaStore();
  const [editingPanel, setEditingPanel] = useState<Panel | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!loaded) loadPanels();
    if (!personasLoaded) loadPersonas();
  }, [loaded, personasLoaded, loadPanels, loadPersonas]);

  const handleCreate = () => {
    setIsCreating(true);
    setEditingPanel(null);
  };

  const handleEdit = (panel: Panel) => {
    setIsCreating(false);
    setEditingPanel(panel);
  };

  const handleDelete = async (panel: Panel) => {
    if (!confirm(`Delete panel "${panel.displayName}"? This cannot be undone.`)) return;
    await deletePanel(panel.id);
  };

  const handleSave = async (data: CreatePanelRequest | (UpdatePanelRequest & { id: string })) => {
    if ('id' in data) {
      const { id, ...req } = data;
      await updatePanel(id, req);
    } else {
      await createPanel(data);
    }
    setEditingPanel(null);
    setIsCreating(false);
    await loadPanels();
  };

  const handleCancel = () => {
    setEditingPanel(null);
    setIsCreating(false);
  };

  if (!loaded) {
    return <p className="py-8 text-center text-sm text-[var(--theme-text-muted)]">Loading...</p>;
  }

  if (isCreating || editingPanel) {
    return (
      <PanelEditor
        panel={editingPanel}
        personas={personas}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-[var(--theme-text-muted)]">
        Panels are groups of personas that debate a topic on a ticket. Trigger with{' '}
        <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">@panel:name</code>{' '}
        in a comment or via the Smart Button.
      </p>

      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-[var(--theme-text-secondary)]">
          Panels ({panels.length})
        </label>
        <Button variant="secondary" size="sm" onClick={handleCreate}>
          + New Panel
        </Button>
      </div>

      {panels.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--theme-text-muted)]">
          No panels configured. Create one to enable multi-agent debates on tickets.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {panels.map((panel) => (
            <PanelCard
              key={panel.id}
              panel={panel}
              personas={personas}
              onEdit={() => handleEdit(panel)}
              onDelete={() => handleDelete(panel)}
              onToggleEnabled={async () => {
                await updatePanel(panel.id, { enabled: !panel.enabled });
                await loadPanels();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PanelCard({
  panel,
  personas,
  onEdit,
  onDelete,
  onToggleEnabled,
}: {
  panel: Panel;
  personas: { id: string; name: string; displayName: string }[];
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
}) {
  const memberNames = panel.members
    .map((m) => personas.find((p) => p.id === m.personaId)?.displayName ?? 'Unknown')
    .join(', ');

  return (
    <div className={cn(
      'rounded-md border bg-[var(--theme-bg-surface)] px-4 py-3',
      panel.enabled ? 'border-[var(--theme-border)]' : 'border-[var(--theme-border)] opacity-50',
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--theme-text-primary)]">
              {panel.displayName}
            </span>
            <code className="rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] text-[var(--theme-text-muted)]">
              @panel:{panel.name}
            </code>
            {!panel.enabled && (
              <span className="rounded bg-[var(--theme-warning)]/10 px-1.5 py-0.5 text-[10px] text-[var(--theme-warning)]">
                Disabled
              </span>
            )}
          </div>
          {panel.description && (
            <p className="mt-0.5 text-xs text-[var(--theme-text-muted)]">{panel.description}</p>
          )}
          <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
            {panel.members.length} member{panel.members.length !== 1 ? 's' : ''}: {memberNames}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="text-xs text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]"
            onClick={onToggleEnabled}
          >
            {panel.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            className="text-xs text-[var(--theme-accent)] hover:underline"
            onClick={onEdit}
          >
            Edit
          </button>
          <button
            className="text-xs text-[var(--theme-danger)] hover:underline"
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function PanelEditor({
  panel,
  personas,
  onSave,
  onCancel,
}: {
  panel: Panel | null;
  personas: { id: string; name: string; displayName: string; model: string }[];
  onSave: (data: CreatePanelRequest | (UpdatePanelRequest & { id: string })) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(panel?.name ?? '');
  const [displayName, setDisplayName] = useState(panel?.displayName ?? '');
  const [description, setDescription] = useState(panel?.description ?? '');
  const [orchestratorModel, setOrchestratorModel] = useState(panel?.orchestratorModel ?? 'claude-sonnet-4-5-20250929');
  const [defaultMemberModel, setDefaultMemberModel] = useState(panel?.defaultMemberModel ?? 'claude-sonnet-4-5-20250929');
  const [orchestratorPrompt, setOrchestratorPrompt] = useState(panel?.orchestratorPrompt ?? '');
  const [members, setMembers] = useState<PanelMember[]>(panel?.members ?? []);
  const [errors, setErrors] = useState<string[]>([]);

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

  const handleSubmit = () => {
    if (!validate()) return;
    const data = {
      name: name.trim(),
      displayName: displayName.trim(),
      description: description.trim(),
      members,
      orchestratorModel,
      defaultMemberModel,
      orchestratorPrompt: orchestratorPrompt.trim(),
      enabled: panel?.enabled ?? true,
    };

    if (panel) {
      onSave({ ...data, id: panel.id });
    } else {
      onSave(data);
    }
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
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">
          {panel ? 'Edit Panel' : 'New Panel'}
        </h3>
        <button
          className="text-xs text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>

      {errors.length > 0 && (
        <div className="rounded-md border border-[var(--theme-danger)]/30 bg-[var(--theme-danger)]/5 px-3 py-2">
          {errors.map((err, i) => (
            <p key={i} className="text-xs text-[var(--theme-danger)]">{err}</p>
          ))}
        </div>
      )}

      <div className="flex gap-4">
        <div className="flex-1">
          <Input
            label="Name (slug)"
            placeholder="archi-committee"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
          />
          <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
            Used in <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">@panel:{name || 'name'}</code> mentions
          </p>
        </div>
        <div className="flex-1">
          <Input
            label="Display Name"
            placeholder="Architecture Committee"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-[var(--theme-text-secondary)]">Description</label>
        <textarea
          className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
          rows={2}
          placeholder="Multi-expert architectural review panel..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <Select
            label="Orchestrator Model"
            options={MODEL_OPTIONS}
            value={orchestratorModel}
            onChange={(e) => setOrchestratorModel(e.target.value)}
          />
          <p className="mt-1 text-xs text-[var(--theme-text-muted)]">Model used to generate the synthesis</p>
        </div>
        <div className="flex-1">
          <Select
            label="Default Member Model"
            options={MODEL_OPTIONS}
            value={defaultMemberModel}
            onChange={(e) => setDefaultMemberModel(e.target.value)}
          />
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
                className="rounded border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
                value={member.modelOverride}
                onChange={(e) => updateMemberModel(i, e.target.value)}
              >
                {MEMBER_MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <button
                className="text-[var(--theme-text-faint)] transition-colors hover:text-[var(--theme-danger)]"
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
              id="add-member-select"
              className="flex-1 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-sm text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
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
          className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-2 font-mono text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
          rows={4}
          placeholder="Custom instructions for the orchestrator that generates the synthesis. Leave empty for the default synthesis behavior."
          value={orchestratorPrompt}
          onChange={(e) => setOrchestratorPrompt(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSubmit}>
          {panel ? 'Save Changes' : 'Create Panel'}
        </Button>
      </div>
    </div>
  );
}

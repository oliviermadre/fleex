import { useState, useEffect, useCallback, useRef } from 'react';
import { useSettingsStore, type AppSettings, type PinnedIcon, type WorktreeAction } from '../../stores/settingsStore';
import { useUIStore, type SettingsTab } from '../../stores/uiStore';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { TagInput } from '../ui/TagInput';
import { AppearanceTab } from './AppearanceTab';
import { CredentialsTab } from './CredentialsTab';
import { cn } from '../../lib/cn';
import type { AgentToken } from '@fleex/shared';
import * as api from '../../services/api';

const tabLabels: Record<SettingsTab, string> = {
  general: 'General',
  appearance: 'Appearance',
  repositories: 'Repositories',
  'pinned-icons': 'Pinned Icons',
  'worktree-actions': 'Worktree Actions',
  'agent-tokens': 'Agent Tokens',
  credentials: 'Credentials',
};

export function SettingsPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const resolveRepositories = useSettingsStore((s) => s.resolveRepositories);
  const resolving = useSettingsStore((s) => s.resolving);
  const settingsTab = useUIStore((s) => s.settingsTab);

  const [basePath, setBasePath] = useState('');
  const [humanDisplayName, setHumanDisplayName] = useState('');
  const [humanMentionName, setHumanMentionName] = useState('');
  const [agentMaxConcurrency, setAgentMaxConcurrency] = useState(1);
  const [repoPatterns, setRepoPatterns] = useState<string[]>([]);
  const resolveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pinnedIcons, setPinnedIcons] = useState<PinnedIcon[]>([]);
  const [worktreeActions, setWorktreeActions] = useState<WorktreeAction[]>([]);

  useEffect(() => {
    setBasePath(settings.basePath);
    setHumanDisplayName((settings as unknown as Record<string, unknown>)['humanDisplayName'] as string ?? '');
    setHumanMentionName((settings as unknown as Record<string, unknown>)['humanMentionName'] as string ?? '');
    setAgentMaxConcurrency(settings.agentMaxConcurrency ?? 1);
    setRepoPatterns(settings.repositories);
    setPinnedIcons(settings.pinnedIcons.map((i) => ({ ...i })));
    setWorktreeActions((settings.worktreeActions ?? []).map((a) => ({ ...a })));
  }, [settings]);

  const handleSave = async () => {
    await saveSettings({
      basePath,
      repositories: repoPatterns,
      pinnedIcons,
      worktreeActions,
      ...(humanDisplayName.trim() ? { humanDisplayName: humanDisplayName.trim() } : { humanDisplayName: undefined }),
      ...(humanMentionName.trim() ? { humanMentionName: humanMentionName.trim() } : { humanMentionName: undefined }),
      agentMaxConcurrency,
    } as Partial<AppSettings> & Record<string, unknown>);
  };

  const handleTagsChange = useCallback((newTags: string[]) => {
    setRepoPatterns(newTags);
    clearTimeout(resolveTimerRef.current);
    resolveTimerRef.current = setTimeout(() => {
      saveSettings({ repositories: newTags }).then(() => resolveRepositories());
    }, 600);
  }, [saveSettings, resolveRepositories]);

  const addPinnedIcon = () => {
    setPinnedIcons([
      ...pinnedIcons,
      {
        id: crypto.randomUUID(),
        icon: '',
        iconType: 'svg',
        label: '',
        actionType: 'url',
        actionValue: '',
      },
    ]);
  };

  const updatePinnedIcon = (index: number, patch: Partial<PinnedIcon>) => {
    setPinnedIcons((prev) =>
      prev.map((icon, i) => (i === index ? { ...icon, ...patch } : icon))
    );
  };

  const removePinnedIcon = (index: number) => {
    setPinnedIcons((prev) => prev.filter((_, i) => i !== index));
  };

  const addWorktreeAction = () => {
    setWorktreeActions([
      ...worktreeActions,
      {
        id: crypto.randomUUID(),
        icon: '',
        iconType: 'svg',
        label: '',
        actionType: 'url',
        actionValue: '',
      },
    ]);
  };

  const updateWorktreeAction = (index: number, patch: Partial<WorktreeAction>) => {
    setWorktreeActions((prev) =>
      prev.map((action, i) => (i === index ? { ...action, ...patch } : action))
    );
  };

  const removeWorktreeAction = (index: number) => {
    setWorktreeActions((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-base)]">
      {/* Breadcrumb header */}
      <div className="flex w-full items-center border-b border-[var(--theme-border)] px-3" style={{ height: 'var(--header-height)' }}>
        <span className="text-sm text-[var(--theme-text-muted)]">Settings</span>
        <span className="mx-2 text-sm text-[var(--theme-text-faint)]">/</span>
        <span className="text-sm font-medium text-[var(--theme-text-primary)]">{tabLabels[settingsTab]}</span>
      </div>

      {/* Form content */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl">
          {settingsTab === 'general' && (
            <GeneralTab
              basePath={basePath}
              setBasePath={setBasePath}
              humanDisplayName={humanDisplayName}
              setHumanDisplayName={setHumanDisplayName}
              humanMentionName={humanMentionName}
              setHumanMentionName={setHumanMentionName}
              agentMaxConcurrency={agentMaxConcurrency}
              setAgentMaxConcurrency={setAgentMaxConcurrency}
            />
          )}
          {settingsTab === 'appearance' && <AppearanceTab />}
          {settingsTab === 'repositories' && (
            <RepositoriesTab
              tags={repoPatterns}
              onTagsChange={handleTagsChange}
              resolving={resolving}
            />
          )}
          {settingsTab === 'pinned-icons' && (
            <PinnedIconsTab
              pinnedIcons={pinnedIcons}
              onAdd={addPinnedIcon}
              onUpdate={updatePinnedIcon}
              onRemove={removePinnedIcon}
              onReorder={setPinnedIcons}
            />
          )}
          {settingsTab === 'worktree-actions' && (
            <WorktreeActionsTab
              worktreeActions={worktreeActions}
              onAdd={addWorktreeAction}
              onUpdate={updateWorktreeAction}
              onRemove={removeWorktreeAction}
              onReorder={setWorktreeActions}
            />
          )}
          {settingsTab === 'agent-tokens' && <AgentTokensTab />}
          {settingsTab === 'credentials' && <CredentialsTab />}

          {/* Save button */}
          <div className="mt-8 flex justify-end">
            <Button variant="primary" onClick={handleSave}>
              Save Settings
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GeneralTab({
  basePath,
  setBasePath,
  humanDisplayName,
  setHumanDisplayName,
  humanMentionName,
  setHumanMentionName,
  agentMaxConcurrency,
  setAgentMaxConcurrency,
}: {
  basePath: string;
  setBasePath: (v: string) => void;
  humanDisplayName: string;
  setHumanDisplayName: (v: string) => void;
  humanMentionName: string;
  setHumanMentionName: (v: string) => void;
  agentMaxConcurrency: number;
  setAgentMaxConcurrency: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Input
        id="basePath"
        label="Base Path"
        placeholder="/home/user/repos"
        value={basePath}
        onChange={(e) => setBasePath(e.target.value)}
      />
      <p className="text-xs text-[var(--theme-text-muted)]">
        Base directory for repositories. Repos are stored as{' '}
        <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">
          basePath/orgName/repoName
        </code>
      </p>

      <div className="mt-4 border-t border-[var(--theme-border)] pt-4">
        <Input
          id="humanDisplayName"
          label="Display Name"
          placeholder="Wally Worktree"
          value={humanDisplayName}
          onChange={(e) => setHumanDisplayName(e.target.value)}
        />
        <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
          Your name as shown in ticket comments (e.g. "Wally Worktree"). Falls back to mention name if empty.
        </p>

        <div className="mt-4">
        <Input
          id="humanMentionName"
          label="Mention Name"
          placeholder="Wally"
          value={humanMentionName}
          onChange={(e) => setHumanMentionName(e.target.value)}
        />
        <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
          The <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">@tag</code> agents
          should use to mention you (e.g. <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">Wally</code> for{' '}
          <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-accent)]">@Wally</code>).
          Per-agent overrides can be set in agent configuration.
        </p>
        </div>
      </div>

      <div className="mt-4 border-t border-[var(--theme-border)] pt-4">
        <Input
          id="agentMaxConcurrency"
          label="Max Simultaneous Agent Executions"
          type="number"
          min={1}
          max={20}
          value={String(agentMaxConcurrency)}
          onChange={(e) => setAgentMaxConcurrency(Math.max(1, parseInt(e.target.value, 10) || 1))}
        />
        <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
          Maximum number of agents that can run simultaneously. Additional mentions are queued.
        </p>
      </div>
    </div>
  );
}

function RepositoriesTab({
  tags,
  onTagsChange,
  resolving,
}: {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  resolving: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      <TagInput
        label="Repository Patterns"
        tags={tags}
        onChange={onTagsChange}
        placeholder="org/* or owner/repo"
        helperText={
          <p>
            Use <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">org/*</code> to
            include all repos from an organization.{' '}
            {resolving && <span className="text-[var(--theme-accent)]">Resolving…</span>}
          </p>
        }
      />
    </div>
  );
}

function PinnedIconsTab({
  pinnedIcons,
  onAdd,
  onUpdate,
  onRemove,
  onReorder,
}: {
  pinnedIcons: PinnedIcon[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<PinnedIcon>) => void;
  onRemove: (index: number) => void;
  onReorder: (icons: PinnedIcon[]) => void;
}) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<'top' | 'bottom'>('bottom');
  const draggedIdRef = useRef<string | null>(null);

  const handleDragStart = useCallback((id: string) => (e: React.DragEvent) => {
    draggedIdRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-pinned-icon', id);
    (e.currentTarget as HTMLElement).style.opacity = '0.4';
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    draggedIdRef.current = null;
    setDragOverId(null);
    (e.currentTarget as HTMLElement).style.opacity = '';
  }, []);

  const handleDragOver = useCallback((id: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-pinned-icon')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropEdge(e.clientY < midY ? 'top' : 'bottom');
    setDragOverId(id);
  }, []);

  const handleDragLeave = useCallback((id: string) => (e: React.DragEvent) => {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    if (dragOverId === id) setDragOverId(null);
  }, [dragOverId]);

  const handleDrop = useCallback((targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('application/x-pinned-icon');
    setDragOverId(null);
    if (!draggedId || draggedId === targetId) return;

    const items = [...pinnedIcons];
    const fromIdx = items.findIndex((a) => a.id === draggedId);
    if (fromIdx === -1) return;
    const moved = items.splice(fromIdx, 1)[0];
    if (!moved) return;
    let toIdx = items.findIndex((a) => a.id === targetId);
    if (toIdx === -1) return;
    if (dropEdge === 'bottom') toIdx += 1;
    items.splice(toIdx, 0, moved);
    onReorder(items);
  }, [pinnedIcons, dropEdge, onReorder]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-[var(--theme-text-secondary)]">
          Pinned Icons ({pinnedIcons.length})
        </label>
        <Button variant="secondary" size="sm" onClick={onAdd}>
          + Add Icon
        </Button>
      </div>

      {pinnedIcons.length === 0 && (
        <p className="py-6 text-center text-sm text-[var(--theme-text-muted)]">
          No pinned icons configured. Add one to pin it to the top of the sidebar.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {pinnedIcons.map((icon, i) => (
          <div
            key={icon.id}
            draggable
            onDragStart={handleDragStart(icon.id)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver(icon.id)}
            onDragLeave={handleDragLeave(icon.id)}
            onDrop={handleDrop(icon.id)}
            className="relative"
          >
            {dragOverId === icon.id && dropEdge === 'top' && (
              <div className="absolute -top-1.5 left-0 right-0 h-0.5 rounded bg-[var(--theme-accent)]" />
            )}
            <PinnedIconEditor
              icon={icon}
              onUpdate={(patch) => onUpdate(i, patch)}
              onRemove={() => onRemove(i)}
            />
            {dragOverId === icon.id && dropEdge === 'bottom' && (
              <div className="absolute -bottom-1.5 left-0 right-0 h-0.5 rounded bg-[var(--theme-accent)]" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function WorktreeActionsTab({
  worktreeActions,
  onAdd,
  onUpdate,
  onRemove,
  onReorder,
}: {
  worktreeActions: WorktreeAction[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<WorktreeAction>) => void;
  onRemove: (index: number) => void;
  onReorder: (actions: WorktreeAction[]) => void;
}) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<'top' | 'bottom'>('bottom');
  const draggedIdRef = useRef<string | null>(null);

  const handleDragStart = useCallback((id: string) => (e: React.DragEvent) => {
    draggedIdRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-worktree-action', id);
    (e.currentTarget as HTMLElement).style.opacity = '0.4';
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    draggedIdRef.current = null;
    setDragOverId(null);
    (e.currentTarget as HTMLElement).style.opacity = '';
  }, []);

  const handleDragOver = useCallback((id: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-worktree-action')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropEdge(e.clientY < midY ? 'top' : 'bottom');
    setDragOverId(id);
  }, []);

  const handleDragLeave = useCallback((id: string) => (e: React.DragEvent) => {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    if (dragOverId === id) setDragOverId(null);
  }, [dragOverId]);

  const handleDrop = useCallback((targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('application/x-worktree-action');
    setDragOverId(null);
    if (!draggedId || draggedId === targetId) return;

    const items = [...worktreeActions];
    const fromIdx = items.findIndex((a) => a.id === draggedId);
    if (fromIdx === -1) return;
    const moved = items.splice(fromIdx, 1)[0];
    if (!moved) return;
    let toIdx = items.findIndex((a) => a.id === targetId);
    if (toIdx === -1) return;
    if (dropEdge === 'bottom') toIdx += 1;
    items.splice(toIdx, 0, moved);
    onReorder(items);
  }, [worktreeActions, dropEdge, onReorder]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-[var(--theme-text-secondary)]">
          Worktree Actions ({worktreeActions.length})
        </label>
        <Button variant="secondary" size="sm" onClick={onAdd}>
          + Add Action
        </Button>
      </div>

      <p className="text-xs text-[var(--theme-text-muted)]">
        Actions appear as icon buttons under each worktree header. Template variables are resolved per worktree.
        {worktreeActions.length > 1 && ' Drag to reorder.'}
      </p>

      {worktreeActions.length === 0 && (
        <p className="py-6 text-center text-sm text-[var(--theme-text-muted)]">
          No worktree actions configured. Add one to show action buttons per worktree.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {worktreeActions.map((action, i) => (
          <div
            key={action.id}
            draggable
            onDragStart={handleDragStart(action.id)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver(action.id)}
            onDragLeave={handleDragLeave(action.id)}
            onDrop={handleDrop(action.id)}
            className="relative"
          >
            {dragOverId === action.id && dropEdge === 'top' && (
              <div className="absolute -top-1.5 left-0 right-0 h-0.5 rounded bg-[var(--theme-accent)]" />
            )}
            <WorktreeActionEditor
              action={action}
              onUpdate={(patch) => onUpdate(i, patch)}
              onRemove={() => onRemove(i)}
            />
            {dragOverId === action.id && dropEdge === 'bottom' && (
              <div className="absolute -bottom-1.5 left-0 right-0 h-0.5 rounded bg-[var(--theme-accent)]" />
            )}
          </div>
        ))}
      </div>

      {/* Template variables reference */}
      <div className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-4 py-3">
        <p className="mb-2 text-xs font-medium text-[var(--theme-text-secondary)]">Template Variables</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          {[
            ['{{org}}', 'Repository organization'],
            ['{{repo}}', 'Repository name'],
            ['{{branch}}', 'Branch name'],
            ['{{worktree_path}}', 'Worktree absolute path'],
            ['{{worktree_name}}', 'Worktree directory name'],
            ['{{branch_slug}}', 'Branch with / replaced by -'],
            ['{{branch_prefix}}', 'Before first /'],
            ['{{branch_suffix}}', 'After first /'],
            ['{{issue_number}}', 'First number in branch'],
          ].map(([variable, description]) => (
            <div key={variable} className="flex items-baseline gap-2">
              <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">{variable}</code>
              <span className="text-[var(--theme-text-muted)]">{description}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Pipe functions reference */}
      <div className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-4 py-3">
        <p className="mb-1 text-xs font-medium text-[var(--theme-text-secondary)]">Pipe Functions</p>
        <p className="mb-2 text-xs text-[var(--theme-text-muted)]">
          Transform variables with pipes:{' '}
          <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">
            {'{{variable | fn | fn(arg)}}'}
          </code>
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          {[
            ['slug', 'Replace non-alphanumeric with -'],
            ['lower', 'Lowercase'],
            ['upper', 'Uppercase'],
            ['trim', 'Trim whitespace'],
            ['substr(start, len?)', 'Extract substring'],
            ['replace(search, repl)', 'Replace all occurrences'],
            ['default(fallback)', 'Fallback if empty'],
          ].map(([fn, description]) => (
            <div key={fn} className="flex items-baseline gap-2">
              <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">{fn}</code>
              <span className="text-[var(--theme-text-muted)]">{description}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WorktreeActionEditor({
  action,
  onUpdate,
  onRemove,
}: {
  action: WorktreeAction;
  onUpdate: (patch: Partial<WorktreeAction>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(!action.label);

  return (
    <div className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]"
          onClick={() => setExpanded(!expanded)}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
            className={cn(
              'transition-transform',
              expanded ? 'rotate-90' : 'rotate-0'
            )}
          >
            <path d="M3 1l5 4-5 4V1z" />
          </svg>
        </button>
        <span className="flex-1 truncate text-xs text-[var(--theme-text-secondary)]">
          {action.label || 'Untitled'}
        </span>
        <span className="rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] text-[var(--theme-text-muted)]">
          {action.actionType}
        </span>
        <button
          className="text-[var(--theme-text-faint)] transition-colors hover:text-[var(--theme-danger)]"
          onClick={onRemove}
          title="Remove"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="flex flex-col gap-4 border-t border-[var(--theme-border)] px-4 py-4">
          <Input
            label="Label"
            placeholder="Open Branch on GitHub"
            value={action.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
          />

          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--theme-text-secondary)]">Icon Type</label>
              <div className="flex gap-0.5 rounded-md bg-[var(--theme-bg-overlay)] p-0.5">
                {(['svg', 'base64', 'url', 'path'] as const).map((type) => (
                  <button
                    key={type}
                    className={cn(
                      'flex-1 rounded px-3 py-1 text-xs font-medium transition-colors',
                      action.iconType === type
                        ? 'bg-[var(--theme-border-input)] text-[var(--theme-text-primary)]'
                        : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]'
                    )}
                    onClick={() => onUpdate({ iconType: type })}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--theme-text-secondary)]">Icon Value</label>
            <textarea
              className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
              rows={3}
              placeholder={
                action.iconType === 'svg'
                  ? '<svg>...</svg>'
                  : action.iconType === 'base64'
                    ? 'iVBORw0KGgo...'
                    : action.iconType === 'url'
                      ? 'https://example.com/icon.svg'
                      : '/path/to/icon.svg'
              }
              value={action.icon}
              onChange={(e) => onUpdate({ icon: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--theme-text-secondary)]">Action Type</label>
            <div className="flex gap-0.5 rounded-md bg-[var(--theme-bg-overlay)] p-0.5">
              <button
                className={cn(
                  'flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                  action.actionType === 'url'
                    ? 'bg-[var(--theme-border-input)] text-[var(--theme-text-primary)]'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]'
                )}
                onClick={() => onUpdate({ actionType: 'url' })}
              >
                Open URL
              </button>
              <button
                className={cn(
                  'flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                  action.actionType === 'shell'
                    ? 'bg-[var(--theme-border-input)] text-[var(--theme-text-primary)]'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]'
                )}
                onClick={() => onUpdate({ actionType: 'shell' })}
              >
                Shell Command
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--theme-text-secondary)]">Action Value</label>
            <textarea
              className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
              rows={action.actionType === 'shell' ? 4 : 2}
              placeholder={
                action.actionType === 'url'
                  ? 'https://github.com/{{org}}/{{repo}}/tree/{{branch}}'
                  : 'open -a "PhpStorm" "{{worktree_path}}"'
              }
              value={action.actionValue}
              onChange={(e) => onUpdate({ actionValue: e.target.value })}
            />
            <p className="text-xs text-[var(--theme-text-muted)]">
              Use {'{{template}}'} variables above. They resolve per worktree at click time.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function PinnedIconEditor({
  icon,
  onUpdate,
  onRemove,
}: {
  icon: PinnedIcon;
  onUpdate: (patch: Partial<PinnedIcon>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(!icon.label);

  return (
    <div className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]"
          onClick={() => setExpanded(!expanded)}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
            className={cn(
              'transition-transform',
              expanded ? 'rotate-90' : 'rotate-0'
            )}
          >
            <path d="M3 1l5 4-5 4V1z" />
          </svg>
        </button>
        <span className="flex-1 truncate text-xs text-[var(--theme-text-secondary)]">
          {icon.label || 'Untitled'}
        </span>
        <span className="rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] text-[var(--theme-text-muted)]">
          {icon.actionType}
        </span>
        <button
          className="text-[var(--theme-text-faint)] transition-colors hover:text-[var(--theme-danger)]"
          onClick={onRemove}
          title="Remove"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="flex flex-col gap-4 border-t border-[var(--theme-border)] px-4 py-4">
          <Input
            label="Label"
            placeholder="My Shortcut"
            value={icon.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
          />

          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--theme-text-secondary)]">Icon Type</label>
              <div className="flex gap-0.5 rounded-md bg-[var(--theme-bg-overlay)] p-0.5">
                {(['svg', 'base64', 'url', 'path'] as const).map((type) => (
                  <button
                    key={type}
                    className={cn(
                      'flex-1 rounded px-3 py-1 text-xs font-medium transition-colors',
                      icon.iconType === type
                        ? 'bg-[var(--theme-border-input)] text-[var(--theme-text-primary)]'
                        : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]'
                    )}
                    onClick={() => onUpdate({ iconType: type })}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--theme-text-secondary)]">Icon Value</label>
            <textarea
              className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
              rows={3}
              placeholder={
                icon.iconType === 'svg'
                  ? '<svg>...</svg>'
                  : icon.iconType === 'base64'
                    ? 'iVBORw0KGgo...'
                    : icon.iconType === 'url'
                      ? 'https://example.com/icon.svg'
                      : '/path/to/icon.svg'
              }
              value={icon.icon}
              onChange={(e) => onUpdate({ icon: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--theme-text-secondary)]">Action Type</label>
            <div className="flex gap-0.5 rounded-md bg-[var(--theme-bg-overlay)] p-0.5">
              <button
                className={cn(
                  'flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                  icon.actionType === 'url'
                    ? 'bg-[var(--theme-border-input)] text-[var(--theme-text-primary)]'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]'
                )}
                onClick={() => onUpdate({ actionType: 'url' })}
              >
                Open URL
              </button>
              <button
                className={cn(
                  'flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                  icon.actionType === 'shell'
                    ? 'bg-[var(--theme-border-input)] text-[var(--theme-text-primary)]'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]'
                )}
                onClick={() => onUpdate({ actionType: 'shell' })}
              >
                Shell Command
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--theme-text-secondary)]">Action Value</label>
            <textarea
              className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
              rows={icon.actionType === 'shell' ? 4 : 2}
              placeholder={
                icon.actionType === 'url'
                  ? 'https://example.com'
                  : 'echo "Hello"\nls -la'
              }
              value={icon.actionValue}
              onChange={(e) => onUpdate({ actionValue: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AgentTokensTab() {
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [newName, setNewName] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.fetchAgentTokens().then((t) => { setTokens(t); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const created = await api.createAgentToken(name);
    setRevealedSecret(created.secret);
    setNewName('');
    api.fetchAgentTokens().then(setTokens).catch(() => {});
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Revoke this token? Any agents using it will lose access.')) return;
    await api.deleteAgentToken(id);
    setTokens((prev) => prev.filter((t) => t.id !== id));
  };

  if (loading) {
    return <p className="py-8 text-center text-sm text-[var(--theme-text-muted)]">Loading...</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-[var(--theme-text-muted)]">
        Agent tokens allow external agents to access the ticket API at <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">/api/agents/v1/</code>
      </p>

      {/* Create form */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Token Name"
            placeholder="my-agent"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          />
        </div>
        <Button variant="primary" size="sm" onClick={handleCreate} disabled={!newName.trim()}>
          Generate Token
        </Button>
      </div>

      {/* Revealed secret */}
      {revealedSecret && (
        <div className="rounded-md border border-[var(--theme-accent)] bg-[var(--theme-accent)]/5 p-3">
          <p className="mb-1 text-xs font-medium text-[var(--theme-text-primary)]">
            Token created! Copy it now — it won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-[var(--theme-bg-overlay)] px-2 py-1 text-xs text-[var(--theme-text-primary)]">
              {revealedSecret}
            </code>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { navigator.clipboard.writeText(revealedSecret); }}
            >
              Copy
            </Button>
          </div>
          <button
            className="mt-2 text-[10px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]"
            onClick={() => setRevealedSecret(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Token list */}
      {tokens.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--theme-text-muted)]">
          No agent tokens created yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[var(--theme-text-secondary)]">
            Active Tokens ({tokens.length})
          </label>
          {tokens.map((token) => (
            <div
              key={token.id}
              className="flex items-center gap-3 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2"
            >
              <div className="flex-1">
                <span className="text-sm font-medium text-[var(--theme-text-primary)]">{token.name}</span>
                <span className="ml-2 text-xs text-[var(--theme-text-muted)]">{token.prefix}...</span>
              </div>
              {token.lastUsedAt && (
                <span className="text-[10px] text-[var(--theme-text-muted)]">
                  Last used {new Date(token.lastUsedAt).toLocaleDateString()}
                </span>
              )}
              <button
                className="text-xs text-[var(--theme-danger)] hover:underline"
                onClick={() => handleDelete(token.id)}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


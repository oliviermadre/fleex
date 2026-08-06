import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useSettingsStore, type AppSettings, type PinnedIcon, type WorkspaceAction } from '../../stores/settingsStore';
import { useUIStore, type SettingsTab } from '../../stores/uiStore';
import { useDragReorder } from '../../hooks/useDragReorder';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AppearanceTab } from './AppearanceTab';
import { DeliverableTypesTab } from './DeliverableTypesTab';
import { cn } from '../../lib/cn';
import type { AgentToken } from '@fleex/shared';
import { DEFAULT_AGENT_MAX_TURNS, AGENT_MAX_TURNS_MIN, AGENT_MAX_TURNS_MAX } from '@fleex/shared';
import * as api from '../../services/api';

const tabLabels: Record<SettingsTab, string> = {
  general: 'General',
  appearance: 'Appearance',
  'pinned-icons': 'Pinned Icons',
  'workspace-actions': 'Workspace Actions',
  'agent-tokens': 'Agent Tokens',
  'deliverable-types': 'Deliverable Types',
};

export function SettingsPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const settingsTab = useUIStore((s) => s.settingsTab);

  const [basePath, setBasePath] = useState('');
  const [humanDisplayName, setHumanDisplayName] = useState('');
  const [humanMentionName, setHumanMentionName] = useState('');
  const [agentMaxConcurrency, setAgentMaxConcurrency] = useState(1);
  const [agentMaxTurns, setAgentMaxTurns] = useState(DEFAULT_AGENT_MAX_TURNS);
  const [pinnedIcons, setPinnedIcons] = useState<PinnedIcon[]>([]);
  const [workspaceActions, setWorkspaceActions] = useState<WorkspaceAction[]>([]);

  useEffect(() => {
    setBasePath(settings.basePath);
    setHumanDisplayName((settings as unknown as Record<string, unknown>)['humanDisplayName'] as string ?? '');
    setHumanMentionName((settings as unknown as Record<string, unknown>)['humanMentionName'] as string ?? '');
    setAgentMaxConcurrency(settings.agentMaxConcurrency ?? 1);
    setAgentMaxTurns(settings.agentMaxTurns ?? DEFAULT_AGENT_MAX_TURNS);
    setPinnedIcons(settings.pinnedIcons.map((i) => ({ ...i })));
    setWorkspaceActions((settings.workspaceActions ?? []).map((a) => ({ ...a })));
  }, [settings]);

  const handleSave = async () => {
    await saveSettings({
      basePath,
      pinnedIcons,
      workspaceActions,
      ...(humanDisplayName.trim() ? { humanDisplayName: humanDisplayName.trim() } : { humanDisplayName: undefined }),
      ...(humanMentionName.trim() ? { humanMentionName: humanMentionName.trim() } : { humanMentionName: undefined }),
      agentMaxConcurrency,
      agentMaxTurns,
    } as Partial<AppSettings> & Record<string, unknown>);
  };

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

  const addWorkspaceAction = () => {
    setWorkspaceActions([
      ...workspaceActions,
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

  const updateWorkspaceAction = (index: number, patch: Partial<WorkspaceAction>) => {
    setWorkspaceActions((prev) =>
      prev.map((action, i) => (i === index ? { ...action, ...patch } : action))
    );
  };

  const removeWorkspaceAction = (index: number) => {
    setWorkspaceActions((prev) => prev.filter((_, i) => i !== index));
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
              agentMaxTurns={agentMaxTurns}
              setAgentMaxTurns={setAgentMaxTurns}
            />
          )}
          {settingsTab === 'appearance' && <AppearanceTab />}
          {settingsTab === 'pinned-icons' && (
            <PinnedIconsTab
              pinnedIcons={pinnedIcons}
              onAdd={addPinnedIcon}
              onUpdate={updatePinnedIcon}
              onRemove={removePinnedIcon}
              onReorder={setPinnedIcons}
            />
          )}
          {settingsTab === 'workspace-actions' && (
            <WorkspaceActionsTab
              workspaceActions={workspaceActions}
              onAdd={addWorkspaceAction}
              onUpdate={updateWorkspaceAction}
              onRemove={removeWorkspaceAction}
              onReorder={setWorkspaceActions}
            />
          )}
          {settingsTab === 'agent-tokens' && <AgentTokensTab />}
          {settingsTab === 'deliverable-types' && <DeliverableTypesTab />}

          {/* Save button — hidden for tabs that persist changes immediately. */}
          {settingsTab !== 'deliverable-types' && (
            <div className="mt-8 flex justify-end">
              <Button variant="primary" onClick={handleSave}>
                Save Settings
              </Button>
            </div>
          )}
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
  agentMaxTurns,
  setAgentMaxTurns,
}: {
  basePath: string;
  setBasePath: (v: string) => void;
  humanDisplayName: string;
  setHumanDisplayName: (v: string) => void;
  humanMentionName: string;
  setHumanMentionName: (v: string) => void;
  agentMaxConcurrency: number;
  setAgentMaxConcurrency: (v: number) => void;
  agentMaxTurns: number;
  setAgentMaxTurns: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Input
        id="basePath"
        label="Base Path"
        placeholder="/home/user/repos"
        value={basePath}
        onChange={(e) => setBasePath(e.target.value)}
        disabled
        readOnly
      />
      <p className="text-xs text-[var(--theme-text-muted)]">
        Base directory for repositories (stored as{' '}
        <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">
          basePath/orgName/repoName
        </code>
        ). Managed per workspace in{' '}
        <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">
          ~/.fleex/workspaces.json
        </code>
        — edit it there, then restart the workspace.
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

      <div className="mt-4 border-t border-[var(--theme-border)] pt-4">
        <Input
          id="agentMaxTurns"
          label="Max Agent Turns"
          type="number"
          min={AGENT_MAX_TURNS_MIN}
          max={AGENT_MAX_TURNS_MAX}
          value={String(agentMaxTurns)}
          onChange={(e) =>
            setAgentMaxTurns(
              Math.min(
                AGENT_MAX_TURNS_MAX,
                Math.max(AGENT_MAX_TURNS_MIN, parseInt(e.target.value, 10) || DEFAULT_AGENT_MAX_TURNS),
              ),
            )
          }
        />
        <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
          How many conversation turns (assistant round-trips) an agent may take in a single{' '}
          <strong>plan</strong> or <strong>edit</strong> execution before the SDK stops it — not a count of
          individual tool calls. A single turn can bundle several tool calls the model runs in parallel (e.g.
          reading many files at once), so you may see more tool actions in the log than this number. Raise it
          for long refactors, lower it to cap runaway loops. Default{' '}
          <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">
            {DEFAULT_AGENT_MAX_TURNS}
          </code>
          . Each execution reports its actual usage as <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">turns used / budget</code>{' '}
          in the Execution Log, so you can size this from real runs. Talk mode is unaffected — it has no
          agentic loop.
        </p>
      </div>
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
  const { dragOverId, dropEdge, getDragProps } = useDragReorder({
    items: pinnedIcons,
    onReorder,
    mimeType: 'application/x-pinned-icon',
  });

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
          <div key={icon.id} {...getDragProps(icon.id)} className="relative">
            {dragOverId === icon.id && dropEdge === 'top' && (
              <div className="absolute -top-1.5 left-0 right-0 h-0.5 rounded bg-[var(--theme-accent)]" />
            )}
            <SettingsActionEditor
              item={icon}
              onUpdate={(patch) => onUpdate(i, patch)}
              onRemove={() => onRemove(i)}
              labelPlaceholder="My Shortcut"
              urlValuePlaceholder="https://example.com"
              shellValuePlaceholder={'echo "Hello"\nls -la'}
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

function WorkspaceActionsTab({
  workspaceActions,
  onAdd,
  onUpdate,
  onRemove,
  onReorder,
}: {
  workspaceActions: WorkspaceAction[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<WorkspaceAction>) => void;
  onRemove: (index: number) => void;
  onReorder: (actions: WorkspaceAction[]) => void;
}) {
  const { dragOverId, dropEdge, getDragProps } = useDragReorder({
    items: workspaceActions,
    onReorder,
    mimeType: 'application/x-workspace-action',
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-[var(--theme-text-secondary)]">
          Workspace Actions ({workspaceActions.length})
        </label>
        <Button variant="secondary" size="sm" onClick={onAdd}>
          + Add Action
        </Button>
      </div>

      <p className="text-xs text-[var(--theme-text-muted)]">
        Actions appear as icon buttons in ticket and session headers. Template variables resolve to the ticket's workspace.
        {workspaceActions.length > 1 && ' Drag to reorder.'}
      </p>

      {workspaceActions.length === 0 && (
        <p className="py-6 text-center text-sm text-[var(--theme-text-muted)]">
          No workspace actions configured. Add one to show action buttons on every ticket.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {workspaceActions.map((action, i) => (
          <div key={action.id} {...getDragProps(action.id)} className="relative">
            {dragOverId === action.id && dropEdge === 'top' && (
              <div className="absolute -top-1.5 left-0 right-0 h-0.5 rounded bg-[var(--theme-accent)]" />
            )}
            <SettingsActionEditor
              item={action}
              onUpdate={(patch) => onUpdate(i, patch)}
              onRemove={() => onRemove(i)}
              labelPlaceholder="Open Branch on GitHub"
              urlValuePlaceholder="https://example.com/?ws={{workspace_name}}"
              shellValuePlaceholder={'open -a "PhpStorm" "{{workspace_path}}"'}
              actionValueHelper={
                <p className="text-xs text-[var(--theme-text-muted)]">
                  Use {'{{template}}'} variables above. They resolve to the ticket's workspace at click time.
                </p>
              }
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
            ['{{workspace_path}}', "Workspace folder absolute path"],
            ['{{workspace_name}}', 'Workspace folder name (id-slug)'],
            ['{{ticket_id}}', 'Full ticket id'],
            ['{{ticket_slug}}', 'Slugified ticket title'],
            ['{{ticket_display_id}}', 'Ticket display number'],
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

type EditableActionItem = {
  icon: string;
  iconType: 'svg' | 'base64' | 'path' | 'url';
  label: string;
  actionType: 'url' | 'shell';
  actionValue: string;
};

/**
 * Shared editor for Pinned Icons and Workspace Actions — the two share an
 * identical shape. Only the placeholders and the optional action-value helper
 * differ between callers, so they are passed as props.
 */
function SettingsActionEditor({
  item,
  onUpdate,
  onRemove,
  labelPlaceholder,
  urlValuePlaceholder,
  shellValuePlaceholder,
  actionValueHelper,
}: {
  item: EditableActionItem;
  onUpdate: (patch: Partial<EditableActionItem>) => void;
  onRemove: () => void;
  labelPlaceholder: string;
  urlValuePlaceholder: string;
  shellValuePlaceholder: string;
  actionValueHelper?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(!item.label);

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
          {item.label || 'Untitled'}
        </span>
        <span className="rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] text-[var(--theme-text-muted)]">
          {item.actionType}
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
            placeholder={labelPlaceholder}
            value={item.label}
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
                      item.iconType === type
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
                item.iconType === 'svg'
                  ? '<svg>...</svg>'
                  : item.iconType === 'base64'
                    ? 'iVBORw0KGgo...'
                    : item.iconType === 'url'
                      ? 'https://example.com/icon.svg'
                      : '/path/to/icon.svg'
              }
              value={item.icon}
              onChange={(e) => onUpdate({ icon: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--theme-text-secondary)]">Action Type</label>
            <div className="flex gap-0.5 rounded-md bg-[var(--theme-bg-overlay)] p-0.5">
              <button
                className={cn(
                  'flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                  item.actionType === 'url'
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
                  item.actionType === 'shell'
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
              rows={item.actionType === 'shell' ? 4 : 2}
              placeholder={item.actionType === 'url' ? urlValuePlaceholder : shellValuePlaceholder}
              value={item.actionValue}
              onChange={(e) => onUpdate({ actionValue: e.target.value })}
            />
            {actionValueHelper}
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


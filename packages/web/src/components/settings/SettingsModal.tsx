import { useState, useEffect } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore, type PinnedIcon } from '../../stores/settingsStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { cn } from '../../lib/cn';

type SettingsTab = 'general' | 'repositories' | 'pinned-icons';

export function SettingsModal() {
  const open = useUIStore((s) => s.settingsModalOpen);
  const closeModal = useUIStore((s) => s.closeSettingsModal);
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const resolveRepositories = useSettingsStore((s) => s.resolveRepositories);
  const resolving = useSettingsStore((s) => s.resolving);

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [basePath, setBasePath] = useState('');
  const [repoPatterns, setRepoPatterns] = useState('');
  const [pinnedIcons, setPinnedIcons] = useState<PinnedIcon[]>([]);

  useEffect(() => {
    if (open) {
      setBasePath(settings.basePath);
      setRepoPatterns(settings.repositories.join('\n'));
      setPinnedIcons(settings.pinnedIcons.map((i) => ({ ...i })));
    }
  }, [open, settings]);

  const handleSave = async () => {
    const repos = repoPatterns
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    await saveSettings({
      basePath,
      repositories: repos,
      pinnedIcons,
    });
    closeModal();
  };

  const handleResolve = () => {
    const repos = repoPatterns
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    saveSettings({ repositories: repos }).then(() => resolveRepositories());
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

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'general', label: 'General' },
    { key: 'repositories', label: 'Repositories' },
    { key: 'pinned-icons', label: 'Pinned Icons' },
  ];

  return (
    <Modal open={open} onClose={closeModal} className="max-w-2xl">
      <h2 className="mb-4 text-lg font-semibold text-zinc-100">Settings</h2>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-md bg-zinc-800 p-0.5">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={cn(
              'flex-1 rounded px-3 py-1 text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-300'
            )}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-[300px]">
        {activeTab === 'general' && (
          <GeneralTab basePath={basePath} setBasePath={setBasePath} />
        )}
        {activeTab === 'repositories' && (
          <RepositoriesTab
            repoPatterns={repoPatterns}
            setRepoPatterns={setRepoPatterns}
            resolvedRepositories={settings.resolvedRepositories}
            resolvedAt={settings.resolvedAt}
            resolving={resolving}
            onResolve={handleResolve}
          />
        )}
        {activeTab === 'pinned-icons' && (
          <PinnedIconsTab
            pinnedIcons={pinnedIcons}
            onAdd={addPinnedIcon}
            onUpdate={updatePinnedIcon}
            onRemove={removePinnedIcon}
          />
        )}
      </div>

      {/* Actions */}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={closeModal}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave}>
          Save Settings
        </Button>
      </div>
    </Modal>
  );
}

function GeneralTab({
  basePath,
  setBasePath,
}: {
  basePath: string;
  setBasePath: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Input
        id="basePath"
        label="Base Path"
        placeholder="/home/user/repos"
        value={basePath}
        onChange={(e) => setBasePath(e.target.value)}
      />
      <p className="text-[11px] text-zinc-500">
        Base directory for repositories. Repos are stored as{' '}
        <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-400">
          basePath/orgName/repoName
        </code>
      </p>
    </div>
  );
}

function RepositoriesTab({
  repoPatterns,
  setRepoPatterns,
  resolvedRepositories,
  resolvedAt,
  resolving,
  onResolve,
}: {
  repoPatterns: string;
  setRepoPatterns: (v: string) => void;
  resolvedRepositories: string[];
  resolvedAt: string | null;
  resolving: boolean;
  onResolve: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-400">
          Repository Patterns
        </label>
        <textarea
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-[#D77655] focus:outline-none focus:ring-1 focus:ring-[#D77655]"
          rows={5}
          placeholder={"odys-travel/*\nmyorg/specific-repo\nanother-org/*"}
          value={repoPatterns}
          onChange={(e) => setRepoPatterns(e.target.value)}
        />
        <p className="text-[11px] text-zinc-500">
          One pattern per line. Use <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-400">org/*</code> to
          include all repos from an organization.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onResolve}
          disabled={resolving}
        >
          {resolving ? 'Resolving...' : 'Resolve Patterns'}
        </Button>
        {resolvedAt && (
          <span className="text-[11px] text-zinc-500">
            Last resolved: {new Date(resolvedAt).toLocaleString()}
          </span>
        )}
      </div>

      {resolvedRepositories.length > 0 && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400">
            Resolved Repositories ({resolvedRepositories.length})
          </label>
          <div className="max-h-32 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-2">
            {resolvedRepositories.map((repo) => (
              <div key={repo} className="text-[11px] text-zinc-400 py-0.5">
                {repo}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PinnedIconsTab({
  pinnedIcons,
  onAdd,
  onUpdate,
  onRemove,
}: {
  pinnedIcons: PinnedIcon[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<PinnedIcon>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-zinc-400">
          Pinned Icons ({pinnedIcons.length})
        </label>
        <Button variant="secondary" size="sm" onClick={onAdd}>
          + Add Icon
        </Button>
      </div>

      {pinnedIcons.length === 0 && (
        <p className="py-4 text-center text-xs text-zinc-500">
          No pinned icons configured. Add one to pin it to the top of the sidebar.
        </p>
      )}

      <div className="flex max-h-[300px] flex-col gap-2 overflow-y-auto">
        {pinnedIcons.map((icon, i) => (
          <PinnedIconEditor
            key={icon.id}
            icon={icon}
            onUpdate={(patch) => onUpdate(i, patch)}
            onRemove={() => onRemove(i)}
          />
        ))}
      </div>
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
    <div className="rounded-md border border-zinc-800 bg-zinc-900/50">
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          className="text-zinc-500 hover:text-zinc-300"
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
        <span className="flex-1 truncate text-xs text-zinc-300">
          {icon.label || 'Untitled'}
        </span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {icon.actionType}
        </span>
        <button
          className="text-zinc-600 transition-colors hover:text-red-400"
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
        <div className="flex flex-col gap-3 border-t border-zinc-800 px-3 py-3">
          <Input
            label="Label"
            placeholder="My Shortcut"
            value={icon.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
          />

          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-xs font-medium text-zinc-400">Icon Type</label>
              <div className="flex gap-0.5 rounded-md bg-zinc-800 p-0.5">
                {(['svg', 'base64', 'url', 'path'] as const).map((type) => (
                  <button
                    key={type}
                    className={cn(
                      'flex-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                      icon.iconType === type
                        ? 'bg-zinc-700 text-zinc-200'
                        : 'text-zinc-500 hover:text-zinc-400'
                    )}
                    onClick={() => onUpdate({ iconType: type })}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-400">Icon Value</label>
            <textarea
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-[#D77655] focus:outline-none focus:ring-1 focus:ring-[#D77655]"
              rows={2}
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

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-400">Action Type</label>
            <div className="flex gap-0.5 rounded-md bg-zinc-800 p-0.5">
              <button
                className={cn(
                  'flex-1 rounded px-3 py-1 text-xs font-medium transition-colors',
                  icon.actionType === 'url'
                    ? 'bg-zinc-700 text-zinc-200'
                    : 'text-zinc-500 hover:text-zinc-400'
                )}
                onClick={() => onUpdate({ actionType: 'url' })}
              >
                Open URL
              </button>
              <button
                className={cn(
                  'flex-1 rounded px-3 py-1 text-xs font-medium transition-colors',
                  icon.actionType === 'shell'
                    ? 'bg-zinc-700 text-zinc-200'
                    : 'text-zinc-500 hover:text-zinc-400'
                )}
                onClick={() => onUpdate({ actionType: 'shell' })}
              >
                Shell Command
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-400">Action Value</label>
            <textarea
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-[#D77655] focus:outline-none focus:ring-1 focus:ring-[#D77655]"
              rows={icon.actionType === 'shell' ? 3 : 1}
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

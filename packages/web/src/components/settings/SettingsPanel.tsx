import { useState, useEffect } from 'react';
import { useSettingsStore, type AppSettings } from '../../stores/settingsStore';
import { useUIStore, type SettingsTab } from '../../stores/uiStore';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AppearanceTab } from './AppearanceTab';
import { DeliverableTypesTab } from './DeliverableTypesTab';
import { MemoryTab } from './MemoryTab';
import { ConnectorsTab } from './ConnectorsTab';
import { ActionsTab } from './actions/ActionsTab';
import type { AgentToken } from '@fleex/shared';
import {
  DEFAULT_AGENT_MAX_TURNS,
  AGENT_MAX_TURNS_MIN,
  AGENT_MAX_TURNS_MAX,
  DEFAULT_AGENT_EXECUTION_TIMEOUT_MINUTES,
  AGENT_EXECUTION_TIMEOUT_MIN_MINUTES,
  AGENT_EXECUTION_TIMEOUT_MAX_MINUTES,
  MS_IN_MINUTE,
} from '@fleex/shared';
import * as api from '../../services/api';

const tabLabels: Record<SettingsTab, string> = {
  general: 'General',
  appearance: 'Appearance',
  actions: 'Actions',
  'agent-tokens': 'Agent Tokens',
  'deliverable-types': 'Deliverable Types',
  memory: 'Memory',
  connectors: 'Connectors',
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
  const [agentTimeoutMinutes, setAgentTimeoutMinutes] = useState(DEFAULT_AGENT_EXECUTION_TIMEOUT_MINUTES);

  useEffect(() => {
    setBasePath(settings.basePath);
    setHumanDisplayName((settings as unknown as Record<string, unknown>)['humanDisplayName'] as string ?? '');
    setHumanMentionName((settings as unknown as Record<string, unknown>)['humanMentionName'] as string ?? '');
    setAgentMaxConcurrency(settings.agentMaxConcurrency ?? 1);
    setAgentMaxTurns(settings.agentMaxTurns ?? DEFAULT_AGENT_MAX_TURNS);
    setAgentTimeoutMinutes(
      settings.agentExecutionTimeout
        ? Math.round(settings.agentExecutionTimeout / MS_IN_MINUTE)
        : DEFAULT_AGENT_EXECUTION_TIMEOUT_MINUTES,
    );
  }, [settings]);

  const handleSave = async () => {
    await saveSettings({
      basePath,
      ...(humanDisplayName.trim() ? { humanDisplayName: humanDisplayName.trim() } : { humanDisplayName: undefined }),
      ...(humanMentionName.trim() ? { humanMentionName: humanMentionName.trim() } : { humanMentionName: undefined }),
      agentMaxConcurrency,
      agentMaxTurns,
      agentExecutionTimeout: agentTimeoutMinutes * MS_IN_MINUTE,
    } as Partial<AppSettings> & Record<string, unknown>);
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
        <div className={settingsTab === 'actions' ? 'max-w-6xl' : 'max-w-4xl'}>
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
              agentTimeoutMinutes={agentTimeoutMinutes}
              setAgentTimeoutMinutes={setAgentTimeoutMinutes}
            />
          )}
          {settingsTab === 'appearance' && <AppearanceTab />}
          {settingsTab === 'actions' && <ActionsTab />}
          {settingsTab === 'agent-tokens' && <AgentTokensTab />}
          {settingsTab === 'deliverable-types' && <DeliverableTypesTab />}
          {settingsTab === 'memory' && <MemoryTab />}
          {settingsTab === 'connectors' && <ConnectorsTab />}

          {/* Save button — hidden for tabs that persist changes immediately. */}
          {settingsTab !== 'deliverable-types' && settingsTab !== 'memory' && settingsTab !== 'connectors' && settingsTab !== 'actions' && (
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
  agentTimeoutMinutes,
  setAgentTimeoutMinutes,
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
  agentTimeoutMinutes: number;
  setAgentTimeoutMinutes: (v: number) => void;
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

      <div className="mt-4 border-t border-[var(--theme-border)] pt-4">
        <Input
          id="agentExecutionTimeout"
          label="Execution Timeout (minutes)"
          type="number"
          min={AGENT_EXECUTION_TIMEOUT_MIN_MINUTES}
          max={AGENT_EXECUTION_TIMEOUT_MAX_MINUTES}
          value={String(agentTimeoutMinutes)}
          onChange={(e) =>
            setAgentTimeoutMinutes(
              Math.min(
                AGENT_EXECUTION_TIMEOUT_MAX_MINUTES,
                Math.max(
                  AGENT_EXECUTION_TIMEOUT_MIN_MINUTES,
                  parseInt(e.target.value, 10) || DEFAULT_AGENT_EXECUTION_TIMEOUT_MINUTES,
                ),
              ),
            )
          }
        />
        <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
          Maximum wall-clock time a single agent or skill execution may run before Fleex aborts it. The clock
          starts once the run has its execution slot, so time spent queued behind other agents does not count.
          A timed-out run is marked interrupted and its mention goes back to pending. Default{' '}
          <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">
            {DEFAULT_AGENT_EXECUTION_TIMEOUT_MINUTES}
          </code>{' '}
          minutes.
        </p>
      </div>
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


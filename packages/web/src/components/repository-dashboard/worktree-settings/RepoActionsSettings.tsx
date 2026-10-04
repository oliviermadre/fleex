import { useEffect, useMemo, useState } from 'react';
import { listConfigKeys } from '@fleex/shared';
import * as api from '../../../services/api';
import { buildWorkspaceContext } from '../../../lib/templateUtils';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTicketStore } from '../../../stores/ticketStore';
import { useWorkStore } from '../../../stores/workStore';
import { Select } from '../../ui/Select';
import { LifecycleStrip, StepEditor, initialDraft, type StepDrafts, type StepKey } from './Lifecycle';
import { CommandsFilterBar, DetectedCommands, Options, RepoActions, type CommandsFilter } from './Sections';
import { cn } from '../../../lib/cn';
import { CARD, Hint, Warn } from './parts';
import { useWorktreeSettings } from './useWorktreeSettings';

interface WorktreeOption {
  path: string;
  branch: string;
  isMain: boolean;
}

/**
 * The worktree a repo's settings read `.fleex/worktree.json` from (and test
 * in): the open ticket's worktree of this repo when there is one, else the
 * first linked worktree, else the main checkout.
 */
function pickDefault(options: WorktreeOption[], ticketWorkspace: string | null): string | null {
  if (options.length === 0) return null;
  const inTicket = ticketWorkspace ? options.find((o) => o.path.startsWith(`${ticketWorkspace}/`)) : undefined;
  return (inTicket ?? options.find((o) => !o.isMain) ?? options[0]!).path;
}

/**
 * Settings › repo › Config › Actions et Hooks, in three tabs:
 *   - Cycle de vie: checkout (overlay → file hooks → setup), server (mode,
 *     start · logs · stop · status, left click), teardown (stop → script);
 *   - Commandes: one filtered list of the repo's actions and detected commands;
 *   - Options: sources, ports, hooks timeout.
 * Everything shows where it lives (Perso / Partagé) and moves with one click.
 */
export function RepoActionsSettings({ org, name }: { org: string; name: string }) {
  const repo = `${org}/${name}`;
  const [worktrees, setWorktrees] = useState<WorktreeOption[] | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const basePath = useSettingsStore((s) => s.settings.basePath);
  const workTicketId = useWorkStore((s) => s.selectedTicketId);
  const ticket = useTicketStore((s) => (workTicketId ? s.tickets.find((t) => t.id === workTicketId) ?? null : null));
  const ticketWorkspace = useMemo(() => (ticket && basePath ? buildWorkspaceContext(ticket, basePath).workspace_path : null), [ticket, basePath]);

  useEffect(() => {
    let cancelled = false;
    setWorktrees(null);
    api.fetchWorktrees(org, name)
      .then((list) => {
        if (cancelled) return;
        // Only checkouts Fleex manages (under its base path) can be read and written from here.
        const managed = (p: string) => !basePath || p.startsWith(`${basePath.replace(/\/$/, '')}/`);
        const options = list.filter((w) => !w.isBare && managed(w.path)).map((w) => ({ path: w.path, branch: w.branch, isMain: w.isMain }));
        setWorktrees(options);
        setPath(pickDefault(options, ticketWorkspace));
      })
      .catch(() => {
        if (!cancelled) setWorktrees([]);
      });
    return () => {
      cancelled = true;
    };
  }, [org, name, ticketWorkspace, basePath]);

  if (worktrees === null) return <div className="text-xs text-[var(--theme-text-muted)]">Chargement…</div>;
  return <SettingsBody key={`${repo}@${path ?? ''}`} repo={repo} path={path} worktrees={worktrees} onPath={setPath} />;
}

function SettingsBody({ repo, path, worktrees, onPath }: { repo: string; path: string | null; worktrees: WorktreeOption[]; onPath: (p: string) => void }) {
  const settingsApi = useWorktreeSettings(repo, path);
  const [tab, setTab] = useState<'lifecycle' | 'commands' | 'options'>('lifecycle');
  const [step, setStep] = useState<StepKey>('server');
  const [filter, setFilter] = useState<CommandsFilter>({ query: '', source: 'all' });
  const [drafts, setDrafts] = useState<StepDrafts>({});
  const s = settingsApi.settings;

  if (settingsApi.loading && !s) return <div className="text-xs text-[var(--theme-text-muted)]">Chargement…</div>;
  if (!s) {
    return (
      <div className="space-y-2">
        <Warn>Impossible de lire les réglages{path ? ` de ${path}` : ''} : {settingsApi.error}</Warn>
        {worktrees.length > 1 && (
          <Select aria-label="Worktree courant" className="h-7 max-w-[320px] py-0 text-xs" options={worktrees.map((w) => ({ value: w.path, label: w.path }))} value={path ?? ''} onChange={(e) => onPath(e.target.value)} />
        )}
      </div>
    );
  }

  const sharedKeys = listConfigKeys(s.shared);
  const dirty = Object.fromEntries(
    (Object.keys(drafts) as (keyof StepDrafts)[]).map((k) => [k, drafts[k] !== undefined && JSON.stringify(drafts[k]) !== JSON.stringify(initialDraft(settingsApi, k))]),
  ) as Partial<Record<StepKey, boolean>>;

  return (
    <div className="space-y-4" data-testid="repo-actions-settings">
      <div className={CARD}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">Actions et Hooks</h3>
          <span className="text-[11px] text-[var(--theme-text-muted)]">Perso = dans Fleex · Partagé = <code className="font-mono">.fleex/worktree.json</code> du repo, à committer</span>
          <span className="flex-1" />
          {worktrees.length > 0 ? (
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--theme-text-muted)]">
              Worktree courant
              <Select
                aria-label="Worktree courant"
                className="h-7 max-w-[320px] py-0 text-xs"
                options={worktrees.map((w) => ({ value: w.path, label: `${w.branch || '(detached)'}${w.isMain ? ' · main' : ''} — ${w.path.split('/').slice(-2).join('/')}` }))}
                value={path ?? ''}
                onChange={(e) => onPath(e.target.value)}
              />
            </label>
          ) : (
            <span className="text-[11px] text-[var(--theme-text-muted)]">Aucun worktree : seuls tes réglages perso sont modifiables.</span>
          )}
        </div>
        {s.path && (
          <Hint>
            <code className="font-mono">.fleex/worktree.json</code> dans ce worktree : {s.shared ? `${sharedKeys.length} élément${sharedKeys.length > 1 ? 's' : ''} partagé${sharedKeys.length > 1 ? 's' : ''}` : 'absent'}
            {' '}— Fleex l&apos;écrit, ne le commit jamais. Chaque branche peut avoir le sien.
          </Hint>
        )}
        {s.sharedConfigError && <div className="mt-2"><Warn>⚠ {s.sharedConfigError} — corrige le fichier : Fleex ne le réécrira pas tant qu&apos;il est invalide.</Warn></div>}

        <div className="mt-3 flex gap-1 border-b border-[var(--theme-border)]" role="tablist" aria-label="Actions et Hooks">
          {([['lifecycle', 'Cycle de vie'], ['commands', 'Commandes'], ['options', 'Options']] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              data-testid={`tab-${k}`}
              onClick={() => setTab(k)}
              className={cn('-mb-px border-b-2 px-3 py-1.5 text-xs', tab === k ? 'border-[var(--theme-accent)] font-semibold text-[var(--theme-text-primary)]' : 'border-transparent text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]')}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'lifecycle' && (
          <>
            <div className="mt-3">
              <LifecycleStrip api={settingsApi} step={step} onStep={setStep} dirty={dirty} />
            </div>
            <div className="mt-3 rounded-lg border border-[var(--theme-border)] p-3">
              <StepEditor
                api={settingsApi}
                step={step}
                draft={drafts[step as keyof StepDrafts]}
                setDraft={(d) => setDrafts((all) => ({ ...all, [step]: d }))}
              />
            </div>
          </>
        )}
        {tab === 'commands' && (
          <div className="mt-3">
            <Hint>Tout ce que le menu du worktree propose : tes actions (perso ou partagées) et les commandes détectées dans le repo.</Hint>
            <CommandsFilterBar api={settingsApi} filter={filter} onFilter={setFilter} />
          </div>
        )}
      </div>
      {tab === 'commands' && (
        <>
          <RepoActions api={settingsApi} filter={filter} />
          <DetectedCommands api={settingsApi} filter={filter} />
        </>
      )}
      {tab === 'options' && <Options api={settingsApi} />}
    </div>
  );
}

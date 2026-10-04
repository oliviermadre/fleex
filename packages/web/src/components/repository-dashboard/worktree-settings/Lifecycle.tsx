import { useState } from 'react';
import {
  DEFAULT_WORKTREE_CLICK,
  WORKTREE_SERVER_STATES,
  WORKTREE_VERBS,
  getConfigKey,
  parseProbeEndpoints,
  worktreeSourceId,
  type WorktreeClickChoice,
  type WorktreeConfigKey,
  type WorktreeServerMode,
  type WorktreeServerState,
} from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { tintText } from '../../../lib/tints';
import * as api from '../../../services/api';
import { useWorktreeActionsStore } from '../../../stores/worktreeActionsStore';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Select';
import { OverlaySyncModal } from '../../overlay-sync/OverlaySyncModal';
import { CODE_INPUT, TEXT_INPUT } from '../../settings/actions/shared';
import { STATE_LABEL, stateDotClass } from '../../worktree-actions/worktreeUi';
import { EnvHelp, FieldLabel, Hint, RunResult, ScopeBadge, Warn, scopeOf } from './parts';
import type { WorktreeSettingsApi } from './useWorktreeSettings';

export type StepKey = 'checkout' | 'server' | 'teardown';

/** The three moments of a worktree's life, in the order they happen. */
export const STEPS: { key: StepKey; title: string; when: string; keys: WorktreeConfigKey[] }[] = [
  { key: 'checkout', title: 'Au checkout', when: 'overlay · hooks fichiers · setup', keys: ['hooks.setup'] },
  { key: 'server', title: 'Serveur', when: 'start · logs · stop · status', keys: ['server.mode', 'server.start', 'server.logs', 'server.stop', 'server.probe', 'server.url', 'server.clickByState'] },
  { key: 'teardown', title: 'Au teardown', when: 'stop du serveur · teardown', keys: ['hooks.teardown'] },
];

const SERVER_KEYS = STEPS[1]!.keys;

/** The effective value of a key: personal over shared. */
export function effective(api: WorktreeSettingsApi, key: WorktreeConfigKey): unknown {
  const s = api.settings;
  if (!s) return undefined;
  const p = getConfigKey(s.personal, key);
  return p !== undefined ? p : getConfigKey(s.shared, key);
}

/** The server's mode as shown: the configured one, else what Fleex guesses (a probe = detached). */
export function serverMode(api: WorktreeSettingsApi): WorktreeServerMode {
  const m = effective(api, 'server.mode') as WorktreeServerMode | undefined;
  if (m) return m;
  return (effective(api, 'server.probe') as { command?: string } | undefined)?.command ? 'detached' : 'foreground';
}

function scopeLabel(api: WorktreeSettingsApi, keys: WorktreeConfigKey[]): string {
  const scope = scopeOf(api, keys);
  return scope.layer === 'shared' ? 'partagé' : scope.layer === 'personal' ? 'perso' : '';
}

/** One line under a moment of the strip: what is configured, or "+ ajouter". */
function stepState(api: WorktreeSettingsApi, step: StepKey): { set: boolean; label: string } {
  const s = api.settings;
  if (!s) return { set: false, label: '' };
  if (step === 'checkout') {
    const parts = [
      s.overlayFiles.length ? `${s.overlayFiles.length} fichier${s.overlayFiles.length > 1 ? 's' : ''}` : '',
      s.fileHooks.global.length + s.fileHooks.repo.length ? 'hooks fichiers' : '',
      effective(api, 'hooks.setup') ? `setup ${scopeLabel(api, ['hooks.setup'])}` : '',
    ].filter(Boolean);
    return parts.length ? { set: true, label: `✓ ${parts.join(' · ')}` } : { set: false, label: '+ ajouter' };
  }
  if (step === 'server') {
    if (!effective(api, 'server.start')) return { set: false, label: '+ ajouter' };
    return { set: true, label: `✓ ${serverMode(api) === 'detached' ? 'détaché' : 'premier plan'} · ${scopeLabel(api, SERVER_KEYS)}` };
  }
  return effective(api, 'hooks.teardown') ? { set: true, label: `✓ teardown ${scopeLabel(api, ['hooks.teardown'])}` } : { set: false, label: '+ ajouter' };
}

/**
 * The worktree's life, from creation to removal, read at a glance: a moment
 * with a solid border is configured, a dashed one is not.
 */
export function LifecycleStrip({ api, step, onStep, dirty }: { api: WorktreeSettingsApi; step: StepKey; onStep: (s: StepKey) => void; dirty: Partial<Record<StepKey, boolean>> }) {
  return (
    <div className="flex items-stretch gap-1.5" role="tablist" aria-label="Cycle de vie du worktree">
      {STEPS.map((s, i) => {
        const state = stepState(api, s.key);
        const active = step === s.key;
        return (
          <div key={s.key} className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`step-${s.key}`}
              onClick={() => onStep(s.key)}
              className={cn(
                'relative flex min-w-0 flex-1 flex-col rounded-lg border px-2.5 py-2 text-left transition-colors',
                state.set ? 'border-solid' : 'border-dashed',
                active ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)]' : 'border-[var(--theme-border)] hover:border-[var(--theme-accent)]',
              )}
            >
              <span className="truncate text-xs font-semibold text-[var(--theme-text-primary)]">{i + 1}. {s.title}</span>
              <span className="truncate text-[10.5px] text-[var(--theme-text-muted)]">{s.when}</span>
              <span className={cn('mt-0.5 truncate text-[10.5px]', state.set ? tintText('green') : 'text-[var(--theme-accent)]')}>{state.label}</span>
              {dirty[s.key] && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--theme-accent)]" title="Modifications non enregistrées" />}
            </button>
            {i < STEPS.length - 1 && <span className="text-[var(--theme-text-faint)]" aria-hidden>→</span>}
          </div>
        );
      })}
    </div>
  );
}

/** The server commands that take a command of the repo (picked) or a custom one, alike. */
type PickedKey = 'start' | 'logs' | 'stop' | 'probe';
const PICKED_KEYS: PickedKey[] = ['start', 'logs', 'stop', 'probe'];

type ServerDraft = {
  mode: WorktreeServerMode;
  start: string;
  /** Per command: typed by hand (true) or one of the repo's commands, by id (false). */
  custom: Record<PickedKey, boolean>;
  logs: string;
  stop: string;
  probe: string;
  interval: string;
  url: string;
  click: Record<WorktreeServerState, WorktreeClickChoice>;
};

export type StepDrafts = {
  checkout?: string;
  teardown?: string;
  server?: ServerDraft;
};

export function initialDraft(api: WorktreeSettingsApi, step: StepKey): StepDrafts[keyof StepDrafts] {
  const str = (k: WorktreeConfigKey) => (effective(api, k) as string | undefined) ?? '';
  if (step === 'checkout') return str('hooks.setup');
  if (step === 'teardown') return str('hooks.teardown');
  const items = api.settings?.view?.items ?? [];
  const probe = effective(api, 'server.probe') as { command?: string; intervalSec?: number } | undefined;
  const values: Record<PickedKey, string> = { start: str('server.start'), logs: str('server.logs'), stop: str('server.stop'), probe: probe?.command ?? '' };
  const custom = Object.fromEntries(PICKED_KEYS.map((k) => [k, !!values[k] && !items.some((i) => i.id === values[k])])) as Record<PickedKey, boolean>;
  return {
    mode: serverMode(api),
    ...values,
    custom,
    interval: String(probe?.intervalSec ?? 30),
    url: str('server.url'),
    click: { ...DEFAULT_WORKTREE_CLICK, ...((effective(api, 'server.clickByState') as Record<string, WorktreeClickChoice> | undefined) ?? {}) },
  };
}

interface EditorProps {
  api: WorktreeSettingsApi;
  step: StepKey;
  draft: StepDrafts[keyof StepDrafts];
  setDraft: (d: StepDrafts[keyof StepDrafts] | undefined) => void;
}

const TEMPLATE_VARS = ['{{org}}', '{{repo}}', '{{branch}}', '{{worktree_path}}'];
const ENV_VARS = ['$FLEEX_WORKTREE_PATH', '$FLEEX_BRANCH', '$FLEEX_REPO', '$FLEEX_REPO_PATH', '$FLEEX_WORKSPACE_PATH', '$FLEEX_TICKET_ID', '$FLEEX_PORT', '$FLEEX_URL'];

function VarChips({ vars }: { vars: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {vars.map((v) => (
        <span key={v} className="rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--theme-text-muted)]">{v}</span>
      ))}
    </div>
  );
}

/** The editor of the selected step: its fields, Tester, Partager ↔ Garder pour moi, Save. */
export function StepEditor(props: EditorProps) {
  const { step } = props;
  if (step === 'checkout') {
    return (
      <div className="space-y-4">
        <OverlayStep api={props.api} />
        <div className="border-t border-[var(--theme-border)] pt-3"><HookStep {...props} hook="setup" /></div>
      </div>
    );
  }
  if (step === 'teardown') {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-3 py-2 text-[11px] text-[var(--theme-text-secondary)]" data-testid="teardown-stop">
          <span className="font-medium">a. Stop du serveur</span> — automatique, avant le script : Fleex lance la ligne <b>Stop</b> du serveur (ou ferme le terminal du Start), au plus 30 s.
        </div>
        <HookStep {...props} hook="teardown" />
      </div>
    );
  }
  return <ServerStep {...props} />;
}

function Footer({ api, keys, dirty, onSave, onRevert, children }: { api: WorktreeSettingsApi; keys: WorktreeConfigKey[]; dirty: boolean; onSave: () => void; onRevert: () => void; children?: React.ReactNode }) {
  const scope = scopeOf(api, keys);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--theme-border)] pt-3">
      {children}
      <span className="flex-1" />
      {scope.layer ? <ScopeBadge api={api} keys={keys} /> : <span className="text-[11px] text-[var(--theme-text-faint)]">Enregistré en perso, partageable ensuite</span>}
      {dirty && <Button size="sm" variant="ghost" onClick={onRevert}>Annuler</Button>}
      <Button size="sm" variant="primary" disabled={!dirty} onClick={onSave}>Enregistrer</Button>
    </div>
  );
}

function OverlayStep({ api }: { api: WorktreeSettingsApi }) {
  const [open, setOpen] = useState(false);
  const s = api.settings!;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <h4 className="text-sm font-semibold text-[var(--theme-text-primary)]">a. Overlay</h4>
        <span className="text-[11px] text-[var(--theme-text-muted)]">copié dans chaque nouveau worktree, juste après le checkout</span>
      </div>
      <Hint>Fleex seulement : ces fichiers (souvent des <code className="font-mono">.env</code>) peuvent contenir des secrets, ils ne vont jamais dans le fichier partagé.</Hint>
      <ul className="mt-2 flex flex-wrap gap-1">
        {s.overlayFiles.slice(0, 16).map((f) => (
          <li key={f} className="rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--theme-text-secondary)]">{f}</li>
        ))}
        {s.overlayFiles.length > 16 && <li className="text-[11px] text-[var(--theme-text-muted)]">+{s.overlayFiles.length - 16}</li>}
        {s.overlayFiles.length === 0 && <li className="text-[11px] text-[var(--theme-text-muted)]">Aucun fichier.</li>}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={!s.path} onClick={() => setOpen(true)} title={s.path ? undefined : 'Il faut un worktree pour capturer ses fichiers ignorés'}>Sync overlay…</Button>
      </div>
      {s.path && <OverlaySyncModal open={open} onClose={() => { setOpen(false); void api.reload(); }} rootPath={s.path} />}
    </div>
  );
}

function HookStep({ api, draft, setDraft, hook }: EditorProps & { hook: 'setup' | 'teardown' }) {
  const s = api.settings!;
  const key: WorktreeConfigKey = hook === 'setup' ? 'hooks.setup' : 'hooks.teardown';
  const saved = (effective(api, key) as string | undefined) ?? '';
  const value = (draft as string | undefined) ?? saved;
  const dirty = value !== saved;
  const [runId, setRunId] = useState<string | null>(null);
  const rerunSetup = useWorktreeActionsStore((st) => st.rerunSetup);
  const openHooksDir = useWorktreeActionsStore((st) => st.openHooksDir);
  const setup = s.view?.setup;
  const save = async () => {
    // Empty = not configured: the key leaves its layer (an explicit "none" would mask the team's).
    if (await api.write([[key, value.trim() ? value : undefined]])) setDraft(undefined);
  };
  return (
    <div>
      {hook === 'setup' && (
        <div className="mb-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-[var(--theme-text-secondary)]">b. Hooks fichiers</span>
            <span className="text-[10.5px] text-[var(--theme-text-muted)]">lancés avant le script, dans l&apos;ordre</span>
            <button type="button" className="ml-auto text-[11px] text-[var(--theme-accent)] hover:underline" onClick={() => void openHooksDir(s.repo)}>Ouvrir le dossier des hooks</button>
          </div>
          <ol className="mt-1 space-y-0.5">
            {[...s.fileHooks.global, ...s.fileHooks.repo].map((f) => (
              <li key={f} className="truncate font-mono text-[10.5px] text-[var(--theme-text-secondary)]">{f}</li>
            ))}
            {!s.fileHooks.global.length && !s.fileHooks.repo.length && <li className="text-[10.5px] text-[var(--theme-text-muted)]">Aucun — dépose des scripts dans {s.hooksDir}</li>}
          </ol>
        </div>
      )}
      <div className="flex items-baseline gap-2">
        <h4 className="text-sm font-semibold text-[var(--theme-text-primary)]">{hook === 'setup' ? 'c. Script Setup (ex post-checkout)' : 'b. Script Teardown'}</h4>
        <span className="text-[11px] text-[var(--theme-text-muted)]">
          {hook === 'setup' ? 'à la création du worktree, après l\'overlay — asynchrone, ne bloque ni les agents ni le worktree' : 'avant la suppression du worktree — attendu au plus le timeout, n\'empêche jamais la suppression'}
        </span>
      </div>
      <textarea
        aria-label={hook === 'setup' ? 'Script Setup' : 'Script Teardown'}
        className={cn(CODE_INPUT, 'mt-2 min-h-[110px]')}
        spellCheck={false}
        placeholder={hook === 'setup' ? 'pnpm install && make db-migrate' : 'docker compose down -v'}
        value={value}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="mt-1.5 space-y-1">
        <VarChips vars={ENV_VARS} />
        <VarChips vars={TEMPLATE_VARS} />
        <EnvHelp />
      </div>
      {hook === 'setup' && setup && (
        <p className={cn('mt-2 text-[11px]', setup.state === 'failed' ? tintText('red') : setup.state === 'ok' ? tintText('green') : 'text-[var(--theme-text-muted)]')}>
          Dernier setup sur ce worktree : {setup.state === 'running' ? 'en cours…' : setup.state === 'ok' ? 'réussi' : 'échoué'}
          {setup.error ? ` — ${setup.error.split('\n').pop()}` : ''}
        </p>
      )}
      {runId && s.path && <RunResult sourceId={worktreeSourceId(s.path)} runId={runId} onClose={() => setRunId(null)} />}
      <Footer api={api} keys={[key]} dirty={dirty} onSave={() => void save()} onRevert={() => setDraft(undefined)}>
        <Button size="sm" disabled={!s.path || !value.trim()} title={s.path ? 'Lance le script tel que tapé, sans l\'enregistrer' : 'Il faut un worktree'} onClick={async () => setRunId(await api.testHook(hook, value))}>
          ▶ Tester dans le worktree courant
        </Button>
        {hook === 'setup' && s.view && (
          <Button size="sm" variant="ghost" disabled={dirty} title={dirty ? 'Enregistre d\'abord' : 'Hooks fichiers puis script enregistré, comme à la création'} onClick={() => void rerunSetup(s.view!)}>
            ↻ Relancer le Setup complet
          </Button>
        )}
      </Footer>
    </div>
  );
}

const VERB_LABELS: Record<string, string> = { start: 'Start', stop: 'Stop', restart: 'Restart', open: 'Open (navigateur)', logs: 'Logs', status: 'Rafraîchir l\'état' };

/** One verb of the server: label, field, and what Fleex does when it is left empty. */
function VerbRow({ id, title, children, empty, warn }: { id: string; title: string; children: React.ReactNode; empty: string; warn?: string | null }) {
  return (
    <div className="grid gap-x-3 gap-y-1 border-t border-[var(--theme-border)] py-2.5 first:border-t-0 md:grid-cols-[110px_minmax(0,1fr)]" data-testid={`server-row-${id}`}>
      <div className="flex items-center gap-1 pt-1.5 text-xs font-semibold text-[var(--theme-text-primary)]">{title}<EnvHelp /></div>
      <div className="min-w-0 space-y-1">
        {children}
        {warn ? <Warn>⚠ {warn}</Warn> : <Hint>{empty}</Hint>}
      </div>
    </div>
  );
}

/**
 * A command of the repo (an action or a detected command, saved as its id) or a
 * custom one typed by hand. Start, Logs, Stop and Status all pick the same way.
 */
function CommandPicker({ id, label, value, custom, options, placeholder, onChange }: {
  id: string;
  label: string;
  value: string;
  custom: boolean;
  options: { value: string; label: string }[];
  placeholder: string;
  onChange: (value: string, custom: boolean) => void;
}) {
  return (
    <>
      <label htmlFor={id} className="sr-only">{label}</label>
      <Select
        id={id}
        className="h-8 text-xs"
        options={options}
        value={custom ? '__custom' : value}
        onChange={(e) => (e.target.value === '__custom' ? onChange(custom ? value : '', true) : onChange(e.target.value, false))}
      />
      {custom && (
        <input aria-label={`${label} (personnalisée)`} className={cn(TEXT_INPUT, 'font-mono text-xs')} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value, true)} />
      )}
    </>
  );
}

function ServerStep({ api, draft, setDraft }: EditorProps) {
  const s = api.settings!;
  const view = s.view;
  const items = view?.items ?? [];
  const saved = initialDraft(api, 'server') as ServerDraft;
  const d = (draft as ServerDraft | undefined) ?? saved;
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const runVerb = useWorktreeActionsStore((st) => st.runVerb);
  const patch = (p: Partial<ServerDraft>) => setDraft({ ...d, ...p });
  const [probe, setProbe] = useState<'loading' | { ok: boolean; text: string } | null>(null);
  const server = view?.server;
  const detached = d.mode === 'detached';

  const pick = (k: PickedKey) => (value: string, custom: boolean) => patch({ [k]: value, custom: { ...d.custom, [k]: custom } });
  // What runs for a picked command: the id resolves to its command, as on the server.
  const commandOf = (v: string) => items.find((i) => i.id === v)?.command ?? v;
  const targetOptions = [
    { value: '', label: '— non configuré —' },
    ...items.map((i) => ({ value: i.id, label: `${i.source === 'action' ? 'action' : i.id.split(':')[0]} · ${i.label} — ${i.command}` })),
    { value: '__custom', label: 'Commande personnalisée…' },
  ];
  const clickOptions = [
    ...WORKTREE_VERBS.map((v) => ({ value: v, label: VERB_LABELS[v] ?? v })),
    { value: 'menu', label: 'Ouvrir le menu' },
    ...items.map((i) => ({ value: i.id, label: `▶ ${i.label}` })),
  ];
  const save = async () => {
    const click = Object.fromEntries(WORKTREE_SERVER_STATES.filter((st) => d.click[st] !== DEFAULT_WORKTREE_CLICK[st]).map((st) => [st, d.click[st]]));
    const ok = await api.write([
      ['server.mode', d.mode],
      ['server.start', d.start.trim() || undefined],
      ['server.logs', d.logs.trim() || undefined],
      ['server.stop', d.stop.trim() || undefined],
      ['server.probe', d.probe.trim() ? { command: d.probe.trim(), intervalSec: Number(d.interval) || 30 } : undefined],
      ['server.url', d.url.trim() || undefined],
      ['server.clickByState', Object.keys(click).length ? click : undefined],
    ]);
    if (ok) setDraft(undefined);
  };
  const testProbe = async () => {
    setProbe('loading');
    // The probe runs in the worktree and sees the server's URL and port, like when Fleex runs it.
    const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
    const env = [
      s.path ? `FLEEX_WORKTREE_PATH=${q(s.path)}` : '',
      server?.url ? `FLEEX_URL=${q(server.url)}` : '',
      server?.port ? `FLEEX_PORT=${q(String(server.port))}` : '',
    ].filter(Boolean).join(' ');
    try {
      const res = await testProbeCommand(`${s.path ? `cd ${q(s.path)} && ` : ''}${env ? `export ${env}; ` : ''}${commandOf(d.probe)}`);
      // Same reading as Fleex: exit code = state, stdout = endpoints when it follows the contract.
      const endpoints = res.exitCode === 0 ? parseProbeEndpoints(res.stdout) : undefined;
      const verdict = res.exitCode === 0
        ? (endpoints ? `en marche · ${endpoints.length} endpoint${endpoints.length > 1 ? 's' : ''} :\n${endpoints.map((e) => `  ${e.primary ? '★ ' : '  '}${e.name}  ${e.url}`).join('\n')}` : 'en marche · pas d\'endpoints dans la sortie (Fleex garde le port détecté)')
        : `arrêté (exit ${res.exitCode})`;
      setProbe({ ok: res.exitCode === 0, text: [verdict, [res.stdout, res.stderr].filter(Boolean).join('\n')].filter(Boolean).join('\n\n') });
    } catch {
      setProbe(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-[var(--theme-text-primary)]">Serveur</h4>
        <div className="inline-flex overflow-hidden rounded-md border border-[var(--theme-border)]" role="radiogroup" aria-label="Mode du serveur">
          {(['foreground', 'detached'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={d.mode === m}
              onClick={() => patch({ mode: m })}
              className={cn('px-2.5 py-1 text-[11px]', d.mode === m ? 'bg-[var(--theme-accent-muted)] font-medium text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]')}
            >
              {m === 'foreground' ? 'Premier plan' : 'Détaché'}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-[var(--theme-text-muted)]">
          {detached
            ? 'la commande rend la main (docker compose up -d, fleex start) : Stop et Status sont à fournir'
            : 'la commande reste ouverte et affiche les logs (pnpm dev) : Fleex suit son process'}
        </span>
      </div>

      <div className="mt-2">
        <VerbRow id="start" title="Start" empty={detached ? 'Lancée en arrière-plan ; sa fin avec 0 veut dire « démarrage demandé ».' : 'Lancée dans un terminal persistant. Fleex trouve son port dans ses process.'} warn={!d.start.trim() ? 'Sans commande Start, le bouton du worktree ne peut pas démarrer le serveur.' : null}>
          <CommandPicker id="wt-start" label="Commande de démarrage" value={d.start} custom={d.custom.start} options={targetOptions} placeholder={detached ? './cli/fleex start' : 'pnpm dev'} onChange={pick('start')} />
        </VerbRow>

        <VerbRow id="logs" title="Logs" empty={d.logs.trim() ? 'Ouverte dans son propre terminal.' : 'Vide : Fleex montre le terminal du Start.'} warn={detached && !d.logs.trim() ? 'Détaché sans commande de logs : le terminal du Start n\'a que ses premières lignes.' : null}>
          <CommandPicker id="wt-logs" label="Commande de logs" value={d.logs} custom={d.custom.logs} options={targetOptions} placeholder={detached ? 'docker compose logs -f --tail 200  ·  ./cli/fleex logs' : '(facultatif)'} onChange={pick('logs')} />
        </VerbRow>

        <VerbRow id="stop" title="Stop" empty={d.stop.trim() ? 'Lancée, puis Fleex ferme le terminal du Start.' : 'Vide : Fleex ferme le terminal du Start.'} warn={detached && !d.stop.trim() ? 'Détaché sans commande Stop : Fleex ne sait pas arrêter ce serveur.' : null}>
          <CommandPicker id="wt-stop" label="Commande d'arrêt" value={d.stop} custom={d.custom.stop} options={targetOptions} placeholder={detached ? 'docker compose stop  ·  ./cli/fleex stop' : '(facultatif)'} onChange={pick('stop')} />
        </VerbRow>

        <VerbRow
          id="status"
          title="Status"
          empty={d.probe.trim() ? 'Code 0 = en marche, sinon arrêté (en erreur si le terminal du Start tourne encore). Sortie facultative : {"endpoints":[{"name","url" | "host"+"port","primary"?}]}, toute autre sortie est ignorée.' : 'Vide : Fleex détecte le port écouté par les process du Start.'}
          warn={detached && !d.probe.trim() ? 'Détaché sans probe : Fleex suppose que le serveur tourne, sans pouvoir le vérifier ni connaître son URL.' : null}
        >
          <CommandPicker id="wt-probe" label="Probe d'état" value={d.probe} custom={d.custom.probe} options={targetOptions} placeholder="curl -sf $FLEEX_URL/health" onChange={pick('probe')} />
          <div className="flex gap-1.5">
            <Select aria-label="Intervalle du probe" className="h-8 w-24 text-xs" options={['15', '30', '60', '300'].map((v) => ({ value: v, label: `${v} s` }))} value={d.interval} onChange={(e) => patch({ interval: e.target.value })} />
            <Button size="sm" disabled={!d.probe.trim() || probe === 'loading'} onClick={() => void testProbe()}>▶ Tester le probe</Button>
          </div>
          {probe && probe !== 'loading' && (
            <pre className={cn('max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--theme-bg-base)] p-2 font-mono text-[11px]', probe.ok ? tintText('green') : tintText('red'))}>{probe.ok ? '✓ ' : '✗ '}{probe.text}</pre>
          )}
          <input id="wt-url" aria-label="URL (Open)" className={cn(TEXT_INPUT, 'font-mono text-xs')} placeholder="URL de repli : http://localhost:${port}" value={d.url} onChange={(e) => patch({ url: e.target.value })} />
        </VerbRow>
      </div>

      <div className="mt-2 border-t border-[var(--theme-border)] pt-3">
        <FieldLabel>Clic gauche selon l&apos;état</FieldLabel>
        <div className="flex flex-col gap-1.5">
          {WORKTREE_SERVER_STATES.map((st) => (
            <div key={st} className="grid grid-cols-[110px_14px_minmax(0,1fr)] items-center gap-2.5">
              <span className="flex items-center gap-1.5 text-xs text-[var(--theme-text-secondary)]"><span className={cn('h-1.5 w-1.5 rounded-full', stateDotClass(st))} /> {STATE_LABEL[st]}</span>
              <span className="text-[var(--theme-text-faint)]">→</span>
              <Select aria-label={`Clic gauche quand ${STATE_LABEL[st]}`} className="h-7 py-0 text-xs" options={clickOptions} value={d.click[st]} onChange={(e) => patch({ click: { ...d.click, [st]: e.target.value } })} />
            </div>
          ))}
        </div>
        <Hint>Indépendant des épingles ★, qui ne font que classer le menu.</Hint>
      </div>
      <Footer api={api} keys={SERVER_KEYS} dirty={dirty} onSave={() => void save()} onRevert={() => setDraft(undefined)}>
        <Button size="sm" disabled={!view || dirty || !view.start} title={dirty ? 'Enregistre d\'abord' : undefined} onClick={() => view && void runVerb(view, 'start', null)}>
          ▶ Démarrer dans le worktree courant
        </Button>
      </Footer>
    </div>
  );
}

/** The probe tester of Settings › Actions (a background shell, timeout 10 s). */
function testProbeCommand(command: string) {
  return api.testPinnedProbe(command).then((r) => ({ exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }));
}

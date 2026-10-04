import { useState } from 'react';
import {
  DEFAULT_WORKTREE_CLICK,
  WORKTREE_SERVER_STATES,
  WORKTREE_VERBS,
  getConfigKey,
  worktreeSourceId,
  type WorktreeClickChoice,
  type WorktreeConfigKey,
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
import { FieldLabel, Hint, RunResult, ScopeBadge, scopeOf } from './parts';
import type { WorktreeSettingsApi } from './useWorktreeSettings';

export type StepKey = 'overlay' | 'setup' | 'start' | 'stop' | 'teardown';

export const STEPS: { key: StepKey; title: string; when: string; keys: WorktreeConfigKey[] }[] = [
  { key: 'overlay', title: 'Overlay', when: 'après le checkout', keys: [] },
  { key: 'setup', title: 'Setup', when: 'à la création', keys: ['hooks.setup'] },
  { key: 'start', title: 'Start', when: 'clic gauche quand arrêté', keys: ['server.start', 'server.url', 'server.clickByState'] },
  { key: 'stop', title: 'Stop · Status', when: 'verbes standard', keys: ['server.stop', 'server.probe'] },
  { key: 'teardown', title: 'Teardown', when: 'avant la suppression', keys: ['hooks.teardown'] },
];

/** The effective value of a key: personal over shared. */
export function effective(api: WorktreeSettingsApi, key: WorktreeConfigKey): unknown {
  const s = api.settings;
  if (!s) return undefined;
  const p = getConfigKey(s.personal, key);
  return p !== undefined ? p : getConfigKey(s.shared, key);
}

/** One line under a step of the strip: configured where, or "+ ajouter". */
function stepState(api: WorktreeSettingsApi, step: StepKey): { set: boolean; label: string } {
  const s = api.settings;
  if (!s) return { set: false, label: '' };
  if (step === 'overlay') return s.overlayFiles.length ? { set: true, label: `✓ ${s.overlayFiles.length} fichier${s.overlayFiles.length > 1 ? 's' : ''}` } : { set: false, label: '+ ajouter' };
  if (step === 'setup' && !effective(api, 'hooks.setup') && (s.fileHooks.global.length || s.fileHooks.repo.length)) return { set: true, label: '✓ hooks fichiers' };
  if (step === 'start' && !effective(api, 'server.start')) return { set: false, label: '+ ajouter' };
  const keys = STEPS.find((x) => x.key === step)!.keys;
  const scope = scopeOf(api, keys);
  const hasValue = keys.some((k) => {
    const v = effective(api, k);
    return v !== undefined && v !== '';
  });
  if (!scope.layer || !hasValue) return { set: false, label: '+ ajouter' };
  return { set: true, label: scope.layer === 'shared' ? '✓ partagé' : '✓ perso' };
}

/**
 * The worktree's life, from creation to removal, read at a glance (PRD §8.3):
 * a step with a solid border is configured, a dashed one is not.
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

export type StepDrafts = {
  setup?: string;
  teardown?: string;
  start?: { start: string; custom: boolean; url: string; click: Record<WorktreeServerState, WorktreeClickChoice> };
  stop?: { stop: string; probe: string; interval: string };
};

export function initialDraft(api: WorktreeSettingsApi, step: StepKey): StepDrafts[keyof StepDrafts] {
  const str = (k: WorktreeConfigKey) => (effective(api, k) as string | undefined) ?? '';
  if (step === 'setup') return str('hooks.setup');
  if (step === 'teardown') return str('hooks.teardown');
  if (step === 'start') {
    const start = str('server.start');
    const items = api.settings?.view?.items ?? [];
    return {
      start,
      custom: !!start && !items.some((i) => i.id === start),
      url: str('server.url'),
      click: { ...DEFAULT_WORKTREE_CLICK, ...((effective(api, 'server.clickByState') as Record<string, WorktreeClickChoice> | undefined) ?? {}) },
    };
  }
  if (step === 'stop') {
    const probe = effective(api, 'server.probe') as { command?: string; intervalSec?: number } | undefined;
    return { stop: str('server.stop'), probe: probe?.command ?? '', interval: String(probe?.intervalSec ?? 30) };
  }
  return undefined;
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
  if (step === 'overlay') return <OverlayStep api={props.api} />;
  if (step === 'setup' || step === 'teardown') return <HookStep {...props} hook={step} />;
  if (step === 'start') return <StartStep {...props} />;
  return <StopStep {...props} />;
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
        <h4 className="text-sm font-semibold text-[var(--theme-text-primary)]">Overlay</h4>
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
      <div className="flex items-baseline gap-2">
        <h4 className="text-sm font-semibold text-[var(--theme-text-primary)]">{hook === 'setup' ? 'Setup (ex post-checkout)' : 'Teardown'}</h4>
        <span className="text-[11px] text-[var(--theme-text-muted)]">
          {hook === 'setup' ? 'à la création du worktree, après l\'overlay — asynchrone, ne bloque ni les agents ni le worktree' : 'avant la suppression du worktree — attendu au plus le timeout, n\'empêche jamais la suppression'}
        </span>
      </div>
      {hook === 'setup' && (
        <div className="mt-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-[var(--theme-text-secondary)]">Hooks fichiers</span>
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

function StartStep({ api, draft, setDraft }: EditorProps) {
  const s = api.settings!;
  const view = s.view;
  const items = view?.items ?? [];
  const saved = initialDraft(api, 'start') as NonNullable<StepDrafts['start']>;
  const d = (draft as StepDrafts['start']) ?? saved;
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const runVerb = useWorktreeActionsStore((st) => st.runVerb);
  const patch = (p: Partial<NonNullable<StepDrafts['start']>>) => setDraft({ ...d, ...p });

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
      ['server.start', d.start.trim() || undefined],
      ['server.url', d.url.trim() || undefined],
      ['server.clickByState', Object.keys(click).length ? click : undefined],
    ]);
    if (ok) setDraft(undefined);
  };
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <h4 className="text-sm font-semibold text-[var(--theme-text-primary)]">Start</h4>
        <span className="text-[11px] text-[var(--theme-text-muted)]">lance le serveur du worktree dans un terminal persistant, sans timeout</span>
      </div>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <div>
          <FieldLabel htmlFor="wt-start">Commande de démarrage</FieldLabel>
          <Select
            id="wt-start"
            className="h-8 text-xs"
            options={targetOptions}
            value={d.custom ? '__custom' : d.start}
            onChange={(e) => (e.target.value === '__custom' ? patch({ custom: true, start: d.custom ? d.start : '' }) : patch({ custom: false, start: e.target.value }))}
          />
          {d.custom && (
            <input aria-label="Commande personnalisée" className={cn(TEXT_INPUT, 'mt-1.5 font-mono text-xs')} placeholder="make serve" value={d.start} onChange={(e) => patch({ start: e.target.value })} />
          )}
          <Hint>Une config launch.json, un script npm, une cible make, une action, ou n&apos;importe quelle commande.</Hint>
        </div>
        <div>
          <FieldLabel htmlFor="wt-url">URL (Open)</FieldLabel>
          <input id="wt-url" className={cn(TEXT_INPUT, 'font-mono text-xs')} placeholder="http://localhost:${port}" value={d.url} onChange={(e) => patch({ url: e.target.value })} />
          <Hint>Vide = <code className="font-mono">http://localhost:</code> + le port détecté. <code className="font-mono">{'${port}'}</code> = le port détecté.</Hint>
        </div>
      </div>
      <div className="mt-3">
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
      <Footer api={api} keys={['server.start', 'server.url', 'server.clickByState']} dirty={dirty} onSave={() => void save()} onRevert={() => setDraft(undefined)}>
        <Button size="sm" disabled={!view || dirty || !view.start} title={dirty ? 'Enregistre d\'abord' : undefined} onClick={() => view && void runVerb(view, 'start', null)}>
          ▶ Démarrer dans le worktree courant
        </Button>
      </Footer>
    </div>
  );
}

function StopStep({ api, draft, setDraft }: EditorProps) {
  const s = api.settings!;
  const saved = initialDraft(api, 'stop') as NonNullable<StepDrafts['stop']>;
  const d = (draft as StepDrafts['stop']) ?? saved;
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const [probe, setProbe] = useState<'loading' | { ok: boolean; text: string } | null>(null);
  const patch = (p: Partial<NonNullable<StepDrafts['stop']>>) => setDraft({ ...d, ...p });
  const server = s.view?.server;
  const save = async () => {
    const ok = await api.write([
      ['server.stop', d.stop.trim() || undefined],
      ['server.probe', d.probe.trim() ? { command: d.probe.trim(), intervalSec: Number(d.interval) || 30 } : undefined],
    ]);
    if (ok) setDraft(undefined);
  };
  const testProbe = async () => {
    setProbe('loading');
    // The probe sees the server's URL and port, like when Fleex runs it.
    const env = [server?.url ? `FLEEX_URL='${server.url}'` : '', server?.port ? `FLEEX_PORT='${server.port}'` : ''].filter(Boolean).join(' ');
    try {
      const res = await testProbeCommand(`${env ? `export ${env}; ` : ''}${d.probe}`);
      setProbe({ ok: res.exitCode === 0, text: [res.stdout, res.stderr].filter(Boolean).join('\n') || `exit ${res.exitCode}` });
    } catch {
      setProbe(null);
    }
  };
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <h4 className="text-sm font-semibold text-[var(--theme-text-primary)]">Stop · Status</h4>
        <span className="text-[11px] text-[var(--theme-text-muted)]">facultatif : par défaut, Stop ferme le terminal du start et l&apos;état vient du port détecté</span>
      </div>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <div>
          <FieldLabel htmlFor="wt-stop">Commande d&apos;arrêt</FieldLabel>
          <input id="wt-stop" className={cn(TEXT_INPUT, 'font-mono text-xs')} placeholder="docker compose stop" value={d.stop} onChange={(e) => patch({ stop: e.target.value })} />
          <Hint>Lancée avant de fermer le terminal du start (utile pour docker compose).</Hint>
        </div>
        <div>
          <FieldLabel htmlFor="wt-probe">Probe d&apos;état</FieldLabel>
          <div className="flex gap-1.5">
            <input id="wt-probe" className={cn(TEXT_INPUT, 'font-mono text-xs')} placeholder="curl -sf $FLEEX_URL/health" value={d.probe} onChange={(e) => patch({ probe: e.target.value })} />
            <Select aria-label="Intervalle du probe" className="h-8 w-24 text-xs" options={['15', '30', '60', '300'].map((v) => ({ value: v, label: `${v} s` }))} value={d.interval} onChange={(e) => patch({ interval: e.target.value })} />
          </div>
          <Hint>Code 0 = en marche ; un échec quand il tournait le passe en erreur.</Hint>
        </div>
      </div>
      {probe && probe !== 'loading' && (
        <pre className={cn('mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--theme-bg-base)] p-2 font-mono text-[11px]', probe.ok ? tintText('green') : tintText('red'))}>{probe.ok ? '✓ ' : '✗ '}{probe.text}</pre>
      )}
      <Footer api={api} keys={['server.stop', 'server.probe']} dirty={dirty} onSave={() => void save()} onRevert={() => setDraft(undefined)}>
        <Button size="sm" disabled={!d.probe.trim() || probe === 'loading'} onClick={() => void testProbe()}>▶ Tester le probe</Button>
      </Footer>
    </div>
  );
}

/** The probe tester of Settings › Actions (a background shell, timeout 10 s). */
function testProbeCommand(command: string) {
  return api.testPinnedProbe(command).then((r) => ({ exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }));
}

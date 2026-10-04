import { useMemo, useState } from 'react';
import {
  WORKTREE_DISCOVERY_SOURCES,
  WORKTREE_SERVER_STATES,
  getConfigKey,
  type WorktreeActionDef,
  type WorktreeActionItem,
  type WorktreeDiscoverySource,
  type WorktreeServerState,
} from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useWorktreeActionsStore } from '../../../stores/worktreeActionsStore';
import { Button } from '../../ui/Button';
import { CODE_INPUT, RunModeToggle, Switch, TEXT_INPUT, environmentLine } from '../../settings/actions/shared';
import { STATE_LABEL, SOURCE_GLYPH, stateDotClass } from '../../worktree-actions/worktreeUi';
import { effective } from './Lifecycle';
import { CARD, ERROR_TEXT, FieldLabel, H, Hint, ScopeBadge } from './parts';
import type { WorktreeSettingsApi } from './useWorktreeSettings';

/** `Lint the code` → `lint-the-code`: an id for a new action. */
export function slugId(label: string, taken: Set<string>): string {
  const base = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'action';
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

interface ActionRow {
  id: string;
  def: WorktreeActionDef;
  item?: WorktreeActionItem;
}

/** Declared actions, personal over shared (same id), in file order. */
function actionRows(api: WorktreeSettingsApi): ActionRow[] {
  const s = api.settings;
  if (!s) return [];
  const byId = new Map<string, WorktreeActionDef>();
  for (const a of s.shared?.actions ?? []) byId.set(a.id, a);
  for (const a of s.personal.actions ?? []) byId.set(a.id, a);
  const items = new Map((s.view?.items ?? []).map((i) => [i.id, i]));
  return [...byId.entries()].filter(([, def]) => !def.hidden).map(([id, def]) => ({ id, def, ...(items.get(id) ? { item: items.get(id)! } : {}) }));
}

type Draft = { id: string; label: string; cmd: string; mode: 'background' | 'terminal'; when: WorktreeServerState[]; isNew: boolean };

/**
 * ACTIONS DU REPO: the repo's own commands, like pinned actions (left click
 * per state is in the Start step; these run from the menu). Each row says
 * where it lives and moves with one click.
 */
export function RepoActions({ api }: { api: WorktreeSettingsApi }) {
  const s = api.settings!;
  const rows = actionRows(api);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runItem = useWorktreeActionsStore((st) => st.runItem);
  const refs = useMemo(() => (s.view?.items ?? []).filter((i) => i.layer === 'launch' || i.layer === 'detected').map((i) => i.id), [s.view]);

  const edit = (row: ActionRow) => {
    setError(null);
    setDraft({ id: row.id, label: row.def.label ?? '', cmd: row.def.cmd, mode: row.def.mode ?? 'background', when: row.def.when ?? [], isNew: false });
  };
  const add = () => {
    setError(null);
    setDraft({ id: '', label: '', cmd: '', mode: 'background', when: [], isNew: true });
  };
  const save = async () => {
    if (!draft) return;
    if (!draft.cmd.trim()) {
      setError('Il faut une commande (ou une référence comme npm:dev).');
      return;
    }
    const id = draft.isNew ? slugId(draft.label || draft.cmd.split(/\s+/)[0] || 'action', new Set(rows.map((r) => r.id))) : draft.id;
    const def: Partial<WorktreeActionDef> = { cmd: draft.cmd.trim(), mode: draft.mode, ...(draft.label.trim() ? { label: draft.label.trim() } : {}), ...(draft.when.length ? { when: draft.when } : {}) };
    // New actions are personal; an existing one is written where it lives.
    if (await api.write([[`action:${id}`, def]], draft.isNew ? 'personal' : undefined)) setDraft(null);
  };
  const remove = async (id: string) => {
    if (await api.write([[`action:${id}`, undefined]])) setDraft(null);
  };

  return (
    <section className={CARD} aria-labelledby="wt-actions">
      <div className="mb-2 flex items-center gap-2">
        <h3 id="wt-actions" className={H}>Actions du repo</h3>
        <span className="text-[11px] text-[var(--theme-text-faint)]">dans le menu du worktree, groupe Actions</span>
        <span className="flex-1" />
        <Button size="sm" onClick={add}>+ Ajouter une action</Button>
      </div>
      <div className="divide-y divide-[var(--theme-border)]">
        {rows.length === 0 && !draft && <Hint>Aucune action. Ajoute-en une, ou épingle ☆ une commande détectée plus bas.</Hint>}
        {rows.map((row) => (
          draft && !draft.isNew && draft.id === row.id ? (
            <ActionEditor key={row.id} draft={draft} setDraft={setDraft} refs={refs} error={error} onSave={() => void save()} onDelete={() => void remove(row.id)} />
          ) : (
            <div key={row.id} className="flex items-center gap-2 py-1.5 text-xs" data-testid={`action-row-${row.id}`}>
              <span className={cn('w-3 text-center font-mono text-[10px] font-bold', SOURCE_GLYPH.action.className)}>{SOURCE_GLYPH.action.glyph}</span>
              <span className="w-40 shrink-0 truncate font-medium text-[var(--theme-text-primary)]">{row.def.label || row.id}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--theme-text-secondary)]">{row.def.cmd}</span>
              {row.def.when?.length ? <span className="flex gap-0.5">{row.def.when.map((w) => <span key={w} className={cn('h-1.5 w-1.5 rounded-full', stateDotClass(w))} title={STATE_LABEL[w]} />)}</span> : null}
              <span className="w-20 shrink-0 text-[11px] text-[var(--theme-text-muted)]">{row.def.mode ?? 'background'}</span>
              <ScopeBadge api={api} keys={[`action:${row.id}`]} small />
              {row.item && s.view && (
                <button type="button" aria-label={`Lancer ${row.id}`} className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]" onClick={() => void runItem(s.view!, row.item!)}>▶</button>
              )}
              <button type="button" aria-label={`Modifier ${row.id}`} className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]" onClick={() => edit(row)}>✎</button>
            </div>
          )
        ))}
        {draft?.isNew && <ActionEditor draft={draft} setDraft={setDraft} refs={refs} error={error} onSave={() => void save()} />}
      </div>
    </section>
  );
}

function ActionEditor({ draft, setDraft, refs, error, onSave, onDelete }: { draft: Draft; setDraft: (d: Draft | null) => void; refs: string[]; error: string | null; onSave: () => void; onDelete?: () => void }) {
  const patch = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  return (
    <div className="space-y-2 rounded-lg border border-[var(--theme-accent)] bg-[var(--theme-bg-base)] p-3" data-testid="action-editor">
      <div className="grid gap-2 md:grid-cols-[200px_minmax(0,1fr)]">
        <div>
          <FieldLabel htmlFor="wt-action-label">Nom</FieldLabel>
          <input id="wt-action-label" className={cn(TEXT_INPUT, 'h-7 text-xs')} placeholder="migrate" value={draft.label} onChange={(e) => patch({ label: e.target.value })} />
        </div>
        <div>
          <FieldLabel htmlFor="wt-action-cmd">Commande</FieldLabel>
          <input id="wt-action-cmd" list="wt-action-refs" spellCheck={false} className={cn(CODE_INPUT, 'h-7 py-1')} placeholder="make db-migrate — ou une référence : npm:dev, make:up, launch:web" value={draft.cmd} onChange={(e) => patch({ cmd: e.target.value })} />
          <datalist id="wt-action-refs">{refs.map((r) => <option key={r} value={r} />)}</datalist>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <RunModeToggle small value={draft.mode} onChange={(mode) => patch({ mode })} />
        <span className="font-mono text-[10.5px] text-[var(--theme-text-muted)]">{environmentLine(draft.mode)} · cwd = le worktree · FLEEX_*</span>
      </div>
      <div>
        <span className="mr-2 text-[11px] text-[var(--theme-text-muted)]">Dans le menu quand le serveur est</span>
        {WORKTREE_SERVER_STATES.map((st) => {
          const on = draft.when.includes(st);
          return (
            <button
              key={st}
              type="button"
              aria-pressed={on}
              onClick={() => patch({ when: on ? draft.when.filter((w) => w !== st) : [...draft.when, st] })}
              className={cn('mr-1 inline-flex h-[22px] items-center gap-1 rounded border px-1.5 text-[11px]', on ? 'border-transparent bg-[var(--theme-border-input)] text-[var(--theme-text-primary)]' : 'border-[var(--theme-border-input)] text-[var(--theme-text-muted)]')}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', stateDotClass(st))} /> {STATE_LABEL[st]}
            </button>
          );
        })}
        {!draft.when.length && <span className="text-[10.5px] text-[var(--theme-text-faint)]">aucun coché = toujours</span>}
      </div>
      {error && <p className={ERROR_TEXT}>{error}</p>}
      <div className="flex items-center gap-2">
        {onDelete && <Button size="sm" variant="danger" onClick={onDelete}>Supprimer</Button>}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Annuler</Button>
        <Button size="sm" variant="primary" onClick={onSave}>{draft.isNew ? 'Ajouter (perso)' : 'Enregistrer'}</Button>
      </div>
    </div>
  );
}

const SOURCE_TITLE: Record<WorktreeDiscoverySource, string> = { launch: '.claude/launch.json', npm: 'package.json', make: 'Makefile', composer: 'composer.json' };

/**
 * COMMANDES DÉTECTÉES: read from the repo's files, never written. ☆ pins
 * (personal), Masquer hides from the menu, Start makes it the start command.
 */
export function DetectedCommands({ api }: { api: WorktreeSettingsApi }) {
  const s = api.settings!;
  const items = (s.view?.items ?? []).filter((i) => i.layer === 'launch' || i.layer === 'detected');
  const hidden = [...new Set([...(s.shared?.discovery?.hide ?? []), ...(s.personal.discovery?.hide ?? [])])];
  const start = effective(api, 'server.start');
  if (!s.view) return <section className={CARD}><h3 className={H}>Commandes détectées</h3><Hint>Choisis un worktree pour voir les commandes de ses fichiers.</Hint></section>;
  return (
    <section className={CARD} aria-labelledby="wt-detected">
      <div className="mb-2 flex items-center gap-2">
        <h3 id="wt-detected" className={H}>Commandes détectées</h3>
        <span className="text-[11px] text-[var(--theme-text-faint)]">lues dans les fichiers du worktree, jamais modifiés</span>
      </div>
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
        {WORKTREE_DISCOVERY_SOURCES.map((src) => {
          const list = items.filter((i) => i.source === src);
          if (!list.length) return null;
          return (
            <div key={src} className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[var(--theme-text-primary)]">
                <span className={cn('font-mono text-[10px]', SOURCE_GLYPH[src].className)}>{SOURCE_GLYPH[src].glyph}</span>
                {SOURCE_TITLE[src]} <span className="font-normal text-[var(--theme-text-faint)]">{list.length}</span>
              </div>
              <ul className="max-h-60 space-y-0.5 overflow-auto">
                {list.map((i) => (
                  <li key={i.id} className="group flex items-center gap-1.5 text-xs" data-testid={`detected-${i.id}`}>
                    <button
                      type="button"
                      aria-label={i.pinned ? `Désépingler ${i.label}` : `Épingler ${i.label}`}
                      className={cn('w-4 shrink-0', i.pinned ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-faint)] hover:text-[var(--theme-accent)]')}
                      onClick={() => void api.write([[`pin:${i.id}`, i.pinned ? undefined : true]], i.pinned ? undefined : 'personal')}
                    >
                      {i.pinned ? '★' : '☆'}
                    </button>
                    <span className="min-w-0 flex-1 truncate font-mono text-[var(--theme-text-secondary)]" title={i.command}>{i.label}</span>
                    {start === i.id ? (
                      <span className="text-[10px] text-[var(--theme-accent)]">start</span>
                    ) : (
                      <button type="button" className="text-[10px] text-[var(--theme-text-faint)] opacity-60 hover:text-[var(--theme-text-primary)] group-hover:opacity-100" title="Utiliser comme commande de démarrage" onClick={() => void api.write([['server.start', i.id]])}>
                        ▶ start
                      </button>
                    )}
                    <button type="button" className="text-[10px] text-[var(--theme-text-faint)] opacity-60 hover:text-[var(--theme-text-primary)] group-hover:opacity-100" onClick={() => void api.write([[`hide:${i.id}`, true]], 'personal')}>
                      masquer
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {items.length === 0 && <Hint>Rien de détecté à la racine du worktree (package.json, Makefile, composer.json, .claude/launch.json).</Hint>}
      {hidden.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--theme-text-muted)]">
          Masquées :
          {hidden.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 font-mono">
              {id}
              <ScopeBadge api={api} keys={[`hide:${id}`]} small />
              <button type="button" aria-label={`Réafficher ${id}`} className="hover:text-[var(--theme-text-primary)]" onClick={() => void api.write([[`hide:${id}`, undefined]])}>✕</button>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/** Options: detected sources, port reservation, hooks timeout. */
export function Options({ api }: { api: WorktreeSettingsApi }) {
  const s = api.settings!;
  const sources = (effective(api, 'discovery.sources') as WorktreeDiscoverySource[] | undefined) ?? [...WORKTREE_DISCOVERY_SOURCES];
  const ports = (effective(api, 'ports') as { reserve?: boolean; count?: number } | undefined) ?? {};
  const timeout = (effective(api, 'hooks.timeoutSec') as number | undefined) ?? s.hookTimeoutSeconds;
  const getRepoConfig = useSettingsStore((st) => st.getRepoConfig);
  const setRepoConfig = useSettingsStore((st) => st.setRepoConfig);
  const [org, name] = s.repo.split('/') as [string, string];
  const [timeoutDraft, setTimeoutDraft] = useState<string | null>(null);

  const toggleSource = (src: WorktreeDiscoverySource) => {
    const next = sources.includes(src) ? sources.filter((x) => x !== src) : [...sources, src];
    const all = WORKTREE_DISCOVERY_SOURCES.every((x) => next.includes(x));
    void api.write([['discovery.sources', all ? undefined : WORKTREE_DISCOVERY_SOURCES.filter((x) => next.includes(x))]]);
  };
  const saveTimeout = () => {
    const n = Math.max(5, Math.min(3600, Number(timeoutDraft) || 60));
    setTimeoutDraft(null);
    // Inline hooks and teardown read hooks.timeoutSec; file hooks the repo setting — keep both in step.
    void api.write([['hooks.timeoutSec', n]]);
    setRepoConfig(org, name, { ...getRepoConfig(org, name), hookTimeoutSeconds: n });
  };

  return (
    <section className={CARD} aria-labelledby="wt-options">
      <h3 id="wt-options" className={cn(H, 'mb-2')}>Options</h3>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <div className="mb-1 flex items-center gap-2"><span className="text-xs font-medium text-[var(--theme-text-secondary)]">Sources détectées</span><ScopeBadge api={api} keys={['discovery.sources']} small /></div>
          <div className="space-y-1">
            {WORKTREE_DISCOVERY_SOURCES.map((src) => (
              <label key={src} className="flex items-center gap-2 text-xs text-[var(--theme-text-secondary)]">
                <Switch on={sources.includes(src)} onToggle={() => toggleSource(src)} label={`Détecter ${SOURCE_TITLE[src]}`} /> {SOURCE_TITLE[src]}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center gap-2"><span className="text-xs font-medium text-[var(--theme-text-secondary)]">Réserver des ports pour chaque worktree</span><ScopeBadge api={api} keys={['ports']} small /></div>
          <label className="flex items-center gap-2 text-xs text-[var(--theme-text-secondary)]">
            <Switch on={!!ports.reserve} onToggle={() => void api.write([['ports', ports.reserve ? undefined : { reserve: true, count: ports.count ?? 10 }]])} label="Réserver des ports" />
            {ports.reserve ? 'activé' : 'désactivé'}
          </label>
          {ports.reserve && (
            <label className="mt-1.5 flex items-center gap-2 text-xs text-[var(--theme-text-secondary)]">
              <span className="w-16 shrink-0"><input type="number" min={1} max={20} aria-label="Nombre de ports" className={cn(TEXT_INPUT, 'h-7 text-center text-xs')} value={ports.count ?? 10} onChange={(e) => void api.write([['ports', { reserve: true, count: Math.max(1, Math.min(20, Number(e.target.value) || 10)) }]])} /></span>
              ports
            </label>
          )}
          <Hint>
            Désactivé : Fleex détecte le port sur lequel le serveur écoute. Activé : chaque worktree reçoit une plage stable
            ({s.view?.reservedPort ? <code className="font-mono">FLEEX_PORT={s.view.reservedPort}</code> : <code className="font-mono">FLEEX_PORT</code>}, et <code className="font-mono">PORT</code> pour une config launch.json en autoPort).
          </Hint>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--theme-text-secondary)]">Timeout des hooks</span>
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0"><input type="number" min={5} max={3600} aria-label="Timeout des hooks" className={cn(TEXT_INPUT, 'h-7 text-center text-xs')} value={timeoutDraft ?? String(timeout)} onChange={(e) => setTimeoutDraft(e.target.value)} onBlur={() => timeoutDraft !== null && saveTimeout()} onKeyDown={(e) => e.key === 'Enter' && saveTimeout()} /></span>
            <span className="text-xs text-[var(--theme-text-muted)]">secondes</span>
          </div>
          <Hint>Setup, hooks fichiers et Teardown. Au-delà, le hook est arrêté ; la suppression du worktree continue.</Hint>
        </div>
      </div>
      {getConfigKey(s.personal, 'hooks.timeoutSec') === undefined && getConfigKey(s.shared, 'hooks.timeoutSec') !== undefined && <Hint>Timeout fixé par l&apos;équipe.</Hint>}
    </section>
  );
}

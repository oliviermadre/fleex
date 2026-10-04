import { useState, type ReactNode } from 'react';
import { keyScope, type ActionRun, type WorktreeConfigKey } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { tint, tintText } from '../../../lib/tints';
import { usePinnedActionsStore } from '../../../stores/pinnedActionsStore';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { Tooltip } from '../../ui/Tooltip';
import { runDuration, statusTextClass } from '../../actions/actionStatus';
import type { WorktreeSettingsApi } from './useWorktreeSettings';

export const CARD = 'rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4';
export const H = 'text-[11px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]';

/** Where a group of keys lives, read on the first key present in a layer. */
export function scopeOf(api: WorktreeSettingsApi, keys: WorktreeConfigKey[]): { layer: 'personal' | 'shared' | null; masks: boolean } {
  const s = api.settings;
  if (!s) return { layer: null, masks: false };
  for (const k of keys) {
    const scope = keyScope(s.personal, s.shared, k);
    if (scope.layer) return scope;
  }
  return { layer: null, masks: false };
}

/**
 * "Perso ⇡" / "Partagé ⇣": where an element lives, and the click that moves
 * it. Partager writes it into `.fleex/worktree.json`; Garder pour moi asks
 * whether the team's copy should leave the file too.
 */
export function ScopeBadge({ api, keys, small }: { api: WorktreeSettingsApi; keys: WorktreeConfigKey[]; small?: boolean }) {
  const [asking, setAsking] = useState(false);
  const scope = scopeOf(api, keys);
  const noWorktree = !api.settings?.path;
  if (!scope.layer) return null;
  const shared = scope.layer === 'shared';
  const present = keys.filter((k) => scopeOf(api, [k]).layer === scope.layer);
  return (
    <>
      <button
        type="button"
        disabled={noWorktree || !!api.settings?.sharedConfigError}
        title={
          noWorktree ? 'Pas de worktree : la couche partagée vit dans .fleex/worktree.json d\'un checkout'
            : shared ? 'Partagé avec l\'équipe (.fleex/worktree.json) — clic : garder pour moi'
              : 'Perso (dans Fleex) — clic : partager dans .fleex/worktree.json'
        }
        onClick={(e) => {
          e.stopPropagation();
          if (shared) setAsking(true);
          else void api.share(present);
        }}
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
          small ? 'h-5 px-2 text-[10px]' : 'h-6 px-2.5 text-[11px]',
          shared ? tint('green') : tint('blue'),
        )}
      >
        {shared ? 'Partagé ⇣' : scope.masks ? 'Perso ⇡ · masque l\'équipe' : 'Perso ⇡'}
      </button>
      <Modal open={asking} onClose={() => setAsking(false)}>
        <div className="space-y-3 p-5">
          <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">Garder pour moi</h3>
          <p className="text-xs text-[var(--theme-text-secondary)]">
            Une copie va dans tes réglages Fleex. Faut-il aussi la retirer de <code className="font-mono">.fleex/worktree.json</code> (pour toute l&apos;équipe, au prochain commit) ?
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Annuler</Button>
            <Button size="sm" onClick={() => { setAsking(false); void api.unshare(present, false); }}>Garder une copie perso</Button>
            <Button size="sm" variant="primary" onClick={() => { setAsking(false); void api.unshare(present, true); }}>Retirer aussi du fichier</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** The outcome of a "Tester" run, inline under the editor (live while it runs). */
export function RunResult({ sourceId, runId, onClose }: { sourceId: string; runId: string; onClose: () => void }) {
  const run: ActionRun | undefined = usePinnedActionsStore((s) => s.runs[sourceId]?.find((r) => r.runId === runId));
  const live = usePinnedActionsStore((s) => s.liveOutput[runId]?.text);
  const done = !!run?.finishedAt;
  const ok = done && run.exitCode === 0 && !run.timedOut;
  const body = done ? [run.stdout, run.stderr].filter(Boolean).join('\n') : live ?? '';
  return (
    <div className="mt-2.5 overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)]" data-testid="run-result">
      <div className="flex items-center gap-2 border-b border-[var(--theme-border)] px-2.5 py-1.5 text-[11.5px] text-[var(--theme-text-secondary)]">
        {done ? (
          <span className={ok ? statusTextClass('ok') : statusTextClass('ko')}>{ok ? '✓' : '✗'} {run.timedOut ? 'timed out' : `exit ${run.exitCode ?? '—'}`}</span>
        ) : (
          <span className="animate-pulse motion-reduce:animate-none">● En cours…</span>
        )}
        {done && <span className="text-[var(--theme-text-muted)]">· {runDuration(run.startedAt, run.finishedAt)}</span>}
        <button type="button" aria-label="Fermer le résultat" className="ml-auto text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]" onClick={onClose}>✕</button>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap p-2.5 font-mono text-[11.5px] leading-snug text-[var(--theme-text-secondary)]">{body || (done ? '(aucune sortie)' : '')}</pre>
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-[var(--theme-text-muted)]">{children}</p>;
}

export function Warn({ children }: { children: ReactNode }) {
  return <p className={cn('rounded-md px-2.5 py-1.5 text-[11px]', tint('yellow'))}>{children}</p>;
}

export function FieldLabel({ children, htmlFor, aside }: { children: ReactNode; htmlFor?: string; /** Next to the label, outside it (e.g. EnvHelp). */ aside?: ReactNode }) {
  const label = <label htmlFor={htmlFor} className={cn('block text-[11px] font-medium text-[var(--theme-text-secondary)]', !aside && 'mb-1')}>{children}</label>;
  return aside ? <div className="mb-1 flex items-center">{label}{aside}</div> : label;
}

export const ERROR_TEXT = cn('text-[11px]', tintText('red'));

/** Which variable a worktree command gets, and when it is filled (shown by `EnvHelp`). */
export const ENV_HELP: readonly { vars: string; when: string }[] = [
  { vars: 'FLEEX_REPO · FLEEX_BRANCH · FLEEX_TICKET_ID', when: 'toujours' },
  { vars: 'FLEEX_WORKTREE_PATH · FLEEX_REPO_PATH · FLEEX_WORKSPACE_PATH', when: 'toujours (le worktree, le checkout principal, le workspace du ticket)' },
  { vars: 'FLEEX_PORT · FLEEX_PORT_COUNT', when: 'réservation de ports activée : début et taille de la plage du worktree, dès le Setup et le Start' },
  { vars: 'FLEEX_PORT · FLEEX_URL', when: 'serveur en marche : port et URL principaux (Stop, actions, probe suivant)' },
  { vars: 'FLEEX_URL_<NOM> · FLEEX_PORT_<NOM>', when: 'serveur en marche, quand le probe renvoie des endpoints (ex. FLEEX_URL_GATEWAY)' },
  { vars: 'PORT', when: 'seulement pour une config launch.json en autoPort (= FLEEX_PORT)' },
  { vars: '{{org}} {{repo}} {{branch}} {{worktree_path}}', when: 'scripts Setup et Teardown (ancienne syntaxe, toujours remplacée)' },
];

/** « ⓘ Variables » next to a command field: every variable Fleex passes, and when. */
export function EnvHelp() {
  return (
    <Tooltip
      interactive
      placement="bottom-start"
      label={
        <span className="block max-w-[420px]" data-testid="env-help">
          <span className="mb-1 block font-semibold">Variables passées à la commande</span>
          {ENV_HELP.map((v) => (
            <span key={v.vars} className="mb-1 block">
              <code className="font-mono text-[10.5px]">{v.vars}</code>
              <span className="block font-normal text-[var(--theme-text-muted)]">{v.when}</span>
            </span>
          ))}
          <span className="block font-normal text-[var(--theme-text-muted)]">Elles s&apos;utilisent comme n&apos;importe quelle variable shell : <code className="font-mono">bun run dev --app-port $FLEEX_PORT</code>.</span>
        </span>
      }
    >
      <button type="button" aria-label="Variables disponibles" className="ml-1 rounded px-1 text-[10.5px] font-normal text-[var(--theme-accent)] hover:underline">ⓘ variables</button>
    </Tooltip>
  );
}

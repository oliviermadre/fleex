import { useState, type ReactNode } from 'react';
import { keyScope, type ActionRun, type WorktreeConfigKey } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { tint, tintText } from '../../../lib/tints';
import { usePinnedActionsStore } from '../../../stores/pinnedActionsStore';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
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

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-1 block text-[11px] font-medium text-[var(--theme-text-secondary)]">{children}</label>;
}

export const ERROR_TEXT = cn('text-[11px]', tintText('red'));

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { worktreeItemOffered, type WorktreeActionItem, type WorktreeActionsView, type WorktreeServerSnapshot, type WorktreeSetupSnapshot, type WorktreeVerb } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { foldAccents } from '../../lib/normalize';
import { FloatingPortal } from '../../hooks/usePopover';
import { FILTER_LABEL, GROUP_LABEL, GROUP_ORDER, SOURCE_GLYPH, STATE_LABEL, groupOf, stateDotClass, stateTextClass, type MenuGroupKind } from './worktreeUi';

/** A row of the menu: a repo command (with a star) or a system entry. */
interface MenuRow {
  key: string;
  group: Exclude<MenuGroupKind, 'pinned'>;
  label: string;
  detail?: string;
  terminal?: boolean;
  /** Shared / personal badge, for declared actions. */
  scope?: 'partagé' | 'perso';
  item?: WorktreeActionItem;
  dim?: boolean;
  search: string;
  onLaunch: () => void;
}

type Filter = 'all' | MenuGroupKind;

export interface WorktreeActionMenuProps {
  view: WorktreeActionsView;
  server: WorktreeServerSnapshot;
  name: string;
  onVerb: (verb: WorktreeVerb) => void;
  /** Open one of the services the probe reported (the primary one goes through `onVerb('open')`). */
  onOpenUrl: (url: string) => void;
  onItem: (item: WorktreeActionItem) => void;
  onPin: (item: WorktreeActionItem, pinned: boolean) => void;
  onSyncOverlay: () => void;
  onRepoSettings: (() => void) | null;
  /** Last Setup run of this worktree, shown in the header. */
  setup?: WorktreeSetupSnapshot;
  onRerunSetup: () => void;
  onSetupLogs: () => void;
  onOpenHooks: (() => void) | null;
  onClose: () => void;
  floatingRef: (node: HTMLElement | null) => void;
  floatingStyles: CSSProperties;
  floatingProps: Record<string, unknown>;
}

/** First-paint guess of the sticky header's height; measured right after. */
const HEADER_PX = 112;

/**
 * The worktree's launcher (PRD §8.2), on the SmartSessionButton model: sticky
 * header with the server verbs, search, filter chips per source, groups with
 * sticky headers inside a height-bounded scroll, ★ to pin, keyboard navigation.
 */
export function WorktreeActionMenu({
  view,
  server,
  name,
  onVerb,
  onOpenUrl,
  onItem,
  onPin,
  onSyncOverlay,
  onRepoSettings,
  setup,
  onRerunSetup,
  onSetupLogs,
  onOpenHooks,
  onClose,
  floatingRef,
  floatingStyles,
  floatingProps,
}: WorktreeActionMenuProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [highlight, setHighlight] = useState(-1);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Group headers stick right under the header, whose height depends on its banners.
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerPx, setHeaderPx] = useState(HEADER_PX);
  useLayoutEffect(() => {
    const h = headerRef.current?.offsetHeight;
    if (h && h !== headerPx) setHeaderPx(h);
  });
  const nq = foldAccents(query.trim());
  const state = server.state;

  const rows = useMemo<MenuRow[]>(() => {
    const out: MenuRow[] = view.items.map((item) => ({
      key: item.id,
      group: groupOf(item),
      label: item.label,
      detail: item.command,
      terminal: item.mode === 'terminal',
      ...(item.layer === 'shared' ? { scope: 'partagé' as const } : item.layer === 'personal' ? { scope: 'perso' as const } : {}),
      item,
      dim: !worktreeItemOffered(item, state),
      search: foldAccents(`${item.label} ${item.command} ${item.id}`),
      onLaunch: () => onItem(item),
    }));
    out.push({ key: 'system:sync', group: 'system', label: 'Sync overlay', detail: 'fichiers gitignorés → overlay', search: foldAccents('sync overlay gitignore env'), onLaunch: onSyncOverlay });
    out.push({ key: 'system:setup', group: 'system', label: 'Relancer le Setup', detail: 'hooks fichiers puis script Setup', search: foldAccents('relancer setup hook post-checkout install'), onLaunch: onRerunSetup });
    if (onOpenHooks) out.push({ key: 'system:hooks', group: 'system', label: 'Ouvrir le dossier des hooks', detail: 'overlays/<org>/<repo>/hooks', search: foldAccents('ouvrir dossier hooks fichiers'), onLaunch: onOpenHooks });
    if (onRepoSettings) out.push({ key: 'system:settings', group: 'system', label: 'Réglages du repo…', detail: 'Actions et Hooks', search: foldAccents('reglages settings repo hook setup actions'), onLaunch: onRepoSettings });
    return out;
  }, [view.items, state, onItem, onSyncOverlay, onRepoSettings, onRerunSetup, onOpenHooks]);

  const counts = useMemo(() => {
    const c: Record<MenuGroupKind, number> = { pinned: 0, action: 0, launch: 0, npm: 0, make: 0, composer: 0, system: 0 };
    for (const r of rows) {
      c[r.group] += 1;
      if (r.item?.pinned) c.pinned += 1;
    }
    return c;
  }, [rows]);

  const groups = useMemo(() => {
    const matches = (r: MenuRow) => !nq || r.search.includes(nq);
    // Without search or filter, a pinned row only shows in ★ (no duplicate).
    const browsing = !nq && filter === 'all';
    return GROUP_ORDER
      .filter((g) => filter === 'all' || filter === g)
      .map((g) => ({
        kind: g,
        rows: g === 'pinned'
          ? rows.filter((r) => r.item?.pinned && matches(r) && (browsing || filter === 'pinned'))
          : rows.filter((r) => r.group === g && matches(r) && !(browsing && r.item?.pinned)),
      }))
      .filter((g) => g.rows.length > 0);
  }, [rows, nq, filter]);

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

  useEffect(() => setHighlight(-1), [nq, filter]);
  useEffect(() => {
    if (highlight < 0) return;
    panelRef.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const launch = (row: MenuRow) => {
    row.onLaunch();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      const row = flat[highlight] ?? (flat.length === 1 ? flat[0] : undefined);
      if (row) {
        e.preventDefault();
        launch(row);
      }
    } else if (e.key === 'Escape' && query) {
      e.stopPropagation();
      setQuery('');
    }
  };

  const running = state === 'running' || state === 'starting';
  const canStart = !!view.start && !running;
  const verb = (v: WorktreeVerb) => () => {
    onVerb(v);
    onClose();
  };
  const detected = view.items.filter((i) => i.layer === 'launch' || i.layer === 'detected').length;

  let index = 0;
  return (
    <FloatingPortal>
      <div
        ref={(node: HTMLDivElement | null) => {
          panelRef.current = node;
          floatingRef(node);
        }}
        style={floatingStyles}
        {...floatingProps}
        data-testid="worktree-action-menu"
        className="z-50 w-[380px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] shadow-xl"
      >
        <div ref={headerRef} className="sticky top-0 z-[2] border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 pb-2 pt-2">
          <div className="flex items-center gap-1.5 px-1 text-xs">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', view.start || running ? stateDotClass(state) : 'border border-[var(--theme-text-muted)]')} />
            <span className="font-semibold text-[var(--theme-text-primary)]">{name}</span>
            <span className="truncate font-mono text-[10px] text-[var(--theme-text-faint)]">{view.branch}</span>
            <span className={cn('ml-auto shrink-0 font-mono text-[10.5px]', stateTextClass(state))}>
              {state === 'running' && server.url ? server.url.replace(/^https?:\/\//, '') : STATE_LABEL[state]}
              {state === 'error' && server.exitCode !== undefined ? ` · exit ${server.exitCode}` : ''}
            </span>
          </div>
          <div className="mt-1.5 flex gap-1" role="toolbar" aria-label="Server">
            <VerbButton disabled={!canStart} onClick={verb('start')} title={view.start ? `Start: ${view.start.command}` : 'No start command configured'}>▶ Start</VerbButton>
            <VerbButton disabled={state === 'stopped'} onClick={verb('stop')}>■ Stop</VerbButton>
            <VerbButton disabled={!view.start} onClick={verb('restart')}>↻ Restart</VerbButton>
            <VerbButton disabled={state !== 'running' || !server.url} onClick={verb('open')}>↗ Open</VerbButton>
            <VerbButton onClick={verb('logs')}>≡ Logs</VerbButton>
          </div>
          {state === 'running' && server.endpoints && server.endpoints.length > 1 && (
            <div className="mt-1.5 flex flex-wrap gap-1" role="toolbar" aria-label="Services" data-testid="worktree-endpoints">
              {server.endpoints.map((e) => (
                <VerbButton key={e.name} onClick={() => { onOpenUrl(e.url); onClose(); }} title={e.url}>
                  ↗ {e.name}{e.port ? <span className="ml-1 font-mono text-[var(--theme-text-faint)]">:{e.port}</span> : null}
                </VerbButton>
              ))}
            </div>
          )}
          {setup && setup.state !== 'ok' && (
            <div className="mt-1.5 flex items-center gap-1.5 rounded bg-[var(--theme-bg-overlay)] px-2 py-1 text-[10.5px]" data-testid="setup-state">
              <span className={setup.state === 'failed' ? stateTextClass('error') : stateTextClass('starting')}>
                {setup.state === 'running' ? '● setup en cours' : '✗ setup échoué'}
              </span>
              {setup.state === 'failed' && setup.error && <span className="min-w-0 flex-1 truncate font-mono text-[var(--theme-text-muted)]" title={setup.error}>{setup.error.split('\n').filter(Boolean).pop()}</span>}
              {setup.runId && (
                <button type="button" className="ml-auto shrink-0 text-[var(--theme-accent)] hover:underline" onClick={(e) => { e.stopPropagation(); onSetupLogs(); onClose(); }}>voir les logs</button>
              )}
            </div>
          )}
          {!view.start && (
            <div className="mt-1.5 rounded bg-[var(--theme-bg-overlay)] px-2 py-1 text-[10.5px] text-[var(--theme-text-muted)]">
              Start non configuré : {detected} commande{detected > 1 ? 's' : ''} détectée{detected > 1 ? 's' : ''}.
              {onRepoSettings ? (
                <> <button type="button" className="text-[var(--theme-accent)] hover:underline" onClick={(e) => { e.stopPropagation(); onRepoSettings(); onClose(); }}>Configurer…</button> ou lance une config launch.json.</>
              ) : (
                <> Lance une config launch.json, ou ajoute <code className="font-mono">server.start</code> dans <code className="font-mono">.fleex/worktree.json</code>.</>
              )}
            </div>
          )}
          {view.sharedConfigError && (
            <div className="mt-1.5 rounded bg-[var(--theme-bg-overlay)] px-2 py-1 font-mono text-[10px] text-[var(--theme-text-muted)]">⚠ {view.sharedConfigError}</div>
          )}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onClick={(e) => e.stopPropagation()}
            placeholder="Filtrer — ou naviguer ↑ ↓"
            aria-label="Filter commands"
            className="mt-2 h-[28px] w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-2 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)]/50 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-1 border-b border-[var(--theme-border)] px-2 py-1.5">
          <Chip label="Tous" count={rows.length} active={filter === 'all'} onClick={() => setFilter('all')} />
          {GROUP_ORDER.filter((g) => counts[g] > 0).map((g) => (
            <Chip key={g} label={FILTER_LABEL[g]} count={counts[g]} active={filter === g} onClick={() => setFilter(g)} />
          ))}
        </div>

        {groups.length === 0 && <div className="px-3 py-3 text-xs text-[var(--theme-text-faint)]">Aucune commande ne correspond.</div>}
        {groups.map((g) => (
          <div key={g.kind}>
            <div className="sticky z-[1] bg-[var(--theme-bg-surface)] px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-faint)]" style={{ top: headerPx }}>
              {GROUP_LABEL[g.kind]}
            </div>
            {g.rows.map((row) => {
              const idx = index++;
              return (
                <Row key={`${g.kind}:${row.key}`} row={row} index={idx} active={highlight === idx} onHover={() => setHighlight(idx)} onLaunch={() => launch(row)} onPin={row.item ? () => onPin(row.item!, !row.item!.pinned) : undefined} />
              );
            })}
          </div>
        ))}

        <div className="sticky bottom-0 flex items-center gap-2 border-t border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-1 text-[9.5px] text-[var(--theme-text-faint)]">
          <span>↑↓ naviguer · ⏎ lancer · Échap fermer</span>
          <span className="ml-auto">{view.items.length} commande{view.items.length > 1 ? 's' : ''}</span>
        </div>
      </div>
    </FloatingPortal>
  );
}

function VerbButton({ children, disabled, onClick, title }: { children: ReactNode; disabled?: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex-1 rounded border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[10.5px] text-[var(--theme-text-secondary)] transition-colors enabled:hover:border-[var(--theme-accent)] enabled:hover:text-[var(--theme-text-primary)] disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function Chip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
        active
          ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]'
          : 'bg-[var(--theme-text-muted)]/10 text-[var(--theme-text-muted)] hover:bg-[var(--theme-text-muted)]/20',
      )}
    >
      <span>{label}</span>
      <span className="opacity-70">{count > 99 ? '99+' : count}</span>
    </button>
  );
}

function Row({ row, index, active, onHover, onLaunch, onPin }: { row: MenuRow; index: number; active: boolean; onHover: () => void; onLaunch: () => void; onPin?: () => void }) {
  const glyph = SOURCE_GLYPH[row.group];
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      aria-selected={active}
      data-index={index}
      onMouseEnter={onHover}
      onClick={(e) => {
        e.stopPropagation();
        onLaunch();
      }}
      className={cn(
        'group flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left text-xs transition-colors',
        'scroll-mb-8 scroll-mt-[170px]',
        active ? 'bg-[var(--theme-bg-hover)]' : 'hover:bg-[var(--theme-bg-hover)]',
        row.dim && 'opacity-50',
      )}
    >
      <span className={cn('w-3 shrink-0 text-center font-mono text-[10px] font-bold', glyph.className)}>{glyph.glyph}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[var(--theme-text-primary)]">{row.label}</span>
          {row.scope && <span className="shrink-0 rounded bg-[var(--theme-bg-overlay)] px-1 text-[9px] text-[var(--theme-text-muted)]">{row.scope}</span>}
        </span>
        {row.detail && <span className="truncate font-mono text-[9.5px] text-[var(--theme-text-faint)]">{row.detail}</span>}
      </span>
      {row.terminal && <span className="shrink-0 rounded border border-[var(--theme-border)] px-1 text-[9px] text-[var(--theme-text-muted)]">term</span>}
      {onPin && (
        <button
          type="button"
          aria-label={row.item?.pinned ? `Unpin ${row.label}` : `Pin ${row.label}`}
          title={row.item?.pinned ? 'Désépingler' : 'Épingler (perso)'}
          onClick={(e) => {
            e.stopPropagation();
            onPin();
          }}
          className={cn(
            'shrink-0 px-0.5 text-[12px] leading-none transition-colors hover:text-[var(--theme-accent)]',
            // Faint but always there: a touch screen has no hover to reveal it.
            row.item?.pinned ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-faint)] opacity-40 group-hover:opacity-100 focus:opacity-100',
            active && 'opacity-100',
          )}
        >
          {row.item?.pinned ? '★' : '☆'}
        </button>
      )}
    </div>
  );
}

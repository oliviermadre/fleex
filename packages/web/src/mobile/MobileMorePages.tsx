import { useEffect, useMemo, useState } from 'react';
import { NOOP } from './noop';
import type { PulseLevel } from '../notifications/types';
import { useNotificationStore } from '../stores/notificationStore';
import { useTicketStore } from '../stores/ticketStore';
import { useRoutineStore } from '../stores/routineStore';
import { useScratchpadStore } from '../stores/scratchpadStore';
import { useDocumentsStore } from '../stores/documentsStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useRepositoryDashboardStore } from '../stores/repositoryDashboardStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import * as api from '../services/api';
import { describeTrigger, formatRelativeTime } from '../components/routines/RoutineDetail';
import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';
import { MarkdownEditor } from '../components/markdown/MarkdownEditor';
import { BUILT_IN_THEMES } from '../lib/themes';
import { RoutineIcon } from '../lib/primitives';
import { formatAge } from '../lib/formatAge';
import { cn } from '../lib/cn';
import { tint, tintClasses } from '../lib/tints';
import { useMobileNavStore } from './mobileNavStore';
import { setMobileOverride } from './useMobileMode';

const LEVEL_DOT: Record<PulseLevel, string> = {
  info: 'bg-[var(--tint-blue-solid)]',
  success: 'bg-[var(--tint-green-solid)]',
  warning: 'bg-[var(--tint-yellow-solid)]',
  error: 'bg-[var(--tint-red-solid)]',
  action: 'bg-[var(--tint-purple-solid)]',
};

/** Same pill style as the Kanban status chips. */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-11 shrink-0 rounded-full px-4 text-[13px] font-medium',
        active ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]' : 'bg-[var(--theme-bg-secondary)] text-[var(--theme-text-muted)]',
      )}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-12 text-center text-sm text-[var(--theme-text-faint)]">{children}</p>;
}

/** Full-screen reader/editor shell used by Notes and Documents. */
function FullScreen({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[45] flex flex-col bg-[var(--theme-bg-base)]">
      <header
        className="flex shrink-0 items-center gap-2 border-b border-[var(--theme-border)] px-2 py-2"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}
      >
        <button type="button" onClick={onClose} className="min-h-11 px-2 text-[15px] text-[var(--theme-accent)]" aria-label="Retour">
          ‹ Retour
        </button>
        <h2 className="min-w-0 flex-1 truncate text-center text-sm font-semibold">{title}</h2>
        <span className="w-16" />
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {children}
      </div>
    </div>
  );
}

// ── Notifications ──

export function MobileNotificationsPage() {
  const notifications = useNotificationStore((s) => s.notifications);
  const markAllSeen = useNotificationStore((s) => s.markAllSeen);
  const clear = useNotificationStore((s) => s.clear);
  const tickets = useTicketStore((s) => s.tickets);
  const openTicket = useMobileNavStore((s) => s.openTicket);
  const openMorePage = useMobileNavStore((s) => s.openMorePage);

  useEffect(() => {
    markAllSeen();
  }, [markAllSeen]);

  if (notifications.length === 0) return <Empty>Aucune notification</Empty>;
  return (
    <div className="flex flex-col gap-2 p-3">
      <button type="button" onClick={clear} className="min-h-11 self-end px-2 text-sm text-[var(--theme-accent)]">
        Tout effacer
      </button>
      {notifications.map((n) => {
        const ticket = n.ticketId ? tickets.find((t) => t.id === n.ticketId) : null;
        return (
          <button
            key={n.id}
            type="button"
            onClick={() => {
              if (!n.ticketId) return;
              openMorePage(null);
              openTicket(n.ticketId);
            }}
            className="flex gap-2.5 rounded-[10px] border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3 text-left"
          >
            <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', LEVEL_DOT[n.level])} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-[var(--theme-text-primary)]">
                {n.emoji} {n.title}
              </span>
              <span className="block text-[12.5px] text-[var(--theme-text-secondary)]">
                {ticket ? `#${ticket.displayId} ${ticket.title}` : n.body}
              </span>
            </span>
            <span className="shrink-0 text-[11px] text-[var(--theme-text-faint)]">{formatAge(n.createdAt)}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Routines ──

export function MobileRoutinesPage() {
  const routines = useRoutineStore((s) => s.routines);
  const loading = useRoutineStore((s) => s.loading);
  const { load, update, launch } = useRoutineStore.getState();
  useEffect(() => {
    void load();
  }, [load]);

  if (routines.length === 0) return <Empty>{loading ? 'Chargement…' : 'Aucune routine'}</Empty>;
  return (
    <div className="flex flex-col gap-2.5 p-3">
      {routines.map((r) => (
        <div key={r.id} className="flex flex-col gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3">
          <div className="flex items-center gap-2">
            <RoutineIcon size={18} className={cn(!r.enabled && 'opacity-40')} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.name}</span>
            <button
              type="button"
              role="switch"
              aria-checked={r.enabled}
              aria-label={r.enabled ? 'Mettre en pause' : 'Activer'}
              onClick={() => void update(r.id, { enabled: !r.enabled }).then(load)}
              className="flex h-11 w-12 shrink-0 items-center justify-center"
            >
              <span className={cn('flex h-6 w-10 items-center rounded-full p-0.5 transition-colors', r.enabled ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-bg-overlay)]')}>
                <span className={cn('h-5 w-5 rounded-full bg-white transition-transform', r.enabled && 'translate-x-4')} />
              </span>
            </button>
          </div>
          <p className="text-[12px] text-[var(--theme-text-muted)]">{describeTrigger(r.trigger)} · {r.target.kind} {r.target.ref}</p>
          <p className="text-[12px] text-[var(--theme-text-muted)]">
            Dernier : {r.lastRunAt ? formatRelativeTime(r.lastRunAt) : '—'} ·{' '}
            <span className={r.awaitingAttention ? tintClasses('yellow').text : undefined}>
              {r.awaitingAttention ? 'attend ta décision' : r.nextRunAt ? `Prochain : ${new Date(r.nextRunAt).toLocaleString()}` : 'Prochain : —'}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {r.awaitingAttention && <GateButtons routineId={r.id} />}
            <button
              type="button"
              onClick={() => void launch(r.id)}
              className="h-11 rounded-lg border border-[var(--theme-border-input)] px-3.5 text-[13px] font-medium"
            >
              Lancer maintenant
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Outcome buttons of the gate a routine run is stopped on. */
function GateButtons({ routineId }: { routineId: string }) {
  const [gate, setGate] = useState<{ runId: string; stepRunId: string; outcomes: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await useRoutineStore.getState().select(routineId);
      if (cancelled) return;
      for (const d of useRoutineStore.getState().runs) {
        for (const sr of d.stepRuns) {
          if (sr.status !== 'needs_review') continue;
          const step = d.run.templateSnapshot.steps.find((s) => s.id === sr.stepId);
          if (step?.executorType !== 'human_gate') continue;
          const outcomes = ((sr.output?.schemaFields?.['outcomes'] as string[] | undefined) ?? step.humanGateOutcomes ?? []) as string[];
          setGate({ runId: d.run.id, stepRunId: sr.id, outcomes });
          return;
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [routineId]);

  if (!gate) return null;
  return (
    <>
      {gate.outcomes.map((o, i) => (
        <button
          key={o}
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.resolveWorkflowGate(gate.runId, gate.stepRunId, { outcome: o });
              setGate(null);
              await useRoutineStore.getState().load();
            } finally {
              setBusy(false);
            }
          }}
          className={cn('h-11 rounded-lg px-3.5 text-[13px] font-semibold disabled:opacity-50', i === 0 ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]' : 'border border-[var(--theme-border-input)]')}
        >
          {o}
        </button>
      ))}
    </>
  );
}

// ── Notes ──

export function MobileNotesPage() {
  const list = useScratchpadStore((s) => s.scratchpadList);
  const loaded = useScratchpadStore((s) => s.scratchpadListLoaded);
  const repos = useSettingsStore((s) => s.settings.repositories);
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    void useScratchpadStore.getState().loadScratchpadList(repos);
  }, [repos]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof list>();
    for (const n of list) {
      const g = n.key === '__global__' ? 'Global' : n.key;
      m.set(g, [...(m.get(g) ?? []), n]);
    }
    return [...m.entries()];
  }, [list]);

  if (loaded && list.length === 0) return <Empty>Aucune note</Empty>;
  return (
    <div className="flex flex-col gap-3 p-3">
      {groups.map(([repo, notes]) => (
        <section key={repo} className="flex flex-col gap-2">
          <h2 className="px-1 font-mono text-[11px] text-[var(--theme-text-faint)]">{repo}</h2>
          {notes.map((n) => (
            <button
              key={n.key}
              type="button"
              onClick={() => setOpenKey(n.key)}
              className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3 text-left"
            >
              <span className="block text-sm font-semibold">{n.label}</span>
              <span className="block text-[12px] text-[var(--theme-text-muted)]">{n.lineCount} lignes</span>
            </button>
          ))}
        </section>
      ))}
      {openKey && <NoteEditor noteKey={openKey} onClose={() => setOpenKey(null)} />}
    </div>
  );
}

function NoteEditor({ noteKey, onClose }: { noteKey: string; onClose: () => void }) {
  const entry = useScratchpadStore((s) => s.entries[noteKey]);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    void useScratchpadStore.getState().load(noteKey);
  }, [noteKey]);
  const close = () => {
    useScratchpadStore.getState().flushSave(noteKey);
    onClose();
  };
  return (
    <FullScreen title={noteKey === '__global__' ? 'Global' : noteKey} onClose={close}>
      {editing ? (
        <MarkdownEditor
          surfaceKind="scratchpad_mobile"
          defaultMode="write"
          className="px-4 py-3"
          value={entry?.content ?? ''}
          onChange={(v) => useScratchpadStore.getState().setContent(noteKey, v)}
          placeholder="Note (markdown)…"
        />
      ) : (
        <div className="px-4 py-3 text-sm">
          <MarkdownRenderer content={entry?.content ?? ''} onToggleCheckbox={NOOP} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setEditing((e) => !e)}
        className="fixed bottom-6 right-4 min-h-11 rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] px-4 text-sm font-medium shadow-lg"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        {editing ? '✓ Terminer' : '✎ Modifier'}
      </button>
    </FullScreen>
  );
}

// ── Documents ──

export function MobileDocumentsPage() {
  const docs = useDocumentsStore((s) => s.deliverables);
  const facets = useDocumentsStore((s) => s.facets);
  const filterTypes = useDocumentsStore((s) => s.filterTypes);
  const loading = useDocumentsStore((s) => s.loading);
  const total = useDocumentsStore((s) => s.total);
  const search = useDocumentsStore((s) => s.search);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    void useDocumentsStore.getState().fetchAll();
  }, []);

  const open = docs.find((d) => d.id === openId) ?? null;
  const only = filterTypes.size === 1 ? [...filterTypes][0]! : null;

  return (
    <div>
      <div className="px-3 pt-3">
        <input
          type="search"
          value={search}
          onChange={(e) => useDocumentsStore.getState().setSearch(e.target.value)}
          placeholder="Rechercher un document…"
          aria-label="Rechercher un document"
          className="h-11 w-full rounded-[10px] border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-3 text-base text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none"
        />
      </div>
      <nav className="flex gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
        <Chip active={filterTypes.size === 0} onClick={() => useDocumentsStore.getState().clearFilters()}>
          Tous
        </Chip>
        {facets.types.map((t) => (
          <Chip
            key={t.value}
            active={only === t.value}
            onClick={() => {
              const st = useDocumentsStore.getState();
              if (only !== t.value) {
                st.clearFilters();
                st.toggleFilter('filterTypes', t.value);
              }
            }}
          >
            {t.value}
          </Chip>
        ))}
      </nav>
      <div className="flex flex-col gap-2 p-3">
        {docs.length === 0 && <Empty>{loading ? 'Chargement…' : 'Aucun document'}</Empty>}
        {docs.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setOpenId(d.id)}
            className="flex flex-col gap-1 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3 text-left"
          >
            <span className="flex items-center gap-2">
              <span className={cn('rounded-full px-2 py-px text-[10.5px] font-semibold', tint('blue'))}>{d.type}</span>
              <span className="text-[11px] text-[var(--theme-text-faint)]">{d.status}</span>
            </span>
            <span className="text-sm font-semibold">{d.title}</span>
            <span className="text-[12px] text-[var(--theme-text-muted)]">
              {d.origin?.label ?? d.agentName} · {formatAge(d.updatedAt)}
            </span>
          </button>
        ))}
        {docs.length < total && (
          <button type="button" onClick={() => void useDocumentsStore.getState().loadMore()} className="min-h-11 text-sm text-[var(--theme-accent)]">
            Charger plus
          </button>
        )}
      </div>
      {open && (
        <FullScreen title={open.title} onClose={() => setOpenId(null)}>
          <div className="px-4 py-3 text-sm">
            <MarkdownRenderer content={open.content} onToggleCheckbox={NOOP} />
          </div>
        </FullScreen>
      )}
    </div>
  );
}

// ── Repositories ──

export function MobileReposPage() {
  const repos = useRepositoryStore((s) => s.repositories);
  const worktreesByRepo = useRepositoryStore((s) => s.worktreesByRepo);
  const summaries = useRepositoryDashboardStore((s) => s.summaries);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);

  useEffect(() => {
    void useRepositoryStore.getState().fetchRepositories();
    void useRepositoryDashboardStore.getState().fetchSummaries();
  }, []);
  useEffect(() => {
    for (const r of repos) void useRepositoryStore.getState().fetchWorktrees(r.org, r.name);
  }, [repos]);

  if (repos.length === 0) return <Empty>Aucun repository</Empty>;
  return (
    <div className="flex flex-col gap-2.5 p-3">
      {repos.map((r) => {
        const key = `${r.org}/${r.name}`;
        const summary = summaries[key];
        const wts = worktreesByRepo[key];
        const group = sessionGroups.find((g) => g.repositoryOrg === r.org && g.repositoryName === r.name);
        const diff = (group?.worktrees ?? []).reduce(
          (acc, w) => ({ a: acc.a + (w.diffStats?.additions ?? 0), d: acc.d + (w.diffStats?.deletions ?? 0) }),
          { a: 0, d: 0 },
        );
        const cells: [string, string][] = [
          ['PRs', summary ? String(summary.openPRsCount) : '—'],
          ['Issues', summary ? String(summary.openIssuesCount) : '—'],
          ['Worktrees', wts ? String(wts.filter((w) => !w.isMain && !w.isBare).length) : '—'],
          ['Diff', diff.a || diff.d ? `+${diff.a} −${diff.d}` : '—'],
        ];
        return (
          <div key={key} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3">
            <p className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold">{key}</span>
              <span className="shrink-0 text-[11px] text-[var(--theme-text-muted)]">⎇ {r.defaultBranch}</span>
            </p>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {cells.map(([label, value]) => (
                <div key={label} className="rounded-lg bg-[var(--theme-bg-base)] px-2 py-1.5 text-center">
                  <p className="text-[13px] font-semibold tabular-nums">{value}</p>
                  <p className="text-[10px] text-[var(--theme-text-faint)]">{label}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Settings ──

export function MobileSettingsPage() {
  const activeThemeId = useSettingsStore((s) => s.settings.activeThemeId);
  const customThemes = useSettingsStore((s) => s.settings.customThemes);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const workspace = useSettingsStore((s) => s.settings.workspace);
  const themes = [...BUILT_IN_THEMES, ...customThemes];

  return (
    <div className="flex flex-col gap-4 p-3">
      <section>
        <h2 className="px-1 pb-1.5 text-[10.5px] font-semibold tracking-[0.06em] text-[var(--theme-text-muted)]">THÈME</h2>
        <div className="grid grid-cols-3 gap-2">
          {themes.map((t) => {
            const active = t.id === activeThemeId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => void saveSettings({ activeThemeId: t.id })}
                aria-pressed={active}
                className={cn(
                  'flex flex-col gap-1.5 rounded-xl border-[1.5px] bg-[var(--theme-bg-surface)] p-2 text-left',
                  active ? 'border-[var(--theme-accent)]' : 'border-[var(--theme-border)]',
                )}
              >
                <span className="flex h-[34px] items-center gap-1.5 rounded-md px-1.5" style={{ background: t.colors.bgBase }}>
                  <span className="h-2 flex-1 rounded-sm" style={{ background: t.colors.bgSurface }} />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.colors.accent }} />
                </span>
                <span className="flex items-center gap-1 text-[12px]">
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {active && <span className="text-[var(--theme-accent)]">✓</span>}
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <section>
        <h2 className="px-1 pb-1.5 text-[10.5px] font-semibold tracking-[0.06em] text-[var(--theme-text-muted)]">MOBILE</h2>
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-[14px]">
          <Row label="Workspace" value={workspace || '—'} />
          <button
            type="button"
            onClick={() => setMobileOverride('desktop')}
            className="flex min-h-11 w-full items-center justify-between px-3 text-left"
          >
            <span className="text-[var(--theme-text-muted)]">Vue</span>
            <span className="text-[13px] text-[var(--theme-accent)]">Passer en vue desktop</span>
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex min-h-11 w-full items-center justify-between border-t border-[var(--theme-border-subtle)] px-3 text-left"
          >
            <span className="text-[var(--theme-text-muted)]">Application</span>
            <span className="text-[13px] text-[var(--theme-accent)]">Recharger l’app</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between border-b border-[var(--theme-border-subtle)] px-3">
      <span className="text-[var(--theme-text-muted)]">{label}</span>
      <span className="font-mono text-[12px]">{value}</span>
    </div>
  );
}

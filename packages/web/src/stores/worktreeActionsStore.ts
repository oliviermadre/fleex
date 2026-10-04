import { create } from 'zustand';
import {
  WORKTREE_LOGS_SLOT, WORKTREE_STOP_SLOT,
  WORKTREE_START_SLOT,
  runSlotKey,
  worktreeSourceId,
  type ActionRunRequest,
  type WorktreeActionItem,
  type WorktreeActionsView,
  type WorktreeActionsWsMessage,
  type WorktreeServerSnapshot,
  type WorktreeSetupSnapshot,
  type WorktreeVerb,
} from '@fleex/shared';
import * as api from '../services/api';
import { usePinnedActionsStore } from './pinnedActionsStore';
import { useBrowserStore } from './browserStore';
import { useWorkStore } from './workStore';
import { useToastStore } from './toastStore';

/** Short repo name of a worktree: `fleex` for `oliviermadre/fleex`, else the folder name. */
export function worktreeName(view: Pick<WorktreeActionsView, 'repo' | 'path'>): string {
  return view.repo?.split('/')[1] ?? view.path.split('/').filter(Boolean).pop() ?? view.path;
}

/**
 * Open a worktree's URL: in the ticket's browser panel in the desktop shell,
 * else in a new browser tab.
 */
export function openWorktreeUrl(url: string, ticketId: string | null): void {
  if (ticketId && typeof window !== 'undefined' && window.fleexDesktop) {
    useBrowserStore.getState().openTab(ticketId, url);
    useWorkStore.getState().setRightPanel('browser');
    return;
  }
  window.open(url, '_blank');
}

/** The newer of two snapshots of the same worktree (WS pushes may beat a fetch). */
function newer(a: WorktreeServerSnapshot | undefined, b: WorktreeServerSnapshot): WorktreeServerSnapshot {
  return a && a.updatedAt > b.updatedAt ? a : b;
}

/**
 * Per ticket workspace, bumped by every load and every pin: an answer is kept
 * only if nothing newer started since — a menu-open load that comes back after
 * a ★ click must not bring the old star back.
 */
const loadGeneration: Record<string, number> = {};
const bumpGeneration = (root: string) => (loadGeneration[root] = (loadGeneration[root] ?? 0) + 1);

interface WorktreeActionsState {
  /** Views per ticket workspace path, as last fetched. */
  byRoot: Record<string, WorktreeActionsView[]>;
  /** Live server state per worktree path (fetches + `worktree-server:update` pushes). */
  servers: Record<string, WorktreeServerSnapshot>;
  /** Last Setup run per worktree path (fetches + `worktree-setup:update` pushes). */
  setups: Record<string, WorktreeSetupSnapshot>;
  load: (root: string) => Promise<void>;
  /** Re-fetch every workspace already shown (after a WebSocket reconnect: pushes may have been missed). */
  reloadAll: () => Promise<void>;
  /** "Relancer le Setup": file hooks then the Setup script, in the action engine. */
  rerunSetup: (view: WorktreeActionsView) => Promise<void>;
  openHooksDir: (repo: string) => Promise<void>;
  /** Logs of the last Setup run. */
  showSetupLogs: (view: WorktreeActionsView) => void;
  handleWsMessage: (msg: WorktreeActionsWsMessage) => void;
  runVerb: (view: WorktreeActionsView, verb: WorktreeVerb, ticketId: string | null) => Promise<void>;
  runItem: (view: WorktreeActionsView, item: WorktreeActionItem) => Promise<void>;
  setPinned: (root: string, view: WorktreeActionsView, id: string, pinned: boolean) => Promise<void>;
}

/**
 * The WORKTREES buttons: each worktree's menu (fetched, refreshed when a menu
 * opens) and its dev server's state (pushed). Commands run through the
 * pinned-actions store, so they get the same terminals, logs and toasts.
 */
export const useWorktreeActionsStore = create<WorktreeActionsState>((set, get) => ({
  byRoot: {},
  servers: {},
  setups: {},

  load: async (root) => {
    const generation = bumpGeneration(root);
    let worktrees: WorktreeActionsView[];
    try {
      ({ worktrees } = await api.fetchWorktreeActions(root));
    } catch {
      return; // silent: no workspace yet, or a server without the route
    }
    if (loadGeneration[root] !== generation) return; // a newer load or a pin since
    set((s) => {
      const servers = { ...s.servers };
      const setups = { ...s.setups };
      for (const w of worktrees) {
        servers[w.path] = newer(servers[w.path], w.server);
        if (w.setup && (!setups[w.path] || setups[w.path]!.startedAt <= w.setup.startedAt)) setups[w.path] = w.setup;
      }
      return { byRoot: { ...s.byRoot, [root]: worktrees }, servers, setups };
    });
  },

  reloadAll: async () => {
    await Promise.all(Object.keys(get().byRoot).map((root) => get().load(root)));
  },

  handleWsMessage: (msg) => {
    if (msg.type === 'worktree-setup:update') {
      set((s) => ({ setups: { ...s.setups, [msg.data.path]: msg.data } }));
      return;
    }
    if (msg.type !== 'worktree-server:update') return;
    set((s) => ({ servers: { ...s.servers, [msg.data.path]: newer(s.servers[msg.data.path], msg.data) } }));
  },

  rerunSetup: async (view) => {
    try {
      const res = await api.runWorktreeHook(view.path, 'setup');
      if (res.setup) set((s) => ({ setups: { ...s.setups, [view.path]: res.setup! } }));
    } catch { /* toasted */ }
  },

  openHooksDir: async (repo) => {
    try {
      const { dir } = await api.openWorktreeHooksDir(repo);
      useToastStore.getState().addToast('info', `Dossier des hooks : ${dir}`);
    } catch { /* toasted */ }
  },

  showSetupLogs: (view) => {
    const runId = get().setups[view.path]?.runId;
    if (runId) usePinnedActionsStore.getState().openLogs({ sourceId: worktreeSourceId(view.path), label: `${worktreeName(view)} · setup`, runId });
  },

  runVerb: async (view, verb, ticketId) => {
    const server = get().servers[view.path] ?? view.server;
    // A known URL opens at once, without a round trip.
    if (verb === 'open' && server.state === 'running' && server.url) {
      openWorktreeUrl(server.url, ticketId);
      return;
    }
    let res;
    try {
      res = await api.runWorktreeAction({ path: view.path, verb });
    } catch {
      return; // toasted
    }
    set((s) => ({ servers: { ...s.servers, [view.path]: newer(s.servers[view.path], res.server) } }));
    if (verb === 'open' && res.url) openWorktreeUrl(res.url, ticketId);
    if (verb === 'logs' && res.run?.slot === WORKTREE_LOGS_SLOT) {
      // server.logs: its own terminal (docker compose logs -f, fleex logs…).
      const sourceId = worktreeSourceId(view.path);
      usePinnedActionsStore.getState().openTerminal({ key: runSlotKey(sourceId, WORKTREE_LOGS_SLOT), sourceId, sourceKind: 'worktree', runId: res.run.runId, label: `${worktreeName(view)} · logs`, command: res.run.command, cwd: view.path });
    } else if (verb === 'logs') showServerLogs(view, res.runId, res.server);
    if (verb === 'stop' && res.run?.mode === 'terminal') {
      // server.stopIn = terminal: the stop command may ask for a confirmation — show its terminal.
      const sourceId = worktreeSourceId(view.path);
      usePinnedActionsStore.getState().openTerminal({ key: runSlotKey(sourceId, WORKTREE_STOP_SLOT), sourceId, sourceKind: 'worktree', runId: res.run.runId, label: `${worktreeName(view)} · stop`, command: res.run.command, cwd: view.path });
    }
  },

  runItem: async (view, item) => {
    // A launch.json configuration starts the server (it is a start target).
    if (item.source === 'launch') {
      try {
        const res = await api.runWorktreeAction({ path: view.path, id: item.id });
        set((s) => ({ servers: { ...s.servers, [view.path]: newer(s.servers[view.path], res.server) } }));
      } catch { /* toasted */ }
      return;
    }
    const request: ActionRunRequest = {
      sourceId: worktreeSourceId(view.path),
      sourceKind: 'worktree',
      label: `${worktreeName(view)} · ${item.label}`,
      command: item.command,
      mode: item.mode,
      slot: item.id,
      cwd: item.cwd ? `${view.path}/${item.cwd}` : view.path,
    };
    await usePinnedActionsStore.getState().run(request, {}, async () => {
      const res = await api.runWorktreeAction({ path: view.path, id: item.id });
      return { runId: res.runId ?? '', alreadyRunning: !!res.alreadyRunning, ...(res.run ? { run: res.run } : {}) };
    });
  },

  setPinned: async (root, view, id, pinned) => {
    // Optimistic: the star moves at once, the answer is the merged truth.
    const patch = (views: WorktreeActionsView[] | undefined, next: (v: WorktreeActionsView) => WorktreeActionsView) =>
      (views ?? []).map((v) => (v.path === view.path ? next(v) : v));
    set((s) => ({ byRoot: { ...s.byRoot, [root]: patch(s.byRoot[root], (v) => ({ ...v, items: v.items.map((i) => (i.id === id ? { ...i, pinned } : i)) })) } }));
    bumpGeneration(root); // a load already in flight predates this pin
    try {
      const fresh = await api.setWorktreeItemPinned(view.path, id, pinned);
      set((s) => ({ byRoot: { ...s.byRoot, [root]: patch(s.byRoot[root], () => fresh) } }));
    } catch {
      void get().load(root);
    }
  },
}));

/** Logs of the server: its live terminal while it runs, else the last start run's log. */
function showServerLogs(view: WorktreeActionsView, runId: string | undefined, server: WorktreeServerSnapshot): void {
  const actions = usePinnedActionsStore.getState();
  const sourceId = worktreeSourceId(view.path);
  const label = `${worktreeName(view)} · ${view.start?.label ?? 'start'}`;
  if (!runId) {
    useToastStore.getState().addToast('info', server.tmuxSession
      ? `${worktreeName(view)}: started before this Fleex session — tmux attach -t ${server.tmuxSession}`
      : `${worktreeName(view)}: no server run yet`);
    return;
  }
  const live = server.runId === runId && (server.state === 'starting' || server.state === 'running');
  if (live && server.tmuxSession) {
    actions.openTerminal({ key: runSlotKey(sourceId, WORKTREE_START_SLOT), sourceId, sourceKind: 'worktree', runId, label, command: view.start?.command ?? '', cwd: view.path });
    return;
  }
  actions.openLogs({ sourceId, label, runId });
}

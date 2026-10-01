import { create } from 'zustand';
import type { ActionRun, ActionRunRequest, PinnedStatusWsMessage, StatusSnapshot } from '@fleex/shared';
import * as api from '../services/api';
import { useToastStore } from './toastStore';

/** Runs started from Settings ("Try") are shown inline there, never as a toast. */
export const DRAFT_SOURCE_PREFIX = 'draft:';
const RUNS_KEPT = 20;

interface LogsTarget {
  sourceId: string;
  label: string;
  runId?: string;
}

interface PinnedActionsState {
  statuses: Record<string, StatusSnapshot>;
  /** Newest first, per source id. */
  runs: Record<string, ActionRun[]>;
  /** Source ids with a run in flight. */
  running: Record<string, string>;
  logs: LogsTarget | null;

  loadStatuses: () => Promise<void>;
  handleWsMessage: (msg: PinnedStatusWsMessage) => void;
  run: (request: ActionRunRequest) => Promise<void>;
  loadRuns: (sourceId: string) => Promise<void>;
  /** After a WS (re)connect: a missed `action-run:finished` must not leave a button spinning. */
  reconcileRuns: () => Promise<void>;
  refresh: (iconId?: string) => Promise<void>;
  openLogs: (target: LogsTarget) => void;
  closeLogs: () => void;
}

function durationSec(run: ActionRun): string {
  if (!run.finishedAt) return '';
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  return `${(ms / 1000).toFixed(1)} s`;
}

function firstLine(text: string): string {
  return text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
}

function upsertRun(list: ActionRun[] | undefined, run: ActionRun): ActionRun[] {
  const rest = (list ?? []).filter((r) => r.runId !== run.runId);
  return [run, ...rest].slice(0, RUNS_KEPT);
}

/** Toast at the end of a run: ✓ with its duration, ✗ with the exit code and first stderr line, or a timeout. */
export function announceRun(run: ActionRun, openLogs: (t: LogsTarget) => void): void {
  const { addToast } = useToastStore.getState();
  const action = { label: 'View logs', onClick: () => openLogs({ sourceId: run.sourceId, label: run.label, runId: run.runId }) };
  if (run.timedOut) {
    addToast('warning', `${run.label} timed out`, { action, durationMs: 8000 });
    return;
  }
  if (run.exitCode === 0) {
    addToast('success', `✓ ${run.label} (${durationSec(run)})`);
    return;
  }
  const code = run.exitCode === undefined ? 'failed' : `exit ${run.exitCode}`;
  addToast('error', `✗ ${run.label} — ${code}`, {
    detail: firstLine(run.stderr) || firstLine(run.stdout) || undefined,
    action,
    durationMs: 8000,
  });
}

/**
 * Live state of the action buttons: probe results and run outcomes pushed on
 * the `pinned-status` WS channel, plus which run's logs are open. Kept apart
 * from settingsStore because none of it is configuration — it is all derived
 * from the server and lost on reload, by design.
 */
export const usePinnedActionsStore = create<PinnedActionsState>((set, get) => ({
  statuses: {},
  runs: {},
  running: {},
  logs: null,

  loadStatuses: async () => {
    try {
      const snapshots = await api.fetchPinnedStatuses();
      set({ statuses: Object.fromEntries(snapshots.map((s) => [s.iconId, s])) });
    } catch { /* toasted by request() */ }
  },

  handleWsMessage: (msg) => {
    switch (msg.type) {
      case 'pinned-status:snapshot':
        set({ statuses: Object.fromEntries(msg.data.map((s) => [s.iconId, s])) });
        break;
      case 'pinned-status:update':
        set((s) => ({ statuses: { ...s.statuses, [msg.data.iconId]: msg.data } }));
        break;
      case 'action-run:started':
        set((s) => ({
          running: { ...s.running, [msg.data.sourceId]: msg.data.runId },
          runs: { ...s.runs, [msg.data.sourceId]: upsertRun(s.runs[msg.data.sourceId], msg.data) },
        }));
        break;
      case 'action-run:finished': {
        const run = msg.data;
        set((s) => {
          const running = { ...s.running };
          delete running[run.sourceId];
          return { running, runs: { ...s.runs, [run.sourceId]: upsertRun(s.runs[run.sourceId], run) } };
        });
        if (!run.sourceId.startsWith(DRAFT_SOURCE_PREFIX)) announceRun(run, get().openLogs);
        break;
      }
    }
  },

  run: async (request) => {
    if (get().running[request.sourceId]) return;
    // Optimistic: the button shows its spinner before the WS echo arrives.
    set((s) => ({ running: { ...s.running, [request.sourceId]: 'pending' } }));
    try {
      const { runId } = await api.startActionRun(request);
      set((s) => (s.running[request.sourceId] === 'pending' ? { running: { ...s.running, [request.sourceId]: runId } } : s));
    } catch {
      set((s) => {
        const running = { ...s.running };
        delete running[request.sourceId];
        return { running };
      });
    }
  },

  loadRuns: async (sourceId) => {
    try {
      const runs = await api.fetchActionRuns(sourceId);
      set((s) => ({ runs: { ...s.runs, [sourceId]: runs } }));
    } catch { /* toasted */ }
  },

  reconcileRuns: async () => {
    // Only entries already in flight when we ask: a run started meanwhile is not in the answer yet.
    const asked = get().running;
    let serverRuns: ActionRun[];
    try {
      serverRuns = await api.fetchActionRuns();
    } catch { return; /* toasted */ }
    const byId = new Map(serverRuns.map((r) => [r.runId, r]));
    set((s) => {
      const running = { ...s.running };
      for (const [sourceId, runId] of Object.entries(asked)) {
        if (runId === 'pending' || running[sourceId] !== runId) continue;
        const known = byId.get(runId);
        // Finished, or unknown to the server (restarted): it will never report back.
        if (!known || known.finishedAt) delete running[sourceId];
      }
      const runs = { ...s.runs };
      for (const r of [...serverRuns].reverse()) runs[r.sourceId] = upsertRun(runs[r.sourceId], r);
      return { running, runs };
    });
  },

  refresh: async (iconId) => {
    try {
      await api.refreshPinnedStatus(iconId);
    } catch { /* toasted */ }
  },

  openLogs: (target) => {
    set({ logs: target });
    void get().loadRuns(target.sourceId);
  },

  closeLogs: () => set({ logs: null }),
}));

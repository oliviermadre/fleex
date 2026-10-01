import { create } from 'zustand';
import {
  ACTION_MAX_TIMEOUT_SEC,
  diagnoseRun,
  type ActionRun,
  type ActionRunCapabilities,
  type ActionRunOutputChunk,
  type ActionRunRequest,
  type ActionSourceKind,
  type PinnedStatusWsMessage,
  type StatusSnapshot,
} from '@fleex/shared';
import * as api from '../services/api';
import { useToastStore } from './toastStore';

/** Runs started from Settings ("Try") are shown inline there, never as a toast. */
export const DRAFT_SOURCE_PREFIX = 'draft:';
const RUNS_KEPT = 20;
/** Client cap on the live output kept per run: the tail is what matters while it runs. */
export const LIVE_OUTPUT_CAP = 64 * 1024;
/** A run shorter than this gets no "running…" toast — only its final one. */
export const START_TOAST_DELAY_MS = 3000;

interface LogsTarget {
  sourceId: string;
  label: string;
  runId?: string;
}

/** stdout + stderr of a run in flight, in `seq` order, capped to the last LIVE_OUTPUT_CAP chars. */
export interface LiveOutput {
  chunks: { seq: number; text: string }[];
  text: string;
  /** Not shown live: dropped by the server, or cut by the client cap. Still in the final log. */
  dropped: number;
  /** Chunks at or below this seq were (at least partly) cut: a late one only adds to `dropped`. */
  floorSeq: number;
}

/** One tab of the floating "Action terminal" panel — one per source. */
export interface TerminalGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TerminalTab {
  sourceId: string;
  sourceKind: ActionSourceKind;
  runId: string;
  label: string;
  command: string;
  cwd?: string;
  /** Close the tab 2 s after an exit 0 (the action's closeTerminalOnSuccess). */
  closeOnSuccess?: boolean;
}

/** How a run was started from this browser tab — what "Run in a terminal" replays. */
export interface RunMeta {
  /** The conditional action the click resolved to, if any. */
  ruleId?: string;
  closeOnSuccess?: boolean;
}

const runRequests = new Map<string, { request: ActionRunRequest; meta: RunMeta }>();

/** The request (and rule) a run was started with from this tab; undefined after a reload. */
export function getRunOrigin(runId: string): { request: ActionRunRequest; meta: RunMeta } | undefined {
  return runRequests.get(runId);
}

/**
 * Merge one live chunk: chunks may arrive out of order, so they are kept sorted
 * by seq; past the cap, the oldest text is cut and counted in `dropped`.
 */
export function appendLiveOutput(prev: LiveOutput | undefined, chunk: ActionRunOutputChunk, cap = LIVE_OUTPUT_CAP): LiveOutput {
  const base: LiveOutput = prev ?? { chunks: [], text: '', dropped: 0, floorSeq: -Infinity };
  if (base.chunks.some((c) => c.seq === chunk.seq)) return base;
  let dropped = base.dropped + (chunk.dropped ?? 0);
  if (chunk.seq <= base.floorSeq) return { ...base, dropped: dropped + chunk.chunk.length };
  const chunks = [...base.chunks, { seq: chunk.seq, text: chunk.chunk }].sort((a, b) => a.seq - b.seq);
  let size = chunks.reduce((n, c) => n + c.text.length, 0);
  let floorSeq = base.floorSeq;
  while (size > cap && chunks.length > 0) {
    const first = chunks[0]!;
    const excess = size - cap;
    if (first.text.length <= excess) {
      chunks.shift();
      size -= first.text.length;
      dropped += first.text.length;
      floorSeq = Math.max(floorSeq, first.seq);
    } else {
      chunks[0] = { seq: first.seq, text: first.text.slice(excess) };
      size -= excess;
      dropped += excess;
      floorSeq = Math.max(floorSeq, first.seq - 1);
    }
  }
  return { chunks, text: chunks.map((c) => c.text).join(''), dropped, floorSeq };
}

// ─── "running…" toast, only for runs that last ───

const startToasts = new Map<string, { timer?: ReturnType<typeof setTimeout>; toastId?: string }>();

function clearStartToast(runId: string): void {
  const entry = startToasts.get(runId);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  if (entry.toastId) useToastStore.getState().removeToast(entry.toastId);
  startToasts.delete(runId);
}

/** Test seam: forget pending start toasts and run origins. */
export function resetPinnedActionsTransient(): void {
  for (const id of [...startToasts.keys()]) clearStartToast(id);
  runRequests.clear();
}

interface PinnedActionsState {
  statuses: Record<string, StatusSnapshot>;
  /** Newest first, per source id. */
  runs: Record<string, ActionRun[]>;
  /** Source ids with a run in flight. */
  running: Record<string, string>;
  logs: LogsTarget | null;
  /** Live output of runs in flight, by run id. Dropped once the final log arrives. */
  liveOutput: Record<string, LiveOutput>;
  /** What the gateway supports; null until asked. */
  capabilities: ActionRunCapabilities | null;
  /** Floating terminal panel: one tab per source, the active one in front. */
  terminals: TerminalTab[];
  activeTerminal: string | null;
  /** Bumped each time a tab must grab the keyboard (opened, brought to front). */
  terminalFocusNonce: number;
  /**
   * The panel is hidden but its tabs (and their tmux sessions) live on: clicking
   * the action again brings it back where it was. Closing a tab is what ends a session.
   */
  terminalMinimized: boolean;
  /** Where the user resized the panel to; kept while any terminal is open. */
  terminalGeometry: TerminalGeometry | null;

  loadStatuses: () => Promise<void>;
  loadCapabilities: () => Promise<void>;
  handleWsMessage: (msg: PinnedStatusWsMessage) => void;
  run: (request: ActionRunRequest, meta?: RunMeta) => Promise<void>;
  /** Replay a finished run once in terminal mode (same command, cwd and source). */
  rerunInTerminal: (run: ActionRun) => Promise<void>;
  cancelRun: (runId: string) => Promise<void>;
  openTerminal: (tab: TerminalTab) => void;
  focusTerminal: (sourceId: string) => void;
  minimizeTerminal: () => void;
  setTerminalGeometry: (geometry: TerminalGeometry) => void;
  /** Remove a tab and end its tmux session (a running command is stopped). */
  closeTerminal: (sourceId: string) => void;
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

/**
 * Toast at the end of a run: ✓ with its duration; on failure, the diagnosed
 * reason when there is one ("Command not found: platool", "needs a terminal"…),
 * else the exit code and first stderr line as before.
 */
export function announceRun(
  run: ActionRun,
  openLogs: (t: LogsTarget) => void,
  rerunInTerminal?: (run: ActionRun) => void,
): void {
  const { addToast } = useToastStore.getState();
  const hint = diagnoseRun(run);
  // A background run that needed a TTY or the .zshrc: the useful next step is a terminal, not the logs.
  const wantsTerminal = !!rerunInTerminal && run.mode !== 'terminal' && (hint?.code === 'no-tty' || hint?.code === 'not-found') && hint.suggest.includes('run-in-terminal');
  const action = wantsTerminal
    ? { label: 'Run in a terminal', onClick: () => rerunInTerminal!(run) }
    : { label: 'View logs', onClick: () => openLogs({ sourceId: run.sourceId, label: run.label, runId: run.runId }) };
  if (hint?.code === 'cancelled') {
    addToast('info', `${run.label} — stopped`);
    return;
  }
  if (run.timedOut) {
    addToast('warning', `${run.label} — ${hint?.title ?? 'timed out'}`, { action, durationMs: 8000 });
    return;
  }
  if (run.exitCode === 0) {
    addToast('success', `✓ ${run.label} (${durationSec(run)})`);
    return;
  }
  if (hint) {
    addToast('error', `✗ ${run.label} — ${hint.title}`, { action, durationMs: 8000 });
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
  liveOutput: {},
  capabilities: null,
  terminals: [],
  activeTerminal: null,
  terminalFocusNonce: 0,
  terminalMinimized: false,
  terminalGeometry: null,

  loadStatuses: async () => {
    try {
      const snapshots = await api.fetchPinnedStatuses();
      set({ statuses: Object.fromEntries(snapshots.map((s) => [s.iconId, s])) });
    } catch { /* toasted by request() */ }
  },

  loadCapabilities: async () => {
    set({ capabilities: await api.fetchActionRunCapabilities() });
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
        scheduleStartToast(msg.data);
        break;
      case 'action-run:output': {
        const chunk = msg.data;
        set((s) => {
          // A late chunk of a run whose final log is already here would resurrect a stale buffer.
          if (s.runs[chunk.sourceId]?.some((r) => r.runId === chunk.runId && r.finishedAt)) return s;
          return { liveOutput: { ...s.liveOutput, [chunk.runId]: appendLiveOutput(s.liveOutput[chunk.runId], chunk) } };
        });
        break;
      }
      case 'action-run:finished': {
        const run = msg.data;
        clearStartToast(run.runId);
        set((s) => {
          const running = { ...s.running };
          delete running[run.sourceId];
          const liveOutput = { ...s.liveOutput };
          delete liveOutput[run.runId];
          return { running, liveOutput, runs: { ...s.runs, [run.sourceId]: upsertRun(s.runs[run.sourceId], run) } };
        });
        // A terminal run with its panel tab open already shows its outcome there.
        // A minimized panel shows nothing: the run gets its toast like any other.
        const shownInPanel = run.mode === 'terminal' && !get().terminalMinimized && get().terminals.some((t) => t.runId === run.runId);
        if (!run.sourceId.startsWith(DRAFT_SOURCE_PREFIX) && !shownInPanel) {
          announceRun(run, get().openLogs, (r) => void get().rerunInTerminal(r));
        }
        break;
      }
    }
  },

  run: async (request, meta = {}) => {
    const { terminals, terminalMinimized, activeTerminal } = get();
    const hasTab = terminals.some((t) => t.sourceId === request.sourceId);
    if (get().running[request.sourceId]) {
      // A second click on a terminal run in flight brings its panel to the front.
      if (hasTab) get().focusTerminal(request.sourceId);
      return;
    }
    // Its terminal is open but out of sight (panel minimized, another tab in
    // front): the click shows it as it was. Only a click on the visible tab re-runs.
    if (hasTab && (terminalMinimized || activeTerminal !== request.sourceId)) {
      get().focusTerminal(request.sourceId);
      return;
    }
    // Optimistic: the button shows its spinner before the WS echo arrives.
    set((s) => ({ running: { ...s.running, [request.sourceId]: 'pending' } }));
    try {
      const { runId, alreadyRunning, run } = await api.startActionRun(request);
      runRequests.set(runId, { request, meta });
      set((s) => ({
        ...(s.running[request.sourceId] === 'pending' ? { running: { ...s.running, [request.sourceId]: runId } } : {}),
        ...(run ? { runs: { ...s.runs, [request.sourceId]: upsertRun(s.runs[request.sourceId], run) } } : {}),
      }));
      const terminal = (run?.mode ?? request.mode) === 'terminal';
      if (terminal) {
        // Started (or already running, 409) in a terminal: open its tab, or bring it to the front.
        get().openTerminal({
          sourceId: request.sourceId,
          sourceKind: request.sourceKind,
          runId,
          label: request.label,
          command: request.command,
          ...(request.cwd ? { cwd: request.cwd } : {}),
          ...(meta.closeOnSuccess ? { closeOnSuccess: true } : {}),
        });
      }
      if (alreadyRunning) void get().loadRuns(request.sourceId);
      else if (run && !terminal) scheduleStartToast(run);
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

  rerunInTerminal: async (run) => {
    const origin = runRequests.get(run.runId);
    const request: ActionRunRequest = origin?.request ?? { sourceId: run.sourceId, sourceKind: run.sourceKind, label: run.label, command: run.command };
    const { timeoutSec: _timeout, ...rest } = request;
    await get().run({ ...rest, mode: 'terminal' }, origin?.meta);
  },

  cancelRun: async (runId) => {
    await api.cancelActionRun(runId);
  },

  openTerminal: (tab) => {
    set((s) => {
      const exists = s.terminals.some((t) => t.sourceId === tab.sourceId);
      return {
        terminals: exists ? s.terminals.map((t) => (t.sourceId === tab.sourceId ? tab : t)) : [...s.terminals, tab],
        activeTerminal: tab.sourceId,
        terminalFocusNonce: s.terminalFocusNonce + 1,
        terminalMinimized: false,
      };
    });
  },

  focusTerminal: (sourceId) => {
    set((s) =>
      s.terminals.some((t) => t.sourceId === sourceId)
        ? { activeTerminal: sourceId, terminalFocusNonce: s.terminalFocusNonce + 1, terminalMinimized: false }
        : s,
    );
  },

  minimizeTerminal: () => set({ terminalMinimized: true }),

  setTerminalGeometry: (terminalGeometry) => set({ terminalGeometry }),

  closeTerminal: (sourceId) => {
    const tab = get().terminals.find((t) => t.sourceId === sourceId);
    if (!tab) return;
    // Ends the tmux session: a running command is stopped (the run ends cancelled), a finished pane is released.
    void api.closeActionTerminal(tab.runId);
    set((s) => {
      const terminals = s.terminals.filter((t) => t.sourceId !== sourceId);
      const activeTerminal = s.activeTerminal === sourceId ? terminals.at(-1)?.sourceId ?? null : s.activeTerminal;
      return { terminals, activeTerminal, ...(terminals.length === 0 ? { terminalMinimized: false, terminalGeometry: null } : {}) };
    });
  },

  openLogs: (target) => {
    set({ logs: target });
    void get().loadRuns(target.sourceId);
  },

  closeLogs: () => set({ logs: null }),
}));

/**
 * After START_TOAST_DELAY_MS, a background run still in flight gets a discreet
 * "running…" toast that opens its live output; the final toast replaces it.
 * Terminal runs have their panel, Settings "Try" runs their inline result.
 */
function scheduleStartToast(run: ActionRun): void {
  if (run.finishedAt || run.mode === 'terminal' || run.sourceId.startsWith(DRAFT_SOURCE_PREFIX) || startToasts.has(run.runId)) return;
  const entry: { timer?: ReturnType<typeof setTimeout>; toastId?: string } = {};
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    const state = usePinnedActionsStore.getState();
    const current = state.runs[run.sourceId]?.find((r) => r.runId === run.runId);
    if (current?.finishedAt || state.running[run.sourceId] !== run.runId) {
      startToasts.delete(run.runId);
      return;
    }
    entry.toastId = useToastStore.getState().addToast('info', `${run.label} running…`, {
      action: { label: 'View output', onClick: () => usePinnedActionsStore.getState().openLogs({ sourceId: run.sourceId, label: run.label, runId: run.runId }) },
      // Dismissed by the final toast; the cap only guards against a lost `finished`.
      durationMs: ACTION_MAX_TIMEOUT_SEC * 1000,
    });
  }, START_TOAST_DELAY_MS);
  startToasts.set(run.runId, entry);
}

import { create } from 'zustand';
import type { WorkflowRun, StepRun } from '@fleex/shared';
import * as api from '../services/api';

interface RunDetail {
  run: WorkflowRun;
  stepRuns: StepRun[];
}

interface State {
  runsByTicket: Record<string, WorkflowRun[]>;
  detail: Record<string, RunDetail>;
  loading: boolean;
  error: string | null;

  loadForTicket(ticketId: string): Promise<void>;
  loadDetail(runId: string): Promise<void>;
  start(ticketId: string, templateId: string): Promise<WorkflowRun>;
  cancel(runId: string): Promise<void>;
  resolveGate(runId: string, stepRunId: string, outcome: string, notes?: string): Promise<void>;
  retry(runId: string, stepRunId: string): Promise<void>;

  activeByTicket(ticketId: string): WorkflowRun | undefined;
  historyByTicket(ticketId: string): WorkflowRun[];

  applyEvent(event: { type: string; ticketId: string; payload: Record<string, unknown> }): void;
}

export const ACTIVE_STATUSES = new Set(['running', 'blocked', 'needs_review']);

export const useWorkflowRunStore = create<State>((set, get) => ({
  runsByTicket: {},
  detail: {},
  loading: false,
  error: null,

  loadForTicket: async (ticketId) => {
    set({ loading: true, error: null });
    try {
      const runs = await api.fetchWorkflowRuns(ticketId);
      set((state) => ({
        runsByTicket: { ...state.runsByTicket, [ticketId]: runs },
        loading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
    }
  },

  loadDetail: async (runId) => {
    set({ loading: true, error: null });
    try {
      const detail = await api.fetchWorkflowRunDetail(runId);
      set((state) => ({
        detail: { ...state.detail, [runId]: detail },
        loading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
    }
  },

  start: async (ticketId, templateId) => {
    const run = await api.startWorkflowRun({ ticketId, templateId });
    set((state) => ({
      runsByTicket: {
        ...state.runsByTicket,
        [ticketId]: [run, ...(state.runsByTicket[ticketId] ?? [])],
      },
    }));
    return run;
  },

  cancel: async (runId) => {
    await api.cancelWorkflowRun(runId);
  },

  resolveGate: async (runId, stepRunId, outcome, notes) => {
    await api.resolveWorkflowGate(runId, stepRunId, { outcome, notes });
  },

  retry: async (runId, stepRunId) => {
    await api.retryWorkflowStep(runId, stepRunId);
  },

  activeByTicket: (ticketId) => {
    return get().runsByTicket[ticketId]?.find((r) => ACTIVE_STATUSES.has(r.status));
  },

  historyByTicket: (ticketId) => {
    return get().runsByTicket[ticketId]?.filter((r) => !ACTIVE_STATUSES.has(r.status)) ?? [];
  },

  applyEvent: (event) => {
    const { ticketId, payload } = event;
    const store = get();

    store.loadForTicket(ticketId);

    const workflowRunId = typeof payload.workflowRunId === 'string' ? payload.workflowRunId : undefined;
    if (workflowRunId && workflowRunId in store.detail) {
      store.loadDetail(workflowRunId);
    }
  },
}));

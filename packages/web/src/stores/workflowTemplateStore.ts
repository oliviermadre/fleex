import { create } from 'zustand';

import type { WorkflowTemplate } from '@fleex/shared';

import * as api from '../services/api';

interface WorkflowTemplateState {
  templates: WorkflowTemplate[];
  loading: boolean;
  error: string | null;
  selectedWorkflowId: string | null;

  selectWorkflow(id: string | null): void;
  refresh(): Promise<void>;
  create(
    input: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowTemplate>;
  update(
    id: string,
    input: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowTemplate>;
  remove(id: string): Promise<void>;
  getBySlug(slug: string): WorkflowTemplate | undefined;
}

export const useWorkflowTemplateStore = create<WorkflowTemplateState>((set, get) => ({
  templates: [],
  loading: false,
  error: null,
  selectedWorkflowId: null,

  selectWorkflow: (id) => set({ selectedWorkflowId: id }),

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const templates = await api.fetchWorkflowTemplates();
      set({ templates, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
    }
  },

  create: async (input) => {
    const template = await api.createWorkflowTemplate(input);
    set((state) => ({ templates: [...state.templates, template] }));
    return template;
  },

  update: async (id, input) => {
    const updated = await api.updateWorkflowTemplate(id, input);
    set((state) => ({
      templates: state.templates.map((t) => (t.id === id ? updated : t)),
    }));
    return updated;
  },

  remove: async (id) => {
    await api.deleteWorkflowTemplate(id);
    set((state) => ({
      templates: state.templates.filter((t) => t.id !== id),
      selectedWorkflowId: state.selectedWorkflowId === id ? null : state.selectedWorkflowId,
    }));
  },

  getBySlug: (slug) => {
    return get().templates.find((t) => t.slug === slug);
  },
}));

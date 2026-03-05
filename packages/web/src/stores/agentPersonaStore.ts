import { create } from 'zustand';
import type {
  AgentPersona,
  CreateAgentPersonaRequest,
  UpdateAgentPersonaRequest,
  AgentExecutionResult,
  PersonaWsMessage,
} from '@fleex/shared';
import * as api from '../services/api';

type PersonaTab = 'config' | 'soul' | 'identity' | 'memory' | 'events';

interface AgentPersonaState {
  personas: AgentPersona[];
  loaded: boolean;
  selectedPersonaId: string | null;
  activeTab: PersonaTab;
  executionStatuses: Record<string, { running: boolean; pendingMentions: number }>;

  loadPersonas: () => Promise<void>;
  selectPersona: (id: string | null) => void;
  setActiveTab: (tab: PersonaTab) => void;
  createPersona: (req: CreateAgentPersonaRequest) => Promise<AgentPersona>;
  updatePersona: (id: string, req: UpdateAgentPersonaRequest) => Promise<void>;
  deletePersona: (id: string) => Promise<void>;
  executeAgent: (id: string) => Promise<AgentExecutionResult>;
  refreshStatus: (id: string) => Promise<void>;
  refreshAllStatuses: () => Promise<void>;
  handleWsMessage: (msg: PersonaWsMessage) => void;
}

export const useAgentPersonaStore = create<AgentPersonaState>((set, get) => ({
  personas: [],
  loaded: false,
  selectedPersonaId: null,
  activeTab: 'config',
  executionStatuses: {},

  loadPersonas: async () => {
    try {
      const personas = await api.fetchPersonas();
      set({ personas, loaded: true });
    } catch (err) {
      console.error('Failed to load personas:', err);
    }
  },

  selectPersona: (id) => set({ selectedPersonaId: id }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  createPersona: async (req) => {
    const persona = await api.createPersona(req);
    // Don't optimistically add — the WS broadcast handles it to avoid duplicates
    return persona;
  },

  updatePersona: async (id, req) => {
    const updated = await api.updatePersona(id, req);
    set((state) => ({
      personas: state.personas.map((p) => (p.id === id ? updated : p)),
    }));
  },

  deletePersona: async (id) => {
    await api.deletePersona(id);
    set((state) => ({
      personas: state.personas.filter((p) => p.id !== id),
      selectedPersonaId: state.selectedPersonaId === id ? null : state.selectedPersonaId,
    }));
  },

  executeAgent: async (id) => {
    const result = await api.executeAgent(id);
    if (result.status === 'started') {
      set((state) => ({
        executionStatuses: {
          ...state.executionStatuses,
          [id]: { running: true, pendingMentions: result.mentionIds.length },
        },
      }));
    }
    return result;
  },

  refreshStatus: async (id) => {
    try {
      const status = await api.fetchAgentStatus(id);
      set((state) => ({
        executionStatuses: {
          ...state.executionStatuses,
          [id]: { running: status.running, pendingMentions: status.pendingMentionCount },
        },
      }));
    } catch {
      // ignore
    }
  },

  refreshAllStatuses: async () => {
    const { personas, refreshStatus } = get();
    await Promise.all(personas.map((p) => refreshStatus(p.id)));
  },

  handleWsMessage: (msg) => {
    const { type, data } = msg;
    const state = get();

    switch (type) {
      case 'persona:created': {
        const persona = data as AgentPersona;
        if (!state.personas.some((p) => p.id === persona.id)) {
          set({ personas: [...state.personas, persona] });
        }
        break;
      }
      case 'persona:updated': {
        const persona = data as AgentPersona;
        set({
          personas: state.personas.map((p) => (p.id === persona.id ? persona : p)),
        });
        break;
      }
      case 'persona:deleted': {
        const { id } = data as { id: string };
        set({
          personas: state.personas.filter((p) => p.id !== id),
          selectedPersonaId: state.selectedPersonaId === id ? null : state.selectedPersonaId,
        });
        break;
      }
      case 'persona:execution_started': {
        const { personaId } = data as { personaId: string; mentionIds: string[] };
        set({
          executionStatuses: {
            ...state.executionStatuses,
            [personaId]: { running: true, pendingMentions: 0 },
          },
        });
        break;
      }
      case 'persona:execution_completed':
      case 'persona:execution_failed': {
        const { personaId } = data as { personaId: string };
        set({
          executionStatuses: {
            ...state.executionStatuses,
            [personaId]: { running: false, pendingMentions: 0 },
          },
        });
        break;
      }
    }
  },
}));

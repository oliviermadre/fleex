import { create } from 'zustand';
import type {
  Skill,
  CreateSkillRequest,
  UpdateSkillRequest,
  SkillWsMessage,
} from '@fleex/shared';
import * as api from '../services/api';
import { createLogger } from '../lib/logger';

const log = createLogger('stores/skillStore');

interface SkillState {
  skills: Skill[];
  loaded: boolean;
  selectedSkillId: string | null;

  loadSkills: () => Promise<void>;
  selectSkill: (id: string | null) => void;
  createSkill: (req: CreateSkillRequest) => Promise<Skill>;
  updateSkill: (id: string, req: UpdateSkillRequest) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  executeSkill: (id: string, ticketId: string) => Promise<void>;
  handleWsMessage: (msg: SkillWsMessage) => void;
}

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [],
  loaded: false,
  selectedSkillId: null,

  loadSkills: async () => {
    try {
      const skills = await api.fetchSkills();
      set({ skills, loaded: true });
    } catch (err) {
      log.error('Failed to load skills', { err });
    }
  },

  selectSkill: (id) => set({ selectedSkillId: id }),

  createSkill: async (req) => {
    const skill = await api.createSkill(req);
    return skill;
  },

  updateSkill: async (id, req) => {
    const updated = await api.updateSkill(id, req);
    set((state) => ({
      skills: state.skills.map((s) => (s.id === id ? updated : s)),
    }));
  },

  deleteSkill: async (id) => {
    await api.deleteSkill(id);
    set((state) => ({
      skills: state.skills.filter((s) => s.id !== id),
      selectedSkillId: state.selectedSkillId === id ? null : state.selectedSkillId,
    }));
  },

  executeSkill: async (id, ticketId) => {
    await api.executeSkill(id, ticketId);
  },

  handleWsMessage: (msg) => {
    const { type, data } = msg;
    const state = get();

    switch (type) {
      case 'skill:created': {
        const skill = data as Skill;
        if (!state.skills.some((s) => s.id === skill.id)) {
          set({ skills: [...state.skills, skill] });
        }
        break;
      }
      case 'skill:updated': {
        const skill = data as Skill;
        set({
          skills: state.skills.map((s) => (s.id === skill.id ? skill : s)),
        });
        break;
      }
      case 'skill:deleted': {
        const { id } = data as { id: string };
        set({
          skills: state.skills.filter((s) => s.id !== id),
          selectedSkillId: state.selectedSkillId === id ? null : state.selectedSkillId,
        });
        break;
      }
    }
  },
}));

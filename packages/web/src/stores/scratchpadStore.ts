import { create } from 'zustand';
import { fetchScratchpad, saveScratchpad } from '../services/api';

interface ScratchpadState {
  content: string;
  loaded: boolean;
  saving: boolean;
  mode: 'preview' | 'edit';

  setContent: (content: string) => void;
  setMode: (mode: 'preview' | 'edit') => void;
  load: () => Promise<void>;
  save: () => Promise<void>;
  toggleCheckbox: (lineIndex: number) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useScratchpadStore = create<ScratchpadState>((set, get) => ({
  content: '',
  loaded: false,
  saving: false,
  mode: 'preview',

  setContent: (content: string) => {
    set({ content });
    // Debounced auto-save
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      get().save();
    }, 800);
  },

  setMode: (mode) => set({ mode }),

  load: async () => {
    try {
      const { content } = await fetchScratchpad();
      set({ content, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  save: async () => {
    const { content } = get();
    set({ saving: true });
    try {
      await saveScratchpad(content);
    } catch {
      // silent fail — will retry on next save
    } finally {
      set({ saving: false });
    }
  },

  toggleCheckbox: (lineIndex: number) => {
    const { content } = get();
    const lines = content.split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return;

    const line = lines[lineIndex]!;
    if (line.match(/^(\s*[-*]\s*)\[x\]/i)) {
      lines[lineIndex] = line.replace(/\[x\]/i, '[ ]');
    } else if (line.match(/^(\s*[-*]\s*)\[ \]/)) {
      lines[lineIndex] = line.replace('[ ]', '[x]');
    } else {
      return;
    }

    const newContent = lines.join('\n');
    set({ content: newContent });
    // Debounced save
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      get().save();
    }, 400);
  },
}));

import { create } from 'zustand';
import {
  fetchScratchpad,
  saveScratchpad,
  fetchRepoScratchpad,
  saveRepoScratchpad,
  fetchScratchpadList,
} from '../services/api';
import {
  nextMarkdownMode,
  readMarkdownMode,
  writeMarkdownMode,
  type MarkdownMode,
} from '../components/markdown/useMarkdownMode';

/** Every scratchpad surface shares one persisted view mode. */
const SCRATCHPAD_SURFACE = 'scratchpad';

interface ScratchpadEntry {
  content: string;
  loaded: boolean;
  saving: boolean;
  savedAt: number | null;
  dirty: boolean;
}

interface ScratchpadState {
  entries: Record<string, ScratchpadEntry>; // key: '__global__' | 'org/name'
  /**
   * Write / preview / split, shared by every scratchpad surface and cycled by
   * the global Alt+Shift+V hotkey. Persisted like every other markdown surface.
   */
  markdownMode: MarkdownMode;

  // For Feature 3 main panel view
  selectedScratchpadKey: string | null;
  scratchpadList: { key: string; label: string; lineCount: number }[];
  scratchpadListLoaded: boolean;

  // Actions
  setContent: (key: string, content: string) => void;
  load: (key: string) => Promise<void>;
  save: (key: string) => Promise<void>;
  flushSave: (key: string) => void;
  toggleCheckbox: (key: string, lineIndex: number) => void;
  setMarkdownMode: (mode: MarkdownMode) => void;
  cycleMarkdownMode: () => void;
  setSelectedScratchpadKey: (key: string | null) => void;
  loadScratchpadList: (repos?: string[]) => Promise<void>;
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function getEntry(entries: Record<string, ScratchpadEntry>, key: string): ScratchpadEntry {
  return entries[key] ?? { content: '', loaded: false, saving: false, savedAt: null, dirty: false };
}

function parseRepoKey(key: string): { org: string; name: string } | null {
  if (key === '__global__') return null;
  const slash = key.indexOf('/');
  if (slash === -1) return null;
  return { org: key.slice(0, slash), name: key.slice(slash + 1) };
}

export const useScratchpadStore = create<ScratchpadState>((set, get) => ({
  entries: {},
  markdownMode: readMarkdownMode(SCRATCHPAD_SURFACE) ?? 'split',
  selectedScratchpadKey: null,
  scratchpadList: [],
  scratchpadListLoaded: false,

  setContent: (key: string, content: string) => {
    const lineCount = content.split('\n').filter((l) => l.trim() !== '').length;
    set((state) => ({
      entries: {
        ...state.entries,
        [key]: { ...getEntry(state.entries, key), content, dirty: true },
      },
      scratchpadList: state.scratchpadList.map((item) =>
        item.key === key ? { ...item, lineCount } : item,
      ),
    }));
    // Debounced auto-save
    const existing = saveTimers.get(key);
    if (existing) clearTimeout(existing);
    saveTimers.set(
      key,
      setTimeout(() => {
        get().save(key);
      }, 800),
    );
  },

  load: async (key: string) => {
    try {
      let content: string;
      const repo = parseRepoKey(key);
      if (repo) {
        const res = await fetchRepoScratchpad(repo.org, repo.name);
        content = res.content;
      } else {
        const res = await fetchScratchpad();
        content = res.content;
      }
      set((state) => ({
        entries: {
          ...state.entries,
          [key]: { content, loaded: true, saving: false, savedAt: null, dirty: false },
        },
      }));
    } catch {
      set((state) => ({
        entries: {
          ...state.entries,
          [key]: { ...getEntry(state.entries, key), loaded: true },
        },
      }));
    }
  },

  save: async (key: string) => {
    const entry = getEntry(get().entries, key);
    set((state) => ({
      entries: {
        ...state.entries,
        [key]: { ...getEntry(state.entries, key), saving: true },
      },
    }));
    try {
      const repo = parseRepoKey(key);
      if (repo) {
        await saveRepoScratchpad(repo.org, repo.name, entry.content);
      } else {
        await saveScratchpad(entry.content);
      }
      set((state) => ({
        entries: {
          ...state.entries,
          [key]: { ...getEntry(state.entries, key), saving: false, savedAt: Date.now(), dirty: false },
        },
      }));
    } catch {
      // silent fail — will retry on next save
      set((state) => ({
        entries: {
          ...state.entries,
          [key]: { ...getEntry(state.entries, key), saving: false },
        },
      }));
    }
  },

  flushSave: (key: string) => {
    const timer = saveTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      saveTimers.delete(key);
      get().save(key);
    }
  },

  toggleCheckbox: (key: string, lineIndex: number) => {
    const entry = getEntry(get().entries, key);
    const lines = entry.content.split('\n');
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
    set((state) => ({
      entries: {
        ...state.entries,
        [key]: { ...getEntry(state.entries, key), content: newContent },
      },
    }));
    // Debounced save
    const existing = saveTimers.get(key);
    if (existing) clearTimeout(existing);
    saveTimers.set(
      key,
      setTimeout(() => {
        get().save(key);
      }, 400),
    );
  },

  setMarkdownMode: (mode: MarkdownMode) => {
    writeMarkdownMode(SCRATCHPAD_SURFACE, mode);
    set({ markdownMode: mode });
  },

  cycleMarkdownMode: () => get().setMarkdownMode(nextMarkdownMode(get().markdownMode)),

  setSelectedScratchpadKey: (key) => set({ selectedScratchpadKey: key }),

  loadScratchpadList: async (repos?: string[]) => {
    try {
      const { items } = await fetchScratchpadList(repos);
      set({ scratchpadList: items, scratchpadListLoaded: true });
    } catch {
      set({ scratchpadListLoaded: true });
    }
  },
}));

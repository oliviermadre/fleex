import { create } from 'zustand';
import type { ClaudeConfigTreeEntry } from '@asm/shared';
import {
  fetchClaudeConfigTree,
  fetchClaudeConfigFile,
  saveClaudeConfigFile,
  createClaudeConfigEntry,
  deleteClaudeConfigEntry,
} from '../services/api';

interface ContextMenuState {
  x: number;
  y: number;
  targetPath: string;
  targetIsDir: boolean;
}

interface CreatingEntryState {
  parentPath: string;
  type: 'file' | 'directory';
}

interface DeleteConfirmState {
  path: string;
  name: string;
  isDirectory: boolean;
}

interface ClaudeConfigState {
  // Tree
  tree: ClaudeConfigTreeEntry[];
  treeLoading: boolean;
  expandedDirs: Set<string>;

  // File editor
  selectedFile: string | null;
  fileContent: string;
  originalContent: string;
  fileLoading: boolean;
  fileSaving: boolean;

  // Context menu
  contextMenu: ContextMenuState | null;

  // Inline create
  creatingEntry: CreatingEntryState | null;

  // Delete confirmation
  deleteConfirm: DeleteConfirmState | null;

  // Actions
  loadTree: () => Promise<void>;
  toggleDir: (path: string) => void;
  selectFile: (path: string) => void;
  loadFile: (path: string) => Promise<void>;
  setFileContent: (content: string) => void;
  saveFile: () => Promise<void>;

  // Context menu actions
  openContextMenu: (x: number, y: number, targetPath: string, targetIsDir: boolean) => void;
  closeContextMenu: () => void;

  // Create actions
  startCreate: (parentPath: string, type: 'file' | 'directory') => void;
  cancelCreate: () => void;
  confirmCreate: (name: string) => Promise<void>;

  // Delete actions
  requestDelete: (path: string, name: string, isDirectory: boolean) => void;
  cancelDelete: () => void;
  confirmDelete: () => Promise<void>;
}

export const useClaudeConfigStore = create<ClaudeConfigState>((set, get) => ({
  tree: [],
  treeLoading: false,
  expandedDirs: new Set(['.claude']),

  selectedFile: null,
  fileContent: '',
  originalContent: '',
  fileLoading: false,
  fileSaving: false,

  contextMenu: null,
  creatingEntry: null,
  deleteConfirm: null,

  loadTree: async () => {
    set({ treeLoading: true });
    try {
      const tree = await fetchClaudeConfigTree();
      set({ tree });
    } finally {
      set({ treeLoading: false });
    }
  },

  toggleDir: (path) =>
    set((state) => {
      const next = new Set(state.expandedDirs);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return { expandedDirs: next };
    }),

  selectFile: (path) => {
    const { selectedFile, loadFile } = get();
    if (path === selectedFile) return;
    loadFile(path);
  },

  loadFile: async (path) => {
    set({ selectedFile: path, fileLoading: true, fileContent: '', originalContent: '' });
    try {
      const { content } = await fetchClaudeConfigFile(path);
      set({ fileContent: content, originalContent: content });
    } finally {
      set({ fileLoading: false });
    }
  },

  setFileContent: (content) => set({ fileContent: content }),

  saveFile: async () => {
    const { selectedFile, fileContent } = get();
    if (!selectedFile) return;
    set({ fileSaving: true });
    try {
      await saveClaudeConfigFile(selectedFile, fileContent);
      set({ originalContent: fileContent });
    } finally {
      set({ fileSaving: false });
    }
  },

  // Context menu
  openContextMenu: (x, y, targetPath, targetIsDir) =>
    set({ contextMenu: { x, y, targetPath, targetIsDir } }),

  closeContextMenu: () => set({ contextMenu: null }),

  // Create
  startCreate: (parentPath, type) => {
    // Expand the parent so the inline input is visible
    set((state) => {
      const next = new Set(state.expandedDirs);
      next.add(parentPath);
      return { creatingEntry: { parentPath, type }, contextMenu: null, expandedDirs: next };
    });
  },

  cancelCreate: () => set({ creatingEntry: null }),

  confirmCreate: async (name) => {
    const { creatingEntry, loadTree, selectFile } = get();
    if (!creatingEntry) return;

    const fullPath = `${creatingEntry.parentPath}/${name}`;
    await createClaudeConfigEntry(fullPath, creatingEntry.type);
    set({ creatingEntry: null });
    await loadTree();

    // Auto-select new files in the editor
    if (creatingEntry.type === 'file') {
      selectFile(fullPath);
    }
  },

  // Delete
  requestDelete: (path, name, isDirectory) =>
    set({ deleteConfirm: { path, name, isDirectory }, contextMenu: null }),

  cancelDelete: () => set({ deleteConfirm: null }),

  confirmDelete: async () => {
    const { deleteConfirm, selectedFile, loadTree } = get();
    if (!deleteConfirm) return;

    await deleteClaudeConfigEntry(deleteConfirm.path);

    // Clear editor if the deleted path matches or is a parent of the selected file
    const shouldClear =
      selectedFile &&
      (selectedFile === deleteConfirm.path || selectedFile.startsWith(deleteConfirm.path + '/'));

    set({
      deleteConfirm: null,
      ...(shouldClear ? { selectedFile: null, fileContent: '', originalContent: '' } : {}),
    });

    await loadTree();
  },
}));

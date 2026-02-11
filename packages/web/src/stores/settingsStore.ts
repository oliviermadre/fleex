import { create } from 'zustand';
import { API_URL } from '../lib/constants';
import { resolveTemplate, type WorktreeContext } from '../lib/templateUtils';
import type { Theme } from '../lib/themes';

export interface PinnedIcon {
  id: string;
  icon: string;
  iconType: 'svg' | 'base64' | 'path' | 'url';
  label: string;
  actionType: 'url' | 'shell';
  actionValue: string;
}

export interface WorktreeAction {
  id: string;
  icon: string;
  iconType: 'svg' | 'base64' | 'path' | 'url';
  label: string;
  actionType: 'url' | 'shell';
  actionValue: string;
}

export type SessionLayoutType = '1x2' | '2x2';

export interface SessionLayoutGroup {
  id: string;
  type: SessionLayoutType;
  cells: (string | null)[]; // session IDs bound to each cell, length 2 for 1x2, length 4 for 2x2
}

export interface AppSettings {
  basePath: string;
  repositories: string[];
  resolvedRepositories: string[];
  resolvedAt: string | null;
  pinnedIcons: PinnedIcon[];
  worktreeActions: WorktreeAction[];
  sessionDisplayNames: Record<string, string>;
  repoOrder: string[];
  worktreeOrder: Record<string, string[]>;
  sessionOrder: Record<string, string[]>;
  activeThemeId: string;
  customThemes: Theme[];
  sessionLayoutGroups: SessionLayoutGroup[];
}

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  resolving: boolean;
  loadSettings: () => Promise<void>;
  saveSettings: (partial: Partial<AppSettings>) => Promise<void>;
  setSessionDisplayName: (sessionId: string, name: string) => void;
  getSessionDisplayName: (sessionId: string) => string | undefined;
  setRepoOrder: (order: string[]) => void;
  setWorktreeOrder: (repoGroupId: string, order: string[]) => void;
  setSessionOrder: (worktreeGroupId: string, order: string[]) => void;
  resolveRepositories: () => Promise<void>;
  executePinnedAction: (icon: PinnedIcon) => void;
  executeWorktreeAction: (action: WorktreeAction, context: WorktreeContext) => void;
  addLayoutGroup: (type: SessionLayoutType) => string;
  removeLayoutGroup: (id: string) => void;
  bindLayoutGroupCell: (groupId: string, cellIndex: number, sessionId: string | null) => void;
}

const STORAGE_KEY = 'asm-settings';

const defaultSettings: AppSettings = {
  basePath: '',
  repositories: [],
  resolvedRepositories: [],
  resolvedAt: null,
  pinnedIcons: [],
  worktreeActions: [],
  sessionDisplayNames: {},
  repoOrder: [],
  worktreeOrder: {},
  sessionOrder: {},
  activeThemeId: 'ember',
  customThemes: [],
  sessionLayoutGroups: [],
};

function loadFromStorage(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaultSettings, ...parsed };
    }
  } catch { /* ignore */ }
  return defaultSettings;
}

function saveToStorage(settings: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings, null, 2));
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: loadFromStorage(),
  loaded: false,
  resolving: false,

  loadSettings: async () => {
    try {
      const res = await fetch(`${API_URL}/config`);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object' && (data.basePath || data.repositories || data.pinnedIcons || data.worktreeActions)) {
          const merged = { ...defaultSettings, ...data };
          set({ settings: merged, loaded: true });
          saveToStorage(merged);
          return;
        }
      }
    } catch { /* ignore */ }
    set({ settings: loadFromStorage(), loaded: true });
  },

  saveSettings: async (partial) => {
    const current = get().settings;
    const updated = { ...current, ...partial };
    set({ settings: updated });
    saveToStorage(updated);
    try {
      await fetch(`${API_URL}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch { /* ignore */ }
  },

  setSessionDisplayName: (sessionId, name) => {
    const current = get().settings;
    const sessionDisplayNames = { ...current.sessionDisplayNames };
    const trimmed = name.trim();
    if (trimmed) {
      sessionDisplayNames[sessionId] = trimmed;
    } else {
      delete sessionDisplayNames[sessionId];
    }
    const updated = { ...current, sessionDisplayNames };
    set({ settings: updated });
    saveToStorage(updated);
    fetch(`${API_URL}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => { /* ignore */ });
  },

  getSessionDisplayName: (sessionId) => {
    return get().settings.sessionDisplayNames[sessionId];
  },

  setRepoOrder: (order) => {
    const current = get().settings;
    const updated = { ...current, repoOrder: order };
    set({ settings: updated });
    saveToStorage(updated);
    fetch(`${API_URL}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => { /* ignore */ });
  },

  setWorktreeOrder: (repoGroupId, order) => {
    const current = get().settings;
    const worktreeOrder = { ...current.worktreeOrder, [repoGroupId]: order };
    const updated = { ...current, worktreeOrder };
    set({ settings: updated });
    saveToStorage(updated);
    fetch(`${API_URL}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => { /* ignore */ });
  },

  setSessionOrder: (worktreeGroupId, order) => {
    const current = get().settings;
    const sessionOrder = { ...current.sessionOrder, [worktreeGroupId]: order };
    const updated = { ...current, sessionOrder };
    set({ settings: updated });
    saveToStorage(updated);
    fetch(`${API_URL}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => { /* ignore */ });
  },

  resolveRepositories: async () => {
    const { settings } = get();
    if (settings.repositories.length === 0) return;

    set({ resolving: true });
    const resolved: string[] = [];

    for (const pattern of settings.repositories) {
      if (pattern.includes('*')) {
        // Wildcard pattern: org/* -> resolve via API
        const org = pattern.replace('/*', '').replace('*', '');
        try {
          const res = await fetch(`${API_URL}/repositories/resolve?org=${encodeURIComponent(org)}`);
          if (res.ok) {
            const repos: string[] = await res.json();
            resolved.push(...repos);
          } else {
            resolved.push(pattern);
          }
        } catch {
          resolved.push(pattern);
        }
      } else {
        resolved.push(pattern);
      }
    }

    const updated = {
      ...settings,
      resolvedRepositories: [...new Set(resolved)],
      resolvedAt: new Date().toISOString(),
    };
    set({ settings: updated, resolving: false });
    saveToStorage(updated);
    try {
      await fetch(`${API_URL}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch { /* ignore */ }
  },

  executePinnedAction: (icon: PinnedIcon) => {
    if (icon.actionType === 'url') {
      window.open(icon.actionValue, '_blank');
    } else if (icon.actionType === 'shell') {
      fetch(`${API_URL}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: icon.actionValue }),
      }).catch(() => { /* ignore */ });
    }
  },

  executeWorktreeAction: (action: WorktreeAction, context: WorktreeContext) => {
    const resolved = resolveTemplate(action.actionValue, context);
    if (action.actionType === 'url') {
      window.open(resolved, '_blank');
    } else if (action.actionType === 'shell') {
      fetch(`${API_URL}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: resolved }),
      }).catch(() => { /* ignore */ });
    }
  },

  addLayoutGroup: (type) => {
    const current = get().settings;
    const id = `group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const cellCount = type === '2x2' ? 4 : 2;
    const group: SessionLayoutGroup = { id, type, cells: Array(cellCount).fill(null) };
    const sessionLayoutGroups = [...current.sessionLayoutGroups, group];
    const updated = { ...current, sessionLayoutGroups };
    set({ settings: updated });
    saveToStorage(updated);
    fetch(`${API_URL}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => { /* ignore */ });
    return id;
  },

  removeLayoutGroup: (id) => {
    const current = get().settings;
    const sessionLayoutGroups = current.sessionLayoutGroups.filter((g) => g.id !== id);
    const updated = { ...current, sessionLayoutGroups };
    set({ settings: updated });
    saveToStorage(updated);
    fetch(`${API_URL}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => { /* ignore */ });
  },

  bindLayoutGroupCell: (groupId, cellIndex, sessionId) => {
    const current = get().settings;
    const sessionLayoutGroups = current.sessionLayoutGroups.map((g) => {
      if (g.id !== groupId) return g;
      const cells = [...g.cells];
      cells[cellIndex] = sessionId;
      return { ...g, cells };
    });
    const updated = { ...current, sessionLayoutGroups };
    set({ settings: updated });
    saveToStorage(updated);
    fetch(`${API_URL}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => { /* ignore */ });
  },
}));

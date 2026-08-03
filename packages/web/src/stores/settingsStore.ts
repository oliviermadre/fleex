import { create } from 'zustand';
import { DEFAULT_AGENT_MAX_TURNS, migrateActionsConfig, resolveTemplate } from '@fleex/shared';
import type { ActionDef, WorkspaceContext } from '@fleex/shared';
import { API_URL, TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE, STORAGE_KEY_SETTINGS } from '../lib/constants';
import type { Theme } from '../lib/themes';
import * as api from '../services/api';

/**
 * Actions the user can trigger, filtered by scope. Kept as plain functions
 * rather than zustand selectors on purpose: they allocate a new array, so
 * subscribing to them directly would re-render on every store write. Call sites
 * wrap them in `useMemo` keyed on `settings.actions`.
 */
export function globalActions(actions: ActionDef[]): ActionDef[] {
  return actions.filter((a) => a.scope === 'global' && a.enabled !== false);
}

export function workspaceActions(actions: ActionDef[]): ActionDef[] {
  return actions.filter((a) => a.scope === 'workspace' && a.enabled !== false);
}

export interface RepoConfig {
  postCheckoutHook?: string; // multiline shell script, empty = disabled
  hookTimeoutSeconds?: number; // default 60
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
  /**
   * Single registry replacing the former `pinnedIcons` + `workspaceActions`.
   * `scope` is what used to be the array an entry lived in. Nothing here is an
   * executable string the client sends: for `kind: 'exec' | 'shell'` the client
   * only ever posts the action's **id**.
   */
  actions: ActionDef[];
  sessionDisplayNames: Record<string, string>;
  repoOrder: string[];
  worktreeOrder: Record<string, string[]>;
  sessionOrder: Record<string, string[]>;
  activeThemeId: string;
  customThemes: Theme[];
  sessionLayoutGroups: SessionLayoutGroup[];
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalFontThicken: boolean;
  agentMaxConcurrency: number;
  /** Agentic loop cap for plan/edit executions (talk mode has no loop). */
  agentMaxTurns: number;
  humanDisplayName: string;
  repoConfigs: Record<string, RepoConfig>; // key = "org/name"
  /**
   * Name of the workspace this server instance targets, surfaced read-only by
   * the server from its `FLEEX_WORKSPACE` env (never persisted client-side).
   * Empty when the server didn't report one. Used to pin new assistant sessions
   * to the workspace the user is actually viewing — see assistantStore.
   */
  workspace: string;
}

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  loadSettings: () => Promise<void>;
  saveSettings: (partial: Partial<AppSettings>) => Promise<void>;
  setSessionDisplayName: (sessionId: string, name: string) => void;
  getSessionDisplayName: (sessionId: string) => string | undefined;
  setRepoOrder: (order: string[]) => void;
  setWorktreeOrder: (repoGroupId: string, order: string[]) => void;
  setSessionOrder: (worktreeGroupId: string, order: string[]) => void;
  executeAction: (action: ActionDef, context?: WorkspaceContext) => void;
  saveActions: (actions: ActionDef[]) => Promise<void>;
  addLayoutGroup: (type: SessionLayoutType) => string;
  removeLayoutGroup: (id: string) => void;
  bindLayoutGroupCell: (groupId: string, cellIndex: number, sessionId: string | null) => void;
  getRepoConfig: (org: string, name: string) => RepoConfig;
  setRepoConfig: (org: string, name: string, config: RepoConfig) => void;
  addRepositories: (repos: string[]) => Promise<void>;
  removeRepository: (repo: string) => Promise<void>;
}

const defaultSettings: AppSettings = {
  basePath: '',
  repositories: [],
  resolvedRepositories: [],
  resolvedAt: null,
  actions: [],
  sessionDisplayNames: {},
  repoOrder: [],
  worktreeOrder: {},
  sessionOrder: {},
  activeThemeId: 'verdant',
  customThemes: [],
  sessionLayoutGroups: [],
  terminalFontFamily: TERMINAL_FONT_FAMILY,
  terminalFontSize: TERMINAL_FONT_SIZE,
  terminalFontThicken: false,
  agentMaxConcurrency: 1,
  agentMaxTurns: DEFAULT_AGENT_MAX_TURNS,
  humanDisplayName: '',
  repoConfigs: {},
  workspace: '',
};

function loadFromStorage(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw);
    // The cached copy can predate the registry — fold it before merging, so a
    // user's pinned actions survive a reload that happens before the server
    // config comes back.
    if (parsed && typeof parsed === 'object') migrateActionsConfig(parsed);
    return { ...defaultSettings, ...parsed };
  } catch { /* ignore */ }
  return defaultSettings;
}

function saveToStorage(settings: AppSettings) {
  localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings, null, 2));
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: loadFromStorage(),
  loaded: false,

  loadSettings: async () => {
    try {
      const res = await fetch(`${API_URL}/config`);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object' && (data.basePath || data.repositories || data.actions)) {
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
    const trimmed = name.trim();
    api.renameSession(sessionId, trimmed).then(() => {
      // On success, remove local override — server is now authoritative
      const current = get().settings;
      const sessionDisplayNames = { ...current.sessionDisplayNames };
      delete sessionDisplayNames[sessionId];
      const updated = { ...current, sessionDisplayNames };
      set({ settings: updated });
      saveToStorage(updated);
    }).catch(() => {
      // On failure, keep local state as fallback
      const current = get().settings;
      const sessionDisplayNames = { ...current.sessionDisplayNames };
      if (trimmed) {
        sessionDisplayNames[sessionId] = trimmed;
      } else {
        delete sessionDisplayNames[sessionId];
      }
      const updated = { ...current, sessionDisplayNames };
      set({ settings: updated });
      saveToStorage(updated);
    });
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

  executeAction: (action: ActionDef, context?: WorkspaceContext) => {
    // `kind: 'url'` never reaches the server — it's a navigation, so the
    // template is resolved here and opened directly.
    if (action.kind === 'url') {
      const target = context ? resolveTemplate(action.url ?? '', context) : (action.url ?? '');
      if (target) window.open(target, '_blank');
      return;
    }

    // Everything else: post the **id**. The command, its arguments and its cwd
    // all come from server-side config, and the server derives the workspace
    // from the ticket id (which is also why the old /ensure-workspace pre-flight
    // is gone — the run does it, without the race).
    fetch(`${API_URL}/actions/${encodeURIComponent(action.id)}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context ? { ticketId: context.ticket_id } : {}),
    }).catch(() => { /* ignore */ });
  },

  saveActions: async (actions: ActionDef[]) => {
    const current = get().settings;
    const updated = { ...current, actions };
    const res = await fetch(`${API_URL}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    // Unlike saveSettings, this one surfaces the failure: the server validates
    // action definitions and rejects malformed ones, and silently keeping a
    // rejected definition in local state would show the user a saved action
    // that does not exist server-side.
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message ?? `Failed to save actions (${res.status})`);
    }
    set({ settings: updated });
    saveToStorage(updated);
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

  getRepoConfig: (org, name) => {
    const key = `${org}/${name}`;
    return get().settings.repoConfigs[key] ?? {};
  },

  setRepoConfig: (org, name, config) => {
    const key = `${org}/${name}`;
    const current = get().settings;
    const repoConfigs = { ...current.repoConfigs, [key]: config };
    const updated = { ...current, repoConfigs };
    set({ settings: updated });
    saveToStorage(updated);
    fetch(`${API_URL}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => { /* ignore */ });
  },

  addRepositories: async (repos) => {
    const current = get().settings;
    const merged = [...new Set([...current.repositories.map((r) => r.toLowerCase()), ...repos.map((r) => r.toLowerCase())])].sort();
    await api.updateConfig({ repositories: merged });
    const updated = { ...current, repositories: merged };
    set({ settings: updated });
    saveToStorage(updated);
  },

  removeRepository: async (repo) => {
    const target = repo.toLowerCase();
    const current = get().settings;
    const filtered = current.repositories.filter((r) => r.toLowerCase() !== target);
    await api.updateConfig({ repositories: filtered });
    const updated = { ...current, repositories: filtered };
    set({ settings: updated });
    saveToStorage(updated);
  },
}));

import { create } from 'zustand';
import { DEFAULT_AGENT_MAX_TURNS } from '@fleex/shared';
import { API_URL, TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE, STORAGE_KEY_SETTINGS } from '../lib/constants';
import { resolveTemplate, type WorkspaceContext } from '../lib/templateUtils';
import type { Theme } from '../lib/themes';
import * as api from '../services/api';
import { useRepositoryStore } from './repositoryStore';

export interface PinnedIcon {
  id: string;
  icon: string;
  iconType: 'svg' | 'base64' | 'path' | 'url';
  label: string;
  actionType: 'url' | 'shell';
  actionValue: string;
}

export interface WorkspaceAction {
  id: string;
  icon: string;
  iconType: 'svg' | 'base64' | 'path' | 'url';
  label: string;
  actionType: 'url' | 'shell';
  actionValue: string;
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
  pinnedIcons: PinnedIcon[];
  workspaceActions: WorkspaceAction[];
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
  /**
   * Which strategy selects the context injected into agent prompts. Absent means
   * `legacy`, the ranking that shipped before the semantic engine existed.
   */
  memoryEngine?: 'legacy' | 'semantic';
  /**
   * Per-feature switches for everything built on retrieval. Each requires the
   * semantic engine; absent means enabled, so opting into the engine turns them
   * all on and a user disables individually.
   */
  memoryFeatures?: {
    paletteSearch?: boolean;
    ask?: boolean;
    repoScope?: boolean;
    duplicateDetection?: boolean;
    humanFeedbackBoost?: boolean;
    personaCoach?: boolean;
    synthesis?: boolean;
    curation?: boolean;
    assistantMemory?: boolean;
    automationMining?: boolean;
    wikiLinks?: boolean;
    executionTraces?: boolean;
    cliSessions?: boolean;
  };
  /** Catalogue id of the encoder that produces vectors. */
  memoryEmbeddingModel?: string;
  /** Where embeddings are computed: in-process, or a local Ollama daemon. */
  memoryEmbeddingProvider?: 'transformers' | 'ollama';
  /** Character ceiling on injected memory snippets. Unset → engine default. */
  memoryInjectionCharBudget?: number;
  /**
   * Under the current engine, also compute what the semantic engine would have
   * retrieved and record it on the run without injecting it.
   */
  memoryShadowMode?: boolean;
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
  executePinnedAction: (icon: PinnedIcon) => void;
  executeWorkspaceAction: (action: WorkspaceAction, context: WorkspaceContext) => void;
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
  pinnedIcons: [],
  workspaceActions: [],
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
    return { ...defaultSettings, ...parsed };
  } catch { /* ignore */ }
  return defaultSettings;
}

function saveToStorage(settings: AppSettings) {
  localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings, null, 2));
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Commits a repository-list change from the `PUT /config` response.
 *
 * The server response wins over the optimistic local list: only it expands glob
 * patterns into `resolvedRepositories`. Both client-side caches of the repo list
 * are refreshed here — `settings.resolvedRepositories` (ticket repo picker,
 * filters, scratchpads) and the repositoryStore (New Task picker) — so neither
 * goes stale after an add/remove.
 */
function applyRepositoryConfig(
  set: (partial: { settings: AppSettings }) => void,
  current: AppSettings,
  config: Record<string, unknown>,
  fallbackRepositories: string[],
) {
  const updated: AppSettings = {
    ...current,
    repositories: stringList(config['repositories']) ?? fallbackRepositories,
    resolvedRepositories: stringList(config['resolvedRepositories']) ?? current.resolvedRepositories,
  };
  set({ settings: updated });
  saveToStorage(updated);
  void useRepositoryStore.getState().fetchRepositories().catch(() => { /* toasted by request() */ });
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: loadFromStorage(),
  loaded: false,

  loadSettings: async () => {
    try {
      const res = await fetch(`${API_URL}/config`);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object' && (data.basePath || data.repositories || data.pinnedIcons || data.workspaceActions)) {
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

  executeWorkspaceAction: async (action: WorkspaceAction, context: WorkspaceContext) => {
    const resolved = resolveTemplate(action.actionValue, context);
    if (action.actionType === 'url') {
      window.open(resolved, '_blank');
    } else if (action.actionType === 'shell') {
      // The workspace folder is created lazily (on session/agent start), so it
      // may not exist yet for tickets that never ran one (e.g. lead/meeting).
      // Materialize it first so {{workspace_path}} points at a real directory.
      try {
        await fetch(`${API_URL}/tickets/${context.ticket_id}/ensure-workspace`, { method: 'POST' });
      } catch { /* best-effort; still attempt the command below */ }
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
    const config = await api.updateConfig({ repositories: merged });
    applyRepositoryConfig(set, current, config, merged);
  },

  removeRepository: async (repo) => {
    const target = repo.toLowerCase();
    const current = get().settings;
    const filtered = current.repositories.filter((r) => r.toLowerCase() !== target);
    const config = await api.updateConfig({ repositories: filtered });
    applyRepositoryConfig(set, current, config, filtered);
  },
}));

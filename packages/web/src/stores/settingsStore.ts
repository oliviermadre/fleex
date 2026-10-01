import { create } from 'zustand';
import { DEFAULT_AGENT_MAX_TURNS, resolveClickAction } from '@fleex/shared';
import type { ActionRun, ActionRunMode, PinnedIcon, WorkspaceAction } from '@fleex/shared';
import { API_URL, TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE, STORAGE_KEY_SETTINGS } from '../lib/constants';
import { resolveTemplate, type WorkspaceContext } from '../lib/templateUtils';
import type { Theme } from '../lib/themes';
import * as api from '../services/api';
import { useRepositoryStore } from './repositoryStore';
import { DRAFT_SOURCE_PREFIX, getRunOrigin, usePinnedActionsStore } from './pinnedActionsStore';
import { useToastStore } from './toastStore';

// Shape owned by @fleex/shared so the server can read the probes; re-exported
// here because every web caller already imports them from this store.
export type { PinnedIcon, WorkspaceAction };

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
  /** Wall-clock cap (ms) on a single agent/skill execution. Unset → server default. */
  agentExecutionTimeout?: number;
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
    relatedNotes?: boolean;
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
  executePinnedAction: (icon: PinnedIcon) => void;
  executeWorkspaceAction: (action: WorkspaceAction, context: WorkspaceContext) => void;
  /**
   * "Always run in a terminal" from a failed run: persist runMode 'terminal' on
   * the rule the run came from (when identifiable) or else on the action, then
   * re-run it in a terminal. Toasts with an Undo.
   */
  alwaysRunInTerminal: (run: ActionRun) => Promise<void>;
  /** Settings › Actions list operations persist at once, one scope at a time. */
  savePinnedIcons: (icons: PinnedIcon[]) => Promise<void>;
  saveWorkspaceActions: (actions: WorkspaceAction[]) => Promise<void>;
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

/** Set or clear (undefined = inherit / background) a run mode without leaving `runMode: undefined` behind. */
function withRunMode<T extends { runMode?: ActionRunMode }>(item: T, mode: ActionRunMode | undefined): T {
  const { runMode: _old, ...rest } = item;
  return (mode ? { ...rest, runMode: mode } : rest) as T;
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

  executePinnedAction: (icon: PinnedIcon) => {
    // The click target depends on the live status (e.g. ok → log out, else log in).
    const status = icon.status ? usePinnedActionsStore.getState().statuses[icon.id]?.status ?? 'unknown' : null;
    const target = resolveClickAction(icon, status);
    if (target.actionType === 'url') {
      window.open(target.actionValue, '_blank');
      return;
    }
    void usePinnedActionsStore.getState().run({
      sourceId: icon.id,
      sourceKind: 'pinned',
      label: target.rule ? target.rule.label || icon.label : icon.label,
      command: target.actionValue,
      mode: target.runMode,
      // Each rule is its own command: its own terminal, its own "already running".
      ...(target.rule ? { slot: target.rule.id } : {}),
      // A terminal has no timeout: the user is in front of it.
      ...(target.timeoutSec && target.runMode !== 'terminal' ? { timeoutSec: target.timeoutSec } : {}),
    }, {
      ...(target.rule ? { ruleId: target.rule.id } : {}),
      ...(icon.closeTerminalOnSuccess ? { closeOnSuccess: true } : {}),
    });
  },

  executeWorkspaceAction: async (action: WorkspaceAction, context: WorkspaceContext) => {
    const resolved = resolveTemplate(action.actionValue, context);
    if (action.actionType === 'url') {
      window.open(resolved, '_blank');
    } else if (action.actionType === 'shell') {
      // Materialize the workspace first so {{workspace_path}} points at a real
      // directory; if that failed, let the server's default cwd apply.
      const hasWorkspace = await api.ensureTicketWorkspace(context.ticket_id);
      const mode: ActionRunMode = action.runMode ?? 'background';
      void usePinnedActionsStore.getState().run({
        sourceId: action.id,
        sourceKind: 'workspace',
        label: action.label,
        command: resolved,
        mode,
        ...(hasWorkspace ? { cwd: context.workspace_path } : {}),
        ...(action.actionTimeoutSec && mode !== 'terminal' ? { timeoutSec: action.actionTimeoutSec } : {}),
      }, action.closeTerminalOnSuccess ? { closeOnSuccess: true } : {});
    }
  },

  alwaysRunInTerminal: async (run) => {
    const rerun = () => usePinnedActionsStore.getState().rerunInTerminal(run);
    if (run.sourceId.startsWith(DRAFT_SOURCE_PREFIX)) {
      await rerun();
      return;
    }
    const pinned = get().settings.pinnedIcons.some((i) => i.id === run.sourceId);
    const list: (PinnedIcon | WorkspaceAction)[] = pinned ? get().settings.pinnedIcons : get().settings.workspaceActions ?? [];
    const action = list.find((a) => a.id === run.sourceId);
    if (!action) {
      await rerun();
      return;
    }
    // The rule the click resolved to — remembered by this tab, else the one whose command ran.
    const rules = 'conditionalActions' in action ? action.conditionalActions ?? [] : [];
    const ruleId = getRunOrigin(run.runId)?.meta.ruleId
      ?? (action.actionValue !== run.command ? rules.find((r) => r.actionValue === run.command)?.id : undefined);
    const rule = ruleId ? rules.find((r) => r.id === ruleId) : undefined;
    const previous = rule ? rule.runMode : action.runMode;

    const withMode = (items: (PinnedIcon | WorkspaceAction)[], mode: ActionRunMode | undefined) =>
      items.map((a) => {
        if (a.id !== action.id) return a;
        if (rule && 'conditionalActions' in a) {
          return { ...a, conditionalActions: (a.conditionalActions ?? []).map((r) => (r.id === rule.id ? withRunMode(r, mode) : r)) };
        }
        return withRunMode(a, mode);
      });
    const save = (items: (PinnedIcon | WorkspaceAction)[]) =>
      pinned ? get().savePinnedIcons(items as PinnedIcon[]) : get().saveWorkspaceActions(items as WorkspaceAction[]);

    await save(withMode(list, 'terminal'));
    useToastStore.getState().addToast('success', `${rule ? rule.label || action.label : action.label} will always run in a terminal`, {
      durationMs: 8000,
      action: {
        label: 'Undo',
        onClick: () => {
          const current: (PinnedIcon | WorkspaceAction)[] = pinned ? get().settings.pinnedIcons : get().settings.workspaceActions ?? [];
          void save(withMode(current, previous));
        },
      },
    });
    await rerun();
  },

  savePinnedIcons: async (icons) => {
    const updated = { ...get().settings, pinnedIcons: icons };
    set({ settings: updated });
    saveToStorage(updated);
    await api.updateConfig({ pinnedIcons: icons }).catch(() => { /* toasted by request() */ });
  },

  saveWorkspaceActions: async (actions) => {
    const updated = { ...get().settings, workspaceActions: actions };
    set({ settings: updated });
    saveToStorage(updated);
    await api.updateConfig({ workspaceActions: actions }).catch(() => { /* toasted by request() */ });
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

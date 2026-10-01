import { ACTION_DEFAULT_TIMEOUT_SEC, PROBE_DEFAULT_INTERVAL_SEC, PROBE_DEFAULT_TIMEOUT_SEC } from '@fleex/shared';
import type { ActionIconType, ActionRunMode, ConditionalAction, PinnedIcon, WorkspaceAction } from '@fleex/shared';
import type { ActionsScope } from '../../../stores/uiStore';

/**
 * The detail screen edits one shape for both scopes: a pinned icon. A ticket
 * action is the same minus the probe and rules, which `toWorkspaceAction`
 * strips on save — so the form never forks per scope.
 */
export type ActionDraft = PinnedIcon;

/** Fields an assistant filled; the "✨ suggested" mark stays until the field is edited by hand. */
export type AiField = 'label' | 'icon' | 'actionValue' | 'status' | 'conditionalActions';

export type DraftErrors = Partial<Record<'label' | 'actionValue' | 'probe' | `rule:${number}`, string>>;

export function newId(): string {
  return crypto.randomUUID();
}

export function blankDraft(): ActionDraft {
  return { id: newId(), label: '', icon: '', iconType: 'svg', actionType: 'shell', actionValue: '', enabled: true };
}

export function toWorkspaceAction(draft: ActionDraft): WorkspaceAction {
  const { status: _status, conditionalActions: _rules, ...rest } = draft;
  return rest;
}

export function isEnabled(action: { enabled?: boolean }): boolean {
  return action.enabled !== false;
}

/**
 * Blocking errors only. A pinned command with `{{…}}` is a warning (it may be a
 * literal), surfaced separately by `draftWarnings`.
 */
export function validateDraft(draft: ActionDraft, scope: ActionsScope): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.label.trim()) errors.label = 'A name is required.';
  if (!draft.actionValue.trim()) errors.actionValue = draft.actionType === 'url' ? 'A URL is required.' : 'A command is required.';
  else if (draft.actionType === 'url' && !/^https?:\/\//.test(draft.actionValue.trim()) && !draft.actionValue.includes('{{')) {
    errors.actionValue = 'A URL must start with http:// or https://.';
  }
  if (scope === 'pinned' && draft.status) {
    if (!draft.status.command.trim()) errors.probe = 'The probe needs a command (or turn the status off).';
    (draft.conditionalActions ?? []).forEach((rule, i) => {
      if (!rule.when?.length) errors[`rule:${i}`] = 'Pick at least one status.';
      else if (!rule.actionValue.trim()) errors[`rule:${i}`] = 'The rule needs a command.';
    });
  }
  return errors;
}

export function draftWarnings(draft: ActionDraft, scope: ActionsScope): string[] {
  if (scope === 'pinned' && /\{\{[^}]+\}\}/.test(draft.actionValue)) {
    return ['Ticket variables like {{workspace_path}} are not resolved for top-bar actions.'];
  }
  return [];
}

/**
 * Run mode fields only mean something for a shell command: absent = background,
 * and "close on success" only applies to a terminal.
 */
function normaliseRunMode<T extends { actionType: 'url' | 'shell'; runMode?: ActionRunMode; closeTerminalOnSuccess?: boolean }>(item: T): T {
  const { runMode, closeTerminalOnSuccess, ...rest } = item;
  if (item.actionType !== 'shell' || runMode !== 'terminal') return rest as T;
  return { ...rest, runMode, ...(closeTerminalOnSuccess ? { closeTerminalOnSuccess } : {}) } as T;
}

/** A rule's runMode overrides the action's: keep it whenever it is set on a shell rule. */
function normaliseRule(rule: ConditionalAction): ConditionalAction {
  const { runMode, ...rest } = rule;
  return rule.actionType === 'shell' && runMode ? { ...rest, runMode } : rest;
}

/** What gets persisted: trimmed, ticket scope stripped of probe/rules, rules dropped when the probe is off. */
export function normaliseDraft(draft: ActionDraft, scope: ActionsScope): PinnedIcon | WorkspaceAction {
  const base: ActionDraft = normaliseRunMode({ ...draft, label: draft.label.trim(), actionValue: draft.actionValue.trim() });
  if (base.conditionalActions) base.conditionalActions = base.conditionalActions.map(normaliseRule);
  if (scope === 'ticket') return toWorkspaceAction(base);
  if (!base.status) {
    const { conditionalActions: _rules, ...rest } = base;
    return rest;
  }
  return base;
}

export function inferIconType(value: string): { icon: string; iconType: ActionIconType } | null {
  const v = value.trim();
  if (!v) return null;
  if (v.startsWith('<svg') || v.startsWith('<?xml')) return { icon: v, iconType: 'svg' };
  if (/^https?:\/\//.test(v)) return { icon: v, iconType: 'url' };
  if (v.startsWith('data:image/')) return { icon: v.replace(/^data:image\/[a-z+]+;base64,/, ''), iconType: 'base64' };
  if (v.startsWith('/')) return { icon: v, iconType: 'path' };
  if (/^[A-Za-z0-9+/=\s]+$/.test(v) && v.length > 64) return { icon: v.replace(/\s/g, ''), iconType: 'base64' };
  return null;
}

/** Move one item by `delta` positions; out-of-range moves are no-ops. */
export function moveItem<T extends { id: string }>(list: readonly T[], id: string, delta: number): T[] {
  const from = list.findIndex((x) => x.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

// ─── Templates ───────────────────────────────────────────────────────────────

const LUCIDE = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const TEMPLATE_ICONS = {
  github: LUCIDE('<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>'),
  cloud: LUCIDE('<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>'),
  wheel: LUCIDE('<circle cx="12" cy="12" r="8"/><path d="M12 4v5.5M12 14.5V20M4 12h5.5M14.5 12H20"/><circle cx="12" cy="12" r="2.5"/>'),
  box: LUCIDE('<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>'),
  globe: LUCIDE('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'),
  code: LUCIDE('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'),
  pr: LUCIDE('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/>'),
  folder: LUCIDE('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
  plus: LUCIDE('<path d="M5 12h14"/><path d="M12 5v14"/>'),
} as const;

export interface ActionTemplate {
  key: string;
  title: string;
  description: string;
  icon: string;
  build: () => ActionDraft;
}

const GH_PROBE = `if gh auth status >/dev/null 2>&1; then
  u=$(gh api user -q .login); r=$(gh api rate_limit -q .rate.remaining)
  printf '{"status":"%s","tooltip":"@%s — quota %s/5000","badge":"%s"}' \\
    "$([ "$r" -lt 500 ] && echo warn || echo ok)" "$u" "$r" "$r"
else echo '{"status":"ko","tooltip":"gh not authenticated"}'; fi`;

const k8sProbe = (ctx: string) => `kubectl --context ${ctx} cluster-info --request-timeout=5s >/dev/null 2>&1 \\
  && echo '{"status":"ok","tooltip":"${ctx}: context loaded"}' \\
  || echo '{"status":"ko","tooltip":"${ctx}: not connected"}'`;

const probe = (command: string, intervalSec = PROBE_DEFAULT_INTERVAL_SEC) => ({ command, intervalSec, timeoutSec: PROBE_DEFAULT_TIMEOUT_SEC });

const draftOf = (partial: Partial<ActionDraft>): ActionDraft => ({ ...blankDraft(), ...partial });

export const TEMPLATES: Record<ActionsScope, ActionTemplate[]> = {
  pinned: [
    {
      key: 'gh', title: 'GitHub CLI', description: 'Login state + API quota', icon: TEMPLATE_ICONS.github,
      build: () => draftOf({ label: 'GitHub CLI', icon: TEMPLATE_ICONS.github, actionValue: 'gh auth login --web --hostname github.com', status: probe(GH_PROBE) }),
    },
    {
      key: 'gcloud', title: 'GCloud auth', description: 'Token valid? Log in again', icon: TEMPLATE_ICONS.cloud,
      build: () => draftOf({
        label: 'GCloud auth', icon: TEMPLATE_ICONS.cloud, actionValue: 'gcloud auth login --update-adc', actionTimeoutSec: ACTION_DEFAULT_TIMEOUT_SEC,
        status: probe('gcloud auth print-access-token --quiet >/dev/null 2>&1', 300),
      }),
    },
    {
      key: 'k8s', title: 'Kubernetes context', description: 'Toggle connect / disconnect', icon: TEMPLATE_ICONS.wheel,
      build: () => draftOf({
        label: 'K8s staging', icon: TEMPLATE_ICONS.wheel, actionValue: 'platool login staging', status: probe(k8sProbe('staging')),
        conditionalActions: [{ id: newId(), label: 'Disconnect from staging', when: ['ok'], actionType: 'shell', actionValue: 'platool logout staging' }],
      }),
    },
    {
      key: 'docker', title: 'Docker Desktop', description: 'Is the daemon up?', icon: TEMPLATE_ICONS.box,
      build: () => draftOf({ label: 'Docker', icon: TEMPLATE_ICONS.box, actionValue: 'open -a Docker', status: probe('docker info >/dev/null 2>&1') }),
    },
    {
      key: 'url', title: 'Open a URL', description: 'A link, no status', icon: TEMPLATE_ICONS.globe,
      build: () => draftOf({ label: 'Link', icon: TEMPLATE_ICONS.globe, actionType: 'url', actionValue: 'https://' }),
    },
    { key: 'blank', title: 'Blank action', description: 'Start from scratch', icon: TEMPLATE_ICONS.plus, build: blankDraft },
  ],
  ticket: [
    {
      key: 'cursor', title: 'Open in editor', description: 'Cursor, VS Code, PhpStorm…', icon: TEMPLATE_ICONS.code,
      build: () => draftOf({ label: 'Open in Cursor', icon: TEMPLATE_ICONS.code, actionValue: 'cursor "{{workspace_path}}"' }),
    },
    {
      key: 'pr', title: "Ticket's PR", description: 'gh pr view --web', icon: TEMPLATE_ICONS.pr,
      build: () => draftOf({ label: 'PR on GitHub', icon: TEMPLATE_ICONS.pr, actionValue: 'cd "{{workspace_path}}" && gh pr view --web' }),
    },
    {
      key: 'finder', title: 'Workspace folder', description: 'Finder', icon: TEMPLATE_ICONS.folder,
      build: () => draftOf({ label: 'Finder', icon: TEMPLATE_ICONS.folder, actionValue: 'open "{{workspace_path}}"' }),
    },
    { key: 'blank', title: 'Blank action', description: 'Start from scratch', icon: TEMPLATE_ICONS.plus, build: blankDraft },
  ],
};

export const TEMPLATE_VARIABLES: [string, string][] = [
  ['{{workspace_path}}', 'Workspace folder absolute path'],
  ['{{workspace_name}}', 'Workspace folder name (id-slug)'],
  ['{{ticket_id}}', 'Full ticket id'],
  ['{{ticket_slug}}', 'Slugified ticket title'],
  ['{{ticket_display_id}}', 'Ticket display number'],
];

export const PIPE_FUNCTIONS: [string, string][] = [
  ['slug', 'Replace non-alphanumeric with -'],
  ['lower', 'Lowercase'],
  ['upper', 'Uppercase'],
  ['trim', 'Trim whitespace'],
  ['substr(start, len?)', 'Extract substring'],
  ['replace(search, repl)', 'Replace all occurrences'],
  ['default(fallback)', 'Fallback if empty'],
];

export const COMPOSE_IDEAS: Record<ActionsScope, string[]> = {
  pinned: [
    'Show whether gh is logged in, with my API quota',
    'Log me back into gcloud when the token expires',
    'Toggle the prod cluster with platool',
    'Is Docker running?',
  ],
  ticket: [
    'Open the workspace in Cursor',
    "Open the ticket's pull request in the browser",
    'Run the tests of the workspace',
    'Open the workspace folder in Finder',
  ],
};

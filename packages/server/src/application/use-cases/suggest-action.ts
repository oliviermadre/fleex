import { randomUUID } from 'node:crypto';
import { ACTION_STATUSES, PROBE_DEFAULT_INTERVAL_SEC } from '@fleex/shared';
import type {
  ActionScope,
  ActionStatus,
  ActionsAiCommandRequest,
  ActionsAiCommandSuggestion,
  ActionsAiDraftResult,
  ActionsAiDraftStage,
  ActionsAiIconsRequest,
  ActionsAiIconsResponse,
  BinaryCheck,
  CommandRisk,
  ConditionalAction,
  IconSuggestion,
} from '@fleex/shared';
import { enforceRisk, extractBinaries } from '../../domain/services/command-safety.js';
import { sanitizeSvg } from '../../domain/services/svg-sanitizer.js';
import type { LoggerPort } from '../ports/logger.port.js';

/** Fast and cheap: these are short structured completions. Swap here to change model. */
export const ACTIONS_AI_MODEL = 'claude-haiku-4-5-20251001';

/** One non-agentic completion that should return a JSON object. */
export interface JsonModelPort {
  complete(systemPrompt: string, prompt: string): Promise<string>;
}

export interface BinaryLookupPort {
  lookup(name: string): Promise<BinaryCheck>;
}

export interface IconSearchPort {
  /** Throws when the icon source is unreachable, so the caller can fall back to generated icons. */
  search(keywords: string[], options: { brandFirst: boolean; limit: number; exclude?: string[] }): Promise<IconSuggestion[]>;
}

export class ActionsAiError extends Error {}

const ENVIRONMENT = `
Execution environment of every command (non-negotiable):
- Run by Fleex as \`/bin/zsh -l -c "<command>"\` on the user's macOS/Linux machine.
- No TTY and no stdin: nothing may prompt or wait for keyboard input (no \`read\`, no interactive menus,
  no pager — pass flags like --quiet, --no-pager, --web, --yes only when they avoid a prompt).
- Opening a browser is fine (e.g. \`gh auth login --web\`, \`gcloud auth login\`, \`open <url>\`).
- Working directory: the user's home for top-bar actions; the ticket workspace for ticket actions.
`.trim();

const COMMAND_SYSTEM = `
You write a single shell command for a one-click button in Fleex, a developer tool.

${ENVIRONMENT}

Reply with ONE JSON object and nothing else:
{"command": string, "explanation": string, "risk": "safe" | "mutating" | "destructive", "alternatives": string[]}

- "explanation": 1–2 sentences, in the language of the user's request.
- "risk": "safe" = read-only; "mutating" = changes local state or logs in/out; "destructive" = deletes or overwrites.
- "alternatives": at most 2 other valid commands, may be empty.
- Prefer the user's real tools; never invent flags you are unsure of.
`.trim();

const PROBE_RULES = `
This command is a STATUS PROBE run every minute. It must be read-only, finish in a few seconds
(use short timeouts on network calls) and either:
- exit 0 when everything is fine, non-zero when the user must act; or
- print exactly one JSON object on stdout: {"status":"ok"|"warn"|"ko"|"unknown","tooltip":"<short text>","badge":"<≤6 chars>"}
  (tooltip and badge optional). Prefer the JSON form when there is useful detail (account, quota, context).
`.trim();

const TICKET_RULES = `
This is a TICKET action: use the template variables {{workspace_path}}, {{workspace_name}}, {{ticket_id}},
{{ticket_slug}}, {{ticket_display_id}} where relevant (always quote "{{workspace_path}}").
`.trim();

const ICON_SYSTEM = `
You pick icon search keywords for a button in a developer tool.
Reply with ONE JSON object and nothing else:
{"keywords": string[] (3 to 5, English, most specific first), "brand": string | null (the product/brand name if the action is about one, lowercase), "generate": boolean (true only if no stock icon would fit)}
`.trim();

const GENERATE_SYSTEM = `
You draw one minimal line icon as SVG. Reply with ONE JSON object and nothing else: {"svg": string}
Constraints: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">,
at most 6 primitives among path/circle/rect/line/polyline/polygon, no text, no style, no script, no colours.
`.trim();

const PLAN_SYSTEM = `
You turn a user's description into the plan of a Fleex button. A button has a default click action,
optionally (top-bar buttons only) a status probe that colours a dot, and optionally rules that change the
click action depending on the status (e.g. "if ok → log out", default → log in).
Reply with ONE JSON object and nothing else:
{"label": string (2–4 words, Title Case, in the user's language),
 "actionType": "shell" | "url",
 "url": string | null (only for actionType "url"),
 "actionIntent": string (what the default click must do, one sentence, for a shell action),
 "probeIntent": string | null (how to know the status is OK; null if no status makes sense),
 "rules": [{"label": string, "when": ("ok"|"warn"|"ko"|"unknown")[], "intent": string}],
 "notes": string | null}
Rules only make sense with a probe. Keep rules to the minimum (usually 0 or 1).
`.trim();

/** Extract and parse the first JSON object of a completion (models sometimes fence it). */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strList = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.map(str).filter((x): x is string => x !== null).slice(0, max) : [];
const isStatus = (v: unknown): v is ActionStatus => typeof v === 'string' && (ACTION_STATUSES as readonly string[]).includes(v);

export function validateCommand(o: Record<string, unknown>): { command: string; explanation: string; risk?: CommandRisk; alternatives: string[] } | null {
  const command = str(o['command']);
  if (!command) return null;
  const risk = o['risk'];
  return {
    command,
    explanation: str(o['explanation']) ?? '',
    ...(risk === 'safe' || risk === 'mutating' || risk === 'destructive' ? { risk } : {}),
    alternatives: strList(o['alternatives'], 2).filter((a) => a !== command),
  };
}

export function validateIconPlan(o: Record<string, unknown>): { keywords: string[]; brand: string | null; generate: boolean } | null {
  const keywords = strList(o['keywords'], 5);
  if (keywords.length === 0) return null;
  return { keywords, brand: str(o['brand'])?.toLowerCase() ?? null, generate: o['generate'] === true };
}

export interface DraftPlan {
  label: string;
  actionType: 'shell' | 'url';
  url: string | null;
  actionIntent: string;
  probeIntent: string | null;
  rules: { label: string; when: ActionStatus[]; intent: string }[];
  notes: string | null;
}

export function validatePlan(o: Record<string, unknown>): DraftPlan | null {
  const label = str(o['label']);
  if (!label) return null;
  const actionType = o['actionType'] === 'url' ? 'url' : 'shell';
  const url = str(o['url']);
  if (actionType === 'url' && !(url && /^https?:\/\//.test(url))) return null;
  const actionIntent = str(o['actionIntent']) ?? label;
  const rules = Array.isArray(o['rules'])
    ? o['rules']
        .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : null))
        .filter((r): r is Record<string, unknown> => r !== null)
        .map((r) => ({
          label: str(r['label']) ?? '',
          when: Array.isArray(r['when']) ? (r['when'] as unknown[]).filter(isStatus) : [],
          intent: str(r['intent']) ?? '',
        }))
        .filter((r) => r.label && r.intent && r.when.length > 0)
        .slice(0, 3)
    : [];
  return { label, actionType, url: actionType === 'url' ? url : null, actionIntent, probeIntent: str(o['probeIntent']), rules, notes: str(o['notes']) };
}

/**
 * The three Settings › Actions assistants: a command from plain language, icon
 * suggestions, and a whole draft from one sentence.
 *
 * They only ever fill fields. Nothing here executes the commands it proposes —
 * those touch prod and staging — and the risk label shown to the user is the
 * stricter of the model's opinion and the server's own pattern list.
 */
export class SuggestActionUseCase {
  constructor(
    private readonly model: JsonModelPort,
    private readonly binaries: BinaryLookupPort,
    private readonly icons: IconSearchPort,
    private readonly logger: LoggerPort,
  ) {}

  async command(request: ActionsAiCommandRequest): Promise<ActionsAiCommandSuggestion> {
    const intent = request.intent?.trim();
    if (!intent) throw new ActionsAiError('intent is required');

    const rules = [COMMAND_SYSTEM];
    if (request.kind === 'probe') rules.push(PROBE_RULES);
    if (request.scope === 'ticket') rules.push(TICKET_RULES);
    const context = request.context ?? {};
    const prompt = [
      `Request: ${intent}`,
      `Kind: ${request.kind === 'probe' ? 'status probe' : request.kind === 'rule' ? 'click action used when a status rule matches' : 'default click action'}`,
      context.label ? `Button label: ${context.label}` : null,
      context.currentCommand ? `Current command: ${context.currentCommand}` : null,
      context.defaultCommand && request.kind !== 'action' ? `Default click action: ${context.defaultCommand}` : null,
      context.probeCommand && request.kind !== 'probe' ? `Status probe: ${context.probeCommand}` : null,
      request.exclude?.length ? `Already proposed (propose something different): ${request.exclude.join(' | ')}` : null,
    ].filter(Boolean).join('\n');

    const parsed = await this.ask(rules.join('\n\n'), prompt, validateCommand);
    const names = extractBinaries(parsed.command);
    const binaries = await Promise.all(names.slice(0, 6).map((name) => this.binaries.lookup(name)));
    return {
      command: parsed.command,
      explanation: parsed.explanation,
      risk: enforceRisk(parsed.command, parsed.risk),
      binaries,
      ...(parsed.alternatives.length ? { alternatives: parsed.alternatives } : {}),
    };
  }

  async iconSuggestions(request: ActionsAiIconsRequest): Promise<ActionsAiIconsResponse> {
    const label = request.label?.trim();
    if (!label && !request.command) throw new ActionsAiError('label or command is required');
    // The command shapes the keywords but never leaves this server: only the
    // keywords are sent to Iconify.
    const plan = await this.ask(
      ICON_SYSTEM,
      [`Button label: ${label ?? ''}`, request.command ? `Command: ${request.command}` : null, request.probeCommand ? `Status probe: ${request.probeCommand}` : null]
        .filter(Boolean).join('\n'),
      validateIconPlan,
    );

    let suggestions: IconSuggestion[] = [];
    let iconifyUnavailable = false;
    try {
      const keywords = plan.brand && !plan.keywords.includes(plan.brand) ? [plan.brand, ...plan.keywords] : plan.keywords;
      suggestions = await this.icons.search(keywords, { brandFirst: !!plan.brand, limit: 6, exclude: request.exclude });
    } catch (error) {
      iconifyUnavailable = true;
      this.logger.warn('Iconify unreachable, generating icon only', { error: error instanceof Error ? error.message : String(error) });
    }

    if (plan.generate || suggestions.length === 0 || iconifyUnavailable) {
      const generated = await this.generateIcon(label ?? request.command ?? 'action', plan.keywords).catch(() => null);
      if (generated) suggestions = [...suggestions, generated];
    }
    return { keywords: plan.keywords, suggestions, ...(iconifyUnavailable ? { iconifyUnavailable: true } : {}) };
  }

  async draft(params: { prompt: string; scope: ActionScope; onStage?: (stage: ActionsAiDraftStage) => void }): Promise<ActionsAiDraftResult> {
    const prompt = params.prompt?.trim();
    if (!prompt) throw new ActionsAiError('prompt is required');
    const pinned = params.scope === 'pinned';

    params.onStage?.('intent');
    const plan = await this.ask(
      PLAN_SYSTEM + (pinned ? '' : '\nThis is a TICKET button: no probe and no rules (set probeIntent null and rules []).'),
      `User description: ${prompt}`,
      validatePlan,
    );

    params.onStage?.('command');
    let actionValue = plan.url ?? '';
    const conditionalActions: ConditionalAction[] = [];
    if (plan.actionType === 'shell') {
      actionValue = (await this.command({ intent: plan.actionIntent, kind: 'action', scope: params.scope, context: { label: plan.label } })).command;
    }

    let status: ActionsAiDraftResult['draft']['status'];
    if (pinned && plan.probeIntent) {
      params.onStage?.('probe');
      const probe = await this.command({ intent: plan.probeIntent, kind: 'probe', scope: 'pinned', context: { label: plan.label, defaultCommand: actionValue } });
      status = { command: probe.command, intervalSec: PROBE_DEFAULT_INTERVAL_SEC };
      for (const rule of plan.rules) {
        const suggestion = await this.command({
          intent: rule.intent,
          kind: 'rule',
          scope: 'pinned',
          context: { label: plan.label, defaultCommand: actionValue, probeCommand: probe.command },
        });
        conditionalActions.push({ id: randomUUID(), label: rule.label, when: rule.when, actionType: 'shell', actionValue: suggestion.command });
      }
    }

    params.onStage?.('icon');
    const icons = await this.iconSuggestions({ label: plan.label, command: actionValue, probeCommand: status?.command }).catch(() => null);

    return {
      draft: {
        label: plan.label,
        actionType: plan.actionType,
        actionValue,
        ...(status ? { status } : {}),
        ...(conditionalActions.length ? { conditionalActions } : {}),
      },
      icon: icons?.suggestions[0] ?? null,
      ...(plan.notes ? { notes: plan.notes } : {}),
    };
  }

  private async generateIcon(label: string, keywords: string[]): Promise<IconSuggestion | null> {
    const result = await this.ask(GENERATE_SYSTEM, `Icon for: ${label} (${keywords.join(', ')})`, (o) => {
      const svg = typeof o['svg'] === 'string' ? sanitizeSvg(o['svg']) : null;
      return svg ? { svg } : null;
    });
    return { id: `generated:${keywords[0] ?? 'icon'}`, source: 'generated', name: label, svg: result.svg, license: 'generated' };
  }

  /** One completion, parsed and validated; retried once with the error spelled out. */
  private async ask<T>(system: string, prompt: string, validate: (o: Record<string, unknown>) => T | null): Promise<T> {
    let lastText = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const fullPrompt = attempt === 0
        ? prompt
        : `${prompt}\n\nYour previous reply was not a valid JSON object matching the required shape:\n${lastText.slice(0, 500)}\nReply again with ONLY the JSON object.`;
      lastText = await this.model.complete(system, fullPrompt);
      const object = parseJsonObject(lastText);
      const value = object ? validate(object) : null;
      if (value) return value;
    }
    this.logger.warn('Actions AI returned an invalid answer twice', { reply: lastText.slice(0, 300) });
    throw new ActionsAiError('The model did not return a usable answer. Try rephrasing.');
  }
}

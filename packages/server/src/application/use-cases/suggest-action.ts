import { randomUUID } from 'node:crypto';
import { ACTION_STATUSES, PROBE_DEFAULT_INTERVAL_SEC, aliasUsesTty } from '@fleex/shared';
import type {
  ActionRunMode,
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
import { guessIconKeywords } from '../../domain/services/icon-keywords.js';
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
  search(keywords: string[], options: { brandFirst: boolean; limit: number; exclude?: string[]; includeBrands?: boolean }): Promise<IconSuggestion[]>;
}

export class ActionsAiError extends Error {}

/** Two rows of the picker: brand searches return the same logo in colour and in mono. */
const ICON_SUGGESTION_LIMIT = 12;

const ENVIRONMENT = `
Execution environment of every command (non-negotiable):
- Run by Fleex as \`/bin/zsh -l -c "<command>"\` on the user's macOS/Linux machine.
- No TTY and no stdin: nothing may prompt or wait for keyboard input (no \`read\`, no interactive menus,
  no pager — pass flags like --quiet, --no-pager, --web, --yes only when they avoid a prompt).
- Opening a browser is fine (e.g. \`gh auth login --web\`, \`gcloud auth login\`, \`open <url>\`).
- .zshrc is NOT loaded: never rely on an alias or a shell function — use the real program.
- A command that truly needs a terminal (a TTY like \`docker run -it\`, a prompt to answer) can run in a
  terminal the user sees: set "runMode": "terminal" for it, "background" otherwise.
- Working directory: the user's home for top-bar actions; the ticket workspace for ticket actions.
`.trim();

const COMMAND_SYSTEM = `
You write a single shell command for a one-click button in Fleex, a developer tool.

${ENVIRONMENT}

Reply with ONE JSON object and nothing else:
{"command": string, "explanation": string, "risk": "safe" | "mutating" | "destructive", "alternatives": string[], "runMode": "background" | "terminal"}

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

const DRAFT_SYSTEM = `
You design a one-click button for Fleex, a developer tool, from the user's description — in ONE answer.
A button has a default click action, optionally (top-bar buttons only) a status probe that colours a dot,
and optionally rules that change the click action depending on the status (e.g. "if ok → log out",
default → log in).

${ENVIRONMENT}

Reply with ONE JSON object and nothing else:
{"label": string (2–4 words, Title Case, in the user's language),
 "actionType": "shell" | "url",
 "actionValue": string (the default command, or an http(s) URL for "url"),
 "probe": string | null (the status probe command; null when no status makes sense),
 "rules": [{"label": string, "when": ("ok"|"warn"|"ko"|"unknown")[], "command": string}],
 "iconKeywords": string[] (3 to 5 English icon search keywords, most specific first),
 "brand": string | null (lowercase product/brand name the button is about, if any),
 "notes": string | null (one short caveat for the user, e.g. an assumed sub-command)}
Rules only make sense with a probe; keep them to the minimum (usually 0 or 1). Prefer the default action
for the state that needs fixing (e.g. log in) and a rule for the other one (e.g. ok → log out).
Never invent flags you are unsure of.
`.trim();

/**
 * Extract and parse the first JSON object of a completion (models sometimes
 * fence it, or add a sentence after it). The object ends at the `}` matching
 * its opening `{` — not the last `}` of the text, which may belong to trailing
 * prose like "uses {{workspace_path}}". Braces inside JSON strings don't count.
 */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    const end = matchingBrace(text, start);
    if (end < 0) continue;
    try {
      const value: unknown = JSON.parse(text.slice(start, end + 1));
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // not JSON (e.g. a `{{var}}` in prose before the object): try the next `{`
    }
  }
  return null;
}

/** Index of the `}` closing the `{` at `start`, skipping braces inside strings; -1 if unbalanced. */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i += 1;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strList = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.map(str).filter((x): x is string => x !== null).slice(0, max) : [];
const isStatus = (v: unknown): v is ActionStatus => typeof v === 'string' && (ACTION_STATUSES as readonly string[]).includes(v);

export function validateCommand(o: Record<string, unknown>): { command: string; explanation: string; risk?: CommandRisk; alternatives: string[]; runMode?: ActionRunMode } | null {
  const command = str(o['command']);
  if (!command) return null;
  const risk = o['risk'];
  const runMode = o['runMode'];
  return {
    command,
    explanation: str(o['explanation']) ?? '',
    ...(risk === 'safe' || risk === 'mutating' || risk === 'destructive' ? { risk } : {}),
    alternatives: strList(o['alternatives'], 2).filter((a) => a !== command),
    ...(runMode === 'terminal' || runMode === 'background' ? { runMode } : {}),
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
  actionValue: string;
  probe: string | null;
  rules: { label: string; when: ActionStatus[]; command: string }[];
  iconKeywords: string[];
  brand: string | null;
  notes: string | null;
}

export function validateDraftPlan(o: Record<string, unknown>): DraftPlan | null {
  const label = str(o['label']);
  const actionValue = str(o['actionValue']);
  if (!label || !actionValue) return null;
  const actionType = o['actionType'] === 'url' ? 'url' : 'shell';
  if (actionType === 'url' && !/^https?:\/\//.test(actionValue)) return null;
  const rules = Array.isArray(o['rules'])
    ? o['rules']
        .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : null))
        .filter((r): r is Record<string, unknown> => r !== null)
        .map((r) => ({
          label: str(r['label']) ?? '',
          when: Array.isArray(r['when']) ? (r['when'] as unknown[]).filter(isStatus) : [],
          command: str(r['command']) ?? '',
        }))
        .filter((r) => r.label && r.command && r.when.length > 0)
        .slice(0, 3)
    : [];
  return {
    label,
    actionType,
    actionValue,
    probe: str(o['probe']),
    rules,
    iconKeywords: strList(o['iconKeywords'], 5),
    brand: str(o['brand'])?.toLowerCase() ?? null,
    notes: str(o['notes']),
  };
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
      'Write the explanation in the language of the request above.',
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
      // A probe never runs in a terminal; a `-it` command always needs one, whatever the model said.
      ...(request.kind !== 'probe' && (parsed.runMode === 'terminal' || aliasUsesTty(parsed.command)) ? { runMode: 'terminal' as const } : {}),
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

    return this.findIcons(plan.keywords, plan.brand, plan.generate, label ?? request.command ?? 'action', request.exclude);
  }

  /**
   * The picker's instant first answer: keywords guessed from the label and the
   * command, no model call (each one costs ~5 s of process spawn). Haiku's
   * `iconSuggestions` refines it in parallel.
   */
  async quickIconSuggestions(request: ActionsAiIconsRequest): Promise<ActionsAiIconsResponse> {
    const { keywords, brand } = guessIconKeywords(request.label, request.command);
    if (keywords.length === 0) return { keywords, suggestions: [] };
    try {
      const terms = brand && !keywords.includes(brand) ? [brand, ...keywords] : keywords;
      return { keywords, suggestions: await this.icons.search(terms, { brandFirst: !!brand, includeBrands: !!brand, limit: ICON_SUGGESTION_LIMIT, exclude: request.exclude }) };
    } catch {
      return { keywords, suggestions: [], iconifyUnavailable: true };
    }
  }

  /** Iconify first (brand first when there is one); a generated SVG when asked, when nothing fits, or when Iconify is down. */
  private async findIcons(keywords: string[], brand: string | null, generate: boolean, label: string, exclude?: string[]): Promise<ActionsAiIconsResponse> {
    let suggestions: IconSuggestion[] = [];
    let iconifyUnavailable = false;
    try {
      const terms = brand && !keywords.includes(brand) ? [brand, ...keywords] : keywords;
      // Brand logos only when the action is about a brand: otherwise a keyword like
      // "toggle" matches arbitrary logos (a staging toggle got the Deno Deploy one).
      suggestions = await this.icons.search(terms, { brandFirst: !!brand, includeBrands: !!brand, limit: ICON_SUGGESTION_LIMIT, exclude });
    } catch (error) {
      iconifyUnavailable = true;
      this.logger.warn('Iconify unreachable, generating icon only', { error: error instanceof Error ? error.message : String(error) });
    }
    if (generate || suggestions.length === 0 || iconifyUnavailable) {
      const generated = await this.generateIcon(label, keywords).catch(() => null);
      if (generated) suggestions = [...suggestions, generated];
    }
    return { keywords, suggestions, ...(iconifyUnavailable ? { iconifyUnavailable: true } : {}) };
  }

  /**
   * A whole button from one sentence, in ONE model call: every extra SDK call
   * spawns a Claude Code process, and six of them in a row made "one click" take
   * two minutes. The same environment and probe rules as the per-field assistant
   * go into that call, and the same code-side checks (risk floor, binaries,
   * Iconify) run on what comes back.
   */
  async draft(params: { prompt: string; scope: ActionScope; onStage?: (stage: ActionsAiDraftStage) => void }): Promise<ActionsAiDraftResult> {
    const prompt = params.prompt?.trim();
    if (!prompt) throw new ActionsAiError('prompt is required');
    const pinned = params.scope === 'pinned';

    params.onStage?.('intent');
    const system = [DRAFT_SYSTEM, PROBE_RULES.replace('This command', 'The "probe" command')];
    if (!pinned) system.push(TICKET_RULES, 'This is a TICKET button: set "probe" to null and "rules" to [].');
    const plan = await this.ask(system.join('\n\n'), `User description: ${prompt}`, validateDraftPlan);

    params.onStage?.('command');
    const conditionalActions: ConditionalAction[] = pinned && plan.probe
      ? plan.rules.map((r) => ({ id: randomUUID(), label: r.label, when: r.when, actionType: 'shell' as const, actionValue: r.command }))
      : [];
    // The probe runs on its own every interval once saved: it is checked like the rest.
    const risky = [plan.actionValue, ...conditionalActions.map((r) => r.actionValue), ...(pinned && plan.probe ? [plan.probe] : [])].filter((c) => enforceRisk(c, undefined) === 'destructive');

    let status: ActionsAiDraftResult['draft']['status'];
    if (pinned && plan.probe) {
      params.onStage?.('probe');
      status = { command: plan.probe, intervalSec: PROBE_DEFAULT_INTERVAL_SEC };
    }

    params.onStage?.('icon');
    const icons = await this.findIcons(plan.iconKeywords.length ? plan.iconKeywords : [plan.label], plan.brand, false, plan.label).catch(() => null);

    const notes = [plan.notes, risky.length ? `Destructive command — review before saving: ${risky.join(' | ')}` : null].filter(Boolean).join(' ');
    return {
      draft: {
        label: plan.label,
        actionType: plan.actionType,
        actionValue: plan.actionValue,
        ...(status ? { status } : {}),
        ...(conditionalActions.length ? { conditionalActions } : {}),
      },
      icon: icons?.suggestions[0] ?? null,
      ...(notes ? { notes } : {}),
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

import { buildTicketWorkspaceId } from '../utils/workspace.js';
import type { Ticket } from '../types/ticket.js';
import { getPipe } from './pipes/index.js';

/**
 * Template context for workspace actions. A workspace is the ticket's folder
 * (`<basePath>/workspaces/<workspaceId>`) and exists for any ticket, so this
 * context is always computable. Git-level variables (org/repo/branch) are
 * intentionally omitted: a workspace can hold multiple repos, so those values
 * would be plural and unusable in a flat template without loops/conditionals.
 */
// A type alias rather than an interface so it carries an implicit index
// signature and stays assignable to the `Record<string, string>` the resolvers
// take.
export type WorkspaceContext = {
  workspace_path: string;
  workspace_name: string;
  ticket_id: string;
  ticket_slug: string;
  ticket_display_id: string;
};

export function buildWorkspaceContext(ticket: Ticket, basePath: string): WorkspaceContext {
  const workspaceId = buildTicketWorkspaceId(ticket.title, ticket.id);
  return {
    workspace_path: `${basePath}/workspaces/${workspaceId}`,
    workspace_name: workspaceId,
    ticket_id: ticket.id,
    ticket_slug: workspaceId.slice(7), // workspaceId is `<6-char-id>-<slug>`
    ticket_display_id: String(ticket.displayId),
  };
}

export function parsePipeExpression(expr: string): {
  variable: string;
  pipes: { name: string; args: string[] }[];
} {
  const segments = expr.split('|').map((s) => s.trim());
  const variable = segments[0]!;
  const pipes = segments.slice(1).map((segment) => {
    const match = segment.match(/^(\w+)(?:\(([^)]*)\))?$/);
    if (!match) return { name: segment, args: [] };
    const name = match[1]!;
    const args = match[2] ? match[2].split(',').map((a) => a.trim()) : [];
    return { name, args };
  });
  return { variable, pipes };
}

/** Matches a `{{ expr }}` placeholder. */
export const TEMPLATE_PLACEHOLDER_RE = /\{\{(.+?)\}\}/g;

/**
 * Lenient resolution: an unknown variable or pipe is left as-is.
 * Used client-side for `kind: 'url'`, where a stray `{{…}}` is a cosmetic bug,
 * not a security issue. Server-side execution uses `resolveTemplateStrict`.
 */
export function resolveTemplate(template: string, context: Record<string, string>): string {
  return template.replace(TEMPLATE_PLACEHOLDER_RE, (match, expr: string) => {
    const { variable, pipes } = parsePipeExpression(expr);
    if (!(variable in context)) return match;

    let value = context[variable]!;
    for (const pipe of pipes) {
      const pipeFn = getPipe(pipe.name);
      if (!pipeFn) return match;
      value = pipeFn.fn(value, ...pipe.args);
    }
    return value;
  });
}

export type StrictTemplateResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Strict resolution: an unknown variable or pipe fails instead of silently
 * leaving the literal `{{…}}` in place. On the server that literal would end up
 * in an argv element and reach the command, so a typo must be a 400, not a
 * half-resolved execution.
 */
export function resolveTemplateStrict(
  template: string,
  context: Record<string, string>,
): StrictTemplateResult {
  let failure: string | null = null;

  const value = template.replace(TEMPLATE_PLACEHOLDER_RE, (_match, expr: string) => {
    const { variable, pipes } = parsePipeExpression(expr);
    if (!(variable in context)) {
      failure ??= `Unknown template variable: ${variable}`;
      return '';
    }

    let current = context[variable]!;
    for (const pipe of pipes) {
      const pipeFn = getPipe(pipe.name);
      if (!pipeFn) {
        failure ??= `Unknown pipe: ${pipe.name}`;
        return '';
      }
      current = pipeFn.fn(current, ...pipe.args);
    }
    return current;
  });

  return failure ? { ok: false, error: failure } : { ok: true, value };
}

/** Variable names referenced by a template, ignoring pipes. */
export function templateVariables(template: string): string[] {
  const found: string[] = [];
  for (const match of template.matchAll(TEMPLATE_PLACEHOLDER_RE)) {
    const { variable } = parsePipeExpression(match[1]!);
    if (variable && !found.includes(variable)) found.push(variable);
  }
  return found;
}

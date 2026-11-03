import type { Ticket } from '@fleex/shared';
import { getPipe } from './pipes';

/**
 * Template context for workspace actions. A workspace is the ticket's folder
 * (`<basePath>/workspaces/<workspaceId>`) and exists for any ticket, so this
 * context is always computable. Git-level variables (org/repo/branch) are
 * intentionally omitted: a workspace can hold multiple repos, so those values
 * would be plural and unusable in a flat template without loops/conditionals.
 */
export interface WorkspaceContext {
  workspace_path: string;
  workspace_name: string;
  ticket_id: string;
  ticket_slug: string;
  ticket_display_id: string;
}

/**
 * `workspaceId` is the folder name resolved by the server (see
 * `useTicketWorkspaceId`), never derived from the title here: the folder keeps
 * the name it got at creation, so a renamed ticket would point elsewhere.
 */
export function buildWorkspaceContext(ticket: Ticket, basePath: string, workspaceId: string): WorkspaceContext {
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

export function resolveTemplate(template: string, context: WorkspaceContext): string {
  return template.replace(/\{\{(.+?)\}\}/g, (match, expr: string) => {
    const { variable, pipes } = parsePipeExpression(expr);

    if (!(variable in context)) {
      return match;
    }

    let value = context[variable as keyof WorkspaceContext];

    for (const pipe of pipes) {
      const pipeFn = getPipe(pipe.name);
      if (!pipeFn) return match;
      value = pipeFn.fn(value, ...pipe.args);
    }

    return value;
  });
}

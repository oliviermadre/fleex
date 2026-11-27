/**
 * `fleex` commands the companion runs itself (ticket picker, attaching an
 * artefact), with the Assistant's identity so what they write is signed
 * "Assistant" like the rest of its actions.
 */
import { execFile } from 'node:child_process';
import { agentActorEnv } from '@fleex/shared';
import { resolveFleexBin, type ExecOptions } from '@fleex/mcp';
import { ASSISTANT_ACTOR_NAME } from './agent-turn.ts';

export interface CliResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type RunCli = (argv: string[], workspace?: string) => Promise<CliResult>;

export function createRunCli(execOpts: ExecOptions = {}): RunCli {
  return (argv, workspace) => {
    const { bin, prefixArgs } = resolveFleexBin(execOpts);
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...agentActorEnv(ASSISTANT_ACTOR_NAME),
      ...(workspace ? { FLEEX_WORKSPACE: workspace } : {}),
    };
    delete env.FLEEX_ACTOR_PERSONA;
    return new Promise((resolve) => {
      execFile(bin, [...prefixArgs, ...argv], { env, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '' });
      });
    });
  };
}

export interface TicketOption {
  id: string;
  displayId: string;
  title: string;
  status: string;
}

/** Open tickets of the workspace, most recent first, for the attach picker. */
export async function listTickets(run: RunCli, workspace: string | undefined, query?: string): Promise<TicketOption[]> {
  const res = await run(['ticket', 'list', '--json', '--limit', '50'], workspace);
  if (!res.ok) throw new Error(res.stderr.trim() || 'fleex ticket list failed');
  let rows: unknown;
  try {
    rows = JSON.parse(res.stdout);
  } catch {
    throw new Error('fleex ticket list returned no JSON');
  }
  const list = (Array.isArray(rows) ? rows : Array.isArray((rows as { tickets?: unknown })?.tickets) ? (rows as { tickets: unknown[] }).tickets : []) as Array<Record<string, unknown>>;
  const tickets = list.map((t) => ({
    id: String(t.id ?? ''),
    displayId: String(t.displayId ?? t.display_id ?? t.number ?? ''),
    title: String(t.title ?? ''),
    status: String(t.status ?? ''),
  }));
  const q = query?.trim().replace(/^#/, '').toLowerCase();
  if (!q) return tickets;
  return tickets.filter((t) => t.displayId === q || t.title.toLowerCase().includes(q) || t.id.startsWith(q));
}

/** Attach a file as a final deliverable of a ticket, signed "Assistant". */
export async function attachDeliverable(
  run: RunCli,
  workspace: string | undefined,
  args: { ticketId: string; file: string; title: string; type: string },
): Promise<CliResult> {
  return run(
    ['ticket', 'deliverable', 'add', args.ticketId, '--agent-name', ASSISTANT_ACTOR_NAME, '--title', args.title, '--type', args.type, '--status', 'final', '--file', args.file],
    workspace,
  );
}

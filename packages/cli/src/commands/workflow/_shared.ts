import { die, err } from '../../core/colors.ts';
import { apiBase, apiGet } from '../../core/api.ts';
import { matchById } from '../../core/match.ts';
import { resolveTicketId } from '../ticket/_shared.ts';

export interface WorkflowRun {
  id: string;
  ticketId?: string;
  status: string;
  currentStepId?: string | null;
  triggeredBy?: string;
  triggeredFrom?: string;
  startedAt?: string;
  completedAt?: string | null;
  templateSnapshot?: { name?: string; steps?: { id: string; name?: string }[] };
}

export interface StepRun {
  id: string;
  stepId: string;
  attempt: number;
  status: string;
  result?: string | null;
}

export interface RunDetail {
  run: WorkflowRun;
  stepRuns: StepRun[];
}

/** A full UUID looks like `xxxxxxxx-xxxx-...` — matches the loose heuristic used by resolveTicketId. */
function isFullUuid(s: string): boolean {
  return s.includes('-') && s.length >= 36;
}

/**
 * Resolve a workflow-run reference (full UUID or unique 8-char prefix, with an
 * optional leading `#`) to its full UUID.
 *
 * There is no global run list — the only list endpoint is scoped to a ticket
 * (`GET /api/workflows/runs?ticketId=`). So a *prefix* can only be resolved when
 * a `--ticket` is supplied; without one, only a full UUID is accepted. Ambiguous
 * prefixes are surfaced rather than guessed, mirroring every other id resolver.
 */
export async function resolveRunId(input: string, ticket?: string): Promise<string> {
  const needle = input.trim().replace(/^#/, '');
  if (!needle) die('A run id is required.');

  if (ticket) {
    const ticketId = await resolveTicketId(ticket);
    const runs = await apiGet<WorkflowRun[]>(
      `${apiBase()}/api/workflows/runs?ticketId=${encodeURIComponent(ticketId)}`,
    );
    const result = matchById(runs, needle);
    if (result.kind === 'found') return result.item.id;
    if (result.kind === 'ambiguous') {
      err(`"${input}" matches multiple runs — use a longer prefix or the full UUID:`);
      for (const r of result.matches) {
        process.stderr.write(`  ${r.id.slice(0, 8)}  ${r.status}  ${r.templateSnapshot?.name ?? ''}\n`);
      }
      process.exit(1);
    }
    die(`No run matches "${input}" for ticket ${ticket}.`);
  }

  // No ticket scope: a short prefix can't be resolved (nothing to match against).
  if (isFullUuid(needle)) return needle;
  die(`"${input}" looks like a short id. Pass --ticket <id> to resolve a run prefix, or use the full run UUID.`);
}

/**
 * Resolve a run reference and fetch its detail (`{ run, stepRuns }`). Verifying
 * existence up front lets callers act on a confirmed run — and hands step-run
 * commands the `stepRuns` list they need to resolve a step prefix.
 */
export async function fetchRunDetail(input: string, ticket?: string): Promise<RunDetail> {
  const runId = await resolveRunId(input, ticket);
  return apiGet<RunDetail>(`${apiBase()}/api/workflows/runs/${encodeURIComponent(runId)}`);
}

/**
 * Resolve a step-run reference (full UUID or unique 8-char prefix, optional
 * leading `#`) against a run's already-fetched step runs. Synchronous because
 * the detail is loaded once by `fetchRunDetail`. Ambiguity is surfaced, never
 * guessed.
 */
export function resolveStepRunId(detail: RunDetail, input: string): string {
  const result = matchById(detail.stepRuns, input);
  if (result.kind === 'found') return result.item.id;
  if (result.kind === 'ambiguous') {
    err(`"${input}" matches multiple step runs — use a longer prefix or the full UUID:`);
    for (const s of result.matches) {
      process.stderr.write(`  ${s.id.slice(0, 8)}  ${s.status}  ${s.stepId}\n`);
    }
    process.exit(1);
  }
  die(`No step run matches "${input}" in run ${detail.run.id.slice(0, 8)}.`);
}

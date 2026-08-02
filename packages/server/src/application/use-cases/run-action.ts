import { randomUUID } from 'node:crypto';
import {
  ACTION_DEFAULT_TIMEOUT_MS,
  ACTION_OUTPUT_LIMIT_BYTES,
  ACTION_TIMEOUT_MAX_MS,
  ACTION_TIMEOUT_MIN_MS,
  resolveTemplateStrict,
  validateActionParams,
} from '@fleex/shared';
import type { ActionDef, RunActionResponse } from '@fleex/shared';
import {
  ActionAlreadyRunningError,
  ActionDisabledError,
  ActionInvalidParamsError,
  ActionMissingContextError,
  ActionNotExecutableError,
  ActionNotFoundError,
  ActionTimeoutError,
  TicketNotFoundError,
} from '../../domain/errors.js';
import type { ActionFailedEvent } from '../../domain/events.js';
import type { EventBus } from '../event-bus.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type { ExecFn } from '../../infrastructure/host/types.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import { ensureTicketWorkspace } from '../services/ensure-ticket-workspace.js';

export interface RunActionInput {
  actionId: string;
  ticketId?: string;
  params?: Record<string, unknown>;
}

/**
 * Executes an action declared in `AppConfig.actions`.
 *
 * The whole point of this use case is that the caller supplies an **id**, never
 * a command. The command comes from config; caller input only ever lands in
 * `args[]`/`cwd` placeholders, which become individual `execFile` argv elements.
 * No shell re-parses them, so a value like `; rm -rf /` is just a string.
 */
export class RunActionUseCase {
  eventBus: EventBus | null = null;

  /** Ids currently executing — see ActionAlreadyRunningError. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly config: ConfigPort,
    private readonly ticketStore: TicketStorePort,
    private readonly resolver: RepoPathResolver,
    private readonly execFn: ExecFn,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: RunActionInput): Promise<RunActionResponse> {
    const runId = randomUUID();
    const action = (this.config.get().actions ?? []).find((a) => a.id === input.actionId);

    if (!action) {
      // Deliberately NOT a domain event: an unknown id is reachable by anyone
      // holding the endpoint, so emitting here would let a single caller grow
      // `domain_event_log` without bound. A warn line is enough to notice abuse.
      this.logger.warn('Unknown action requested', { actionId: input.actionId });
      throw new ActionNotFoundError(input.actionId);
    }

    const fail = (reason: ActionFailedEvent['reason'], message: string) => {
      this.emitFailed(runId, action, reason, message, input.ticketId);
    };

    if (action.enabled === false) {
      fail('disabled', 'Action is disabled');
      throw new ActionDisabledError(action.id);
    }

    if (action.kind === 'url') {
      fail('not_executable', 'kind=url actions are opened by the client');
      throw new ActionNotExecutableError(action.id);
    }

    if (action.scope === 'workspace' && !input.ticketId) {
      fail('missing_context', 'This action requires a ticket');
      throw new ActionMissingContextError(`Action ${action.id} requires a ticketId`);
    }

    // The ticket context is derived here, from an id — the client never gets to
    // choose the path a command runs against.
    const context = await this.buildContext(input.ticketId);

    const params = validateActionParams(action.params, input.params);
    if (!params.ok) {
      const message = params.errors.map((e) => `${e.param}: ${e.reason}`).join('; ');
      fail('invalid_params', message);
      throw new ActionInvalidParamsError(`Invalid parameters: ${message}`, params.errors);
    }

    const variables = { ...context.variables, ...params.values };

    const args = this.resolveAll(action.args ?? [], variables, runId, action, input.ticketId);
    const cwd = action.cwd
      ? this.resolveAll([action.cwd], variables, runId, action, input.ticketId)[0]!
      : (context.workspacePath ?? this.config.get().basePath);

    const { command, argv } = this.buildInvocation(action, args);

    if (this.inFlight.has(action.id)) {
      fail('already_running', 'A run is already in flight for this action');
      throw new ActionAlreadyRunningError(action.id);
    }
    this.inFlight.add(action.id);

    const timeoutMs = clampTimeout(action.timeoutMs);
    const startedAt = Date.now();

    try {
      const { stdout, stderr } = await this.execFn(command, argv, { cwd, timeout: timeoutMs });
      return this.succeed(runId, action, command, argv, cwd, input.ticketId, 0, startedAt, stdout, stderr);
    } catch (err: unknown) {
      const e = err as { code?: number | string; stdout?: string; stderr?: string; message?: string };
      const durationMs = Date.now() - startedAt;

      const message = e.message ?? 'Unknown execution error';

      // Timeout is tested BEFORE the exit-code branch on purpose: the gateway
      // kills a slow command with SIGTERM and reports it as a plain non-zero
      // exit, so the code alone cannot tell "the command failed" apart from "we
      // killed it". Elapsed time can.
      if (isTimeout(message, e.code) || durationMs >= timeoutMs) {
        fail('timeout', message);
        throw new ActionTimeoutError(action.id, timeoutMs, runId);
      }

      // A non-zero exit is NOT an API failure: the invocation worked, the
      // command disagreed. `remoteExec` throws on exit != 0, so unwrap it back
      // into a 200 carrying the real exit code.
      if (typeof e.code === 'number') {
        return this.succeed(
          runId, action, command, argv, cwd, input.ticketId,
          e.code, startedAt, e.stdout ?? '', e.stderr ?? '',
        );
      }

      fail('spawn_error', message);
      throw err;
    } finally {
      this.inFlight.delete(action.id);
    }
  }

  /**
   * `kind: 'shell'` runs a script frozen in config; the resolved values are
   * appended as positional parameters (`$1`…`$n`) so they are read by the shell
   * as data, never parsed as script text.
   */
  private buildInvocation(action: ActionDef, args: string[]): { command: string; argv: string[] } {
    if (action.kind === 'shell') {
      return {
        command: this.config.get().defaultShell,
        argv: ['-l', '-c', action.script ?? '', 'fleex-action', ...args],
      };
    }
    return { command: action.command ?? '', argv: args };
  }

  private resolveAll(
    templates: string[],
    variables: Record<string, string>,
    runId: string,
    action: ActionDef,
    ticketId: string | undefined,
  ): string[] {
    return templates.map((template) => {
      const result = resolveTemplateStrict(template, variables);
      if (!result.ok) {
        // Leaving an unresolved `{{…}}` in an argv element would quietly hand
        // the literal template to the command — fail instead.
        this.emitFailed(runId, action, 'invalid_params', result.error, ticketId);
        throw new ActionInvalidParamsError(result.error);
      }
      return result.value;
    });
  }

  private async buildContext(ticketId: string | undefined): Promise<{
    variables: Record<string, string>;
    workspacePath: string | null;
  }> {
    if (!ticketId) return { variables: {}, workspacePath: null };

    const ticket = await this.ticketStore.getTicketById(ticketId);
    if (!ticket) throw new TicketNotFoundError(ticketId);

    // Materialise the folder up front — this absorbs the client's former
    // pre-flight call to /ensure-workspace, and its attendant race.
    const { workspaceId, workspacePath } = ensureTicketWorkspace(this.resolver, {
      id: ticket.id,
      title: ticket.title,
    });

    return {
      workspacePath,
      variables: {
        workspace_path: workspacePath,
        workspace_name: workspaceId,
        ticket_id: ticket.id,
        ticket_slug: workspaceId.slice(7), // workspaceId is `<6-char-id>-<slug>`
        ticket_display_id: String(ticket.displayId),
      },
    };
  }

  private succeed(
    runId: string,
    action: ActionDef,
    command: string,
    argv: string[],
    cwd: string,
    ticketId: string | undefined,
    exitCode: number,
    startedAt: number,
    rawStdout: string,
    rawStderr: string,
  ): RunActionResponse {
    const durationMs = Date.now() - startedAt;
    const stdout = truncate(rawStdout);
    const stderr = truncate(rawStderr);

    this.eventBus?.emit({
      type: 'action.executed',
      occurredAt: new Date(),
      runId,
      actionId: action.id,
      label: action.label,
      scope: action.scope,
      kind: action.kind === 'shell' ? 'shell' : 'exec',
      command,
      args: argv,
      cwd,
      ...(ticketId ? { ticketId } : {}),
      exitCode,
      durationMs,
    });

    // Ids only: the previous implementation logged the raw command string, so a
    // caller could write arbitrary text into the application log.
    this.logger.info('Action executed', {
      runId,
      actionId: action.id,
      label: action.label,
      exitCode,
      durationMs,
    });

    return {
      runId,
      actionId: action.id,
      exitCode,
      stdout: stdout.value,
      stderr: stderr.value,
      durationMs,
      truncated: stdout.truncated || stderr.truncated,
    };
  }

  private emitFailed(
    runId: string,
    action: ActionDef,
    reason: ActionFailedEvent['reason'],
    message: string,
    ticketId: string | undefined,
  ): void {
    this.eventBus?.emit({
      type: 'action.failed',
      occurredAt: new Date(),
      runId,
      actionId: action.id,
      label: action.label,
      reason,
      message,
      ...(ticketId ? { ticketId } : {}),
    });
  }
}

/**
 * The gateway surfaces a kill-on-timeout as a plain `error` string, so there is
 * no structured signal to key off — match the usual spellings, and let the
 * elapsed-time check in the caller catch the rest.
 */
function isTimeout(message: string, code: number | string | undefined): boolean {
  if (code === 'ETIMEDOUT') return true;
  return /timed?\s?out|ETIMEDOUT/i.test(message);
}

function clampTimeout(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ACTION_DEFAULT_TIMEOUT_MS;
  return Math.min(ACTION_TIMEOUT_MAX_MS, Math.max(ACTION_TIMEOUT_MIN_MS, value));
}

function truncate(value: string): { value: string; truncated: boolean } {
  if (value.length <= ACTION_OUTPUT_LIMIT_BYTES) return { value, truncated: false };
  return { value: value.slice(0, ACTION_OUTPUT_LIMIT_BYTES), truncated: true };
}

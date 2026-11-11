import type { ExecFn } from '../../infrastructure/host/types.js';
import type { LoggerPort } from '../ports/logger.port.js';
import { buildCliTools, type CliCommandDoc, type CliTool } from './fleex-cli-tools.js';

/**
 * What the assistant must know about the Fleex instance it runs inside: the
 * workspace this server serves, the CLI binary it drives, and the CLI's own
 * command reference (`fleex documentation --format json`) turned into tools.
 * Fetched once per process, retried on failure. Injected so tests never spawn
 * the CLI.
 */
/**
 * Who the assistant is for the turn being run. Given per call, never stored:
 * this environment is one per process, the assistant persona can differ from
 * one ticket to the next.
 */
export interface AssistantCliActor {
  /** Display name: what the todo history shows. */
  name: string;
  /** Persona slug: which todo items are "for you", what `me` means. */
  persona: string;
}

/**
 * The CLI invocation that runs `argv` as `actor`. The identity travels the way
 * an agent run's does — FLEEX_ACTOR_* in the CLI's environment, which it turns
 * into `x-fleex-actor-*` headers — but is set through `env(1)`, as argv: the
 * host gateway that spawns the CLI takes no environment, and assignments made
 * by `env` override whatever the spawning process inherited (a server started
 * from inside an agent run carries that agent's FLEEX_ACTOR_*). No shell: each
 * assignment is one argv element.
 */
export function cliInvocation(cliBin: string, argv: readonly string[], actor?: AssistantCliActor): { command: string; args: string[] } {
  const name = actor?.name.trim();
  if (!actor || !name) return { command: cliBin, args: [...argv] };
  return {
    command: 'env',
    args: [
      'FLEEX_ACTOR_TYPE=agent',
      `FLEEX_ACTOR_NAME=${name}`,
      // Always set, even empty: an inherited persona must not survive under another name.
      `FLEEX_ACTOR_PERSONA=${actor.persona.trim().toLowerCase()}`,
      cliBin,
      ...argv,
    ],
  };
}

export interface AssistantEnvironmentPort {
  readonly workspace: string | null;
  readonly cliBin: string;
  /** False when no Anthropic key is configured: the assistant cannot run. */
  readonly hasApiKey: boolean;
  cliTools(): Promise<CliTool[]>;
  /** `actor`: who the call is attributed to (todo history, protection of the human's items). */
  runCli(argv: string[], actor?: AssistantCliActor): Promise<{ ok: boolean; text: string }>;
}

export class AssistantEnvironment implements AssistantEnvironmentPort {
  readonly workspace: string | null;
  readonly cliBin: string;
  readonly hasApiKey: boolean;
  private tools: Promise<CliTool[]> | null = null;

  constructor(
    private readonly execFn: ExecFn,
    private readonly logger: LoggerPort,
    opts: { workspace?: string | null; cliBin: string; hasApiKey: boolean },
  ) {
    this.workspace = opts.workspace?.trim() || null;
    this.cliBin = opts.cliBin;
    this.hasApiKey = opts.hasApiKey;
  }

  cliTools(): Promise<CliTool[]> {
    if (!this.tools) {
      this.tools = this.execFn(this.cliBin, ['documentation', '--format', 'json'], { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 })
        .then((r) => {
          const parsed = JSON.parse(r.stdout) as { commands?: CliCommandDoc[] };
          return buildCliTools(parsed.commands ?? []);
        })
        .catch((err) => {
          this.logger.warn('fleex CLI tools unavailable for the assistant', {
            cliBin: this.cliBin,
            error: err instanceof Error ? err.message : String(err),
          });
          this.tools = null; // retry next turn
          return [];
        });
    }
    return this.tools;
  }

  async runCli(argv: string[], actor?: AssistantCliActor): Promise<{ ok: boolean; text: string }> {
    const { command, args } = cliInvocation(this.cliBin, argv, actor);
    try {
      const r = await this.execFn(command, args, { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
      const text = r.stdout.trim() || r.stderr.trim() || 'OK';
      return { ok: true, text: text.length > 20_000 ? `${text.slice(0, 20_000)}\n[… tronqué]` : text };
    } catch (err) {
      // A refused command exits non-zero with its reason on stderr — or, with
      // `--json`, on stdout (`{ failures: [...] }`): the model must read WHY it
      // was refused (« #3 is assigned to nas — leave it »), not « Command failed ».
      const out = (err as { stdout?: unknown; stderr?: unknown } | null) ?? {};
      const said = [out.stdout, out.stderr]
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .map((s) => s.trim());
      const message = err instanceof Error ? err.message : String(err);
      if (!said.includes(message.trim())) said.push(message);
      return { ok: false, text: said.join('\n').slice(0, 20_000) };
    }
  }
}

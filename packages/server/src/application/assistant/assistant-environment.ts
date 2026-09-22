import type { ExecFn } from '../../infrastructure/host/types.js';
import type { LoggerPort } from '../ports/logger.port.js';

/**
 * What the assistant must know about the Fleex instance it runs inside: the
 * workspace this server serves, the CLI binary it may drive through Bash, and
 * the CLI's self-describing reference (`fleex documentation`), fetched once per
 * process. Injected so tests never spawn the CLI.
 */
export interface AssistantEnvironmentPort {
  readonly workspace: string | null;
  readonly cliBin: string;
  cliDocs(): Promise<string | null>;
}

export class AssistantEnvironment implements AssistantEnvironmentPort {
  readonly workspace: string | null;
  readonly cliBin: string;
  private docs: Promise<string | null> | null = null;

  constructor(
    private readonly execFn: ExecFn,
    private readonly logger: LoggerPort,
    opts: { workspace?: string | null; cliBin: string },
  ) {
    this.workspace = opts.workspace?.trim() || null;
    this.cliBin = opts.cliBin;
  }

  cliDocs(): Promise<string | null> {
    if (!this.docs) {
      this.docs = this.execFn(this.cliBin, ['documentation', '--format', 'markdown'], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 })
        .then((r) => (r.stdout.trim().length > 0 ? r.stdout.trim() : null))
        .catch((err) => {
          this.logger.warn('fleex documentation unavailable for the assistant prompt', {
            cliBin: this.cliBin,
            error: err instanceof Error ? err.message : String(err),
          });
          // Retry on the next turn rather than caching a failure for the whole process.
          this.docs = null;
          return null;
        });
    }
    return this.docs;
  }
}

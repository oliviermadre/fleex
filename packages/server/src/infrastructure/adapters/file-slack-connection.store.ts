import type { SlackConnection, SlackConnectionStore } from '../../application/ports/slack-connection.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { ExecFn, HostFs } from '../host/types.js';

/**
 * Keeps the Slack connection in `~/.fleex/connectors/slack.json` on the host,
 * readable by its owner only — the same place-and-manner Claude Code keeps its
 * own credentials, and out of the database.
 */
export class FileSlackConnectionStore implements SlackConnectionStore {
  private cached: SlackConnection | null | undefined;

  constructor(
    private readonly hostFs: HostFs,
    private readonly execFn: ExecFn,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {}

  private get dir() {
    return `${this.homedir}/.fleex/connectors`;
  }
  private get file() {
    return `${this.dir}/slack.json`;
  }

  async get(): Promise<SlackConnection | null> {
    if (this.cached !== undefined) return this.cached;
    try {
      if (!(await this.hostFs.exists(this.file))) return (this.cached = null);
      const parsed = JSON.parse(await this.hostFs.readFile(this.file)) as Partial<SlackConnection>;
      this.cached = typeof parsed.token === 'string' && parsed.token ? (parsed as SlackConnection) : null;
    } catch (err) {
      // An unreadable file means "not connected" (imports fall back to Claude),
      // not a crash. Log only the error's KIND: a JSON SyntaxError message quotes
      // the text it choked on, which here is the token.
      this.logger.warn('Slack connection file could not be read', { kind: err instanceof Error ? err.name : 'unknown' });
      this.cached = null;
    }
    return this.cached;
  }

  async save(connection: SlackConnection): Promise<void> {
    // Lock the directory BEFORE the file exists: under a default umask the file
    // is born 0644, and it must never be reachable by another user, even briefly.
    await this.hostFs.mkdir(this.dir);
    await this.execFn('chmod', ['700', this.dir]);
    await this.hostFs.writeFile(this.file, JSON.stringify(connection, null, 2));
    await this.execFn('chmod', ['600', this.file]);
    this.cached = connection;
  }

  async clear(): Promise<void> {
    if (await this.hostFs.exists(this.file)) await this.hostFs.rm(this.file);
    this.cached = null;
  }
}

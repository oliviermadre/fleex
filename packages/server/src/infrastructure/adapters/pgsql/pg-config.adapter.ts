import { join } from 'node:path';
import { FLEEX_DIR, CONFIG_FILE } from '@fleex/shared';
import type { AppConfig, ConfigPort } from '../../../application/ports/config.port.js';
import type { PgConnection } from './connection.js';
import type { ExecFn, HostFs } from '../../host/types.js';
import { resolveClaudeCommand } from '../resolve-claude-command.js';
import { applyBasePathEnvOverride } from '../config-env.js';

export class PgConfigAdapter implements ConfigPort {
  private config: AppConfig;
  private initialized = false;
  private claudeCommand = 'claude';

  constructor(
    private readonly connection: PgConnection,
    private readonly execFn: ExecFn,
    private readonly hostFs: HostFs,
    private readonly homedir: string,
  ) {
    this.config = {
      basePath: '~/projects',
      defaultShell: process.env['SHELL'] ?? '/bin/zsh',
      repositoryRefreshIntervalMs: 0,
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.claudeCommand = await resolveClaudeCommand(this.execFn, this.hostFs, this.homedir);
    await this.loadFromDb();
    // A workspace's basePath (via env) overrides the persisted config.
    applyBasePathEnvOverride(this.config);
    this.resolveTilde();
    this.initialized = true;
  }

  get(): AppConfig {
    return { ...this.config };
  }

  getClaudeCommand(): string {
    return this.claudeCommand;
  }

  async update(partial: Partial<AppConfig>): Promise<void> {
    this.config = { ...this.config, ...partial };
    this.resolveTilde();
    await this.syncToDb();
  }

  private async loadFromDb(): Promise<void> {
    const { rows } = await this.connection.query(
      'SELECT data FROM app_config WHERE id = $1',
      ['singleton'],
    );

    if (rows.length > 0) {
      this.applyData(rows[0].data as Record<string, unknown>);
    } else {
      await this.migrateFromJson();
    }

    this.resolveTilde();
  }

  private async migrateFromJson(): Promise<void> {
    const jsonPath = join(this.homedir, FLEEX_DIR, CONFIG_FILE);
    if (!(await this.hostFs.exists(jsonPath))) return;

    try {
      const raw = await this.hostFs.readFile(jsonPath);
      const data = JSON.parse(raw) as Record<string, unknown>;
      this.applyData(data);
      await this.syncToDb();
    } catch {
      // Ignore — use defaults
    }
  }

  private applyData(data: Record<string, unknown>): void {
    if ('repositoriesBasePath' in data && !('basePath' in data)) {
      data['basePath'] = data['repositoriesBasePath'];
    }
    delete data['repositoriesBasePath'];
    delete data['claudeCommand'];
    this.config = { ...this.config, ...(data as Partial<AppConfig>) };
  }

  private resolveTilde(): void {
    if (this.config.basePath.startsWith('~')) {
      this.config.basePath = this.config.basePath.replace(/^~/, this.homedir);
    }
  }

  private async syncToDb(): Promise<void> {
    const now = new Date().toISOString();
    await this.connection.query(
      `INSERT INTO app_config (id, data, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = $3`,
      ['singleton', JSON.stringify(this.config), now],
    );
  }
}

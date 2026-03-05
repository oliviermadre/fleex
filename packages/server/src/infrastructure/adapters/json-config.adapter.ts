import { join } from 'node:path';
import { FLEEX_DIR, CONFIG_FILE } from '@fleex/shared';
import type { AppConfig, ConfigPort } from '../../application/ports/config.port.js';
import type { ExecFn, HostFs } from '../host/types.js';

export class JsonConfigAdapter implements ConfigPort {
  private config: AppConfig;
  private readonly filePath: string;
  private initialized = false;
  private claudeCommand = 'claude';

  constructor(
    private readonly execFn: ExecFn,
    private readonly hostFs: HostFs,
    private readonly homedir: string,
  ) {
    const dir = join(this.homedir, FLEEX_DIR);
    this.filePath = join(dir, CONFIG_FILE);

    this.config = {
      basePath: '~/projects',
      defaultShell: process.env['SHELL'] ?? '/bin/zsh',
      repositoryRefreshIntervalMs: 0,
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const dir = join(this.homedir, FLEEX_DIR);
    if (!(await this.hostFs.exists(dir))) {
      await this.hostFs.mkdir(dir);
    }
    this.claudeCommand = await this.resolveClaudePath();
    await this.loadFromDisk();
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
    await this.syncToDisk();
  }

  private async resolveClaudePath(): Promise<string> {
    const localBin = join(this.homedir, '.local', 'bin', 'claude');
    if (await this.hostFs.exists(localBin)) return localBin;
    try {
      const { stdout } = await this.execFn('which', ['claude']);
      return stdout.trim();
    } catch {
      return 'claude';
    }
  }

  private async loadFromDisk(): Promise<void> {
    if (!(await this.hostFs.exists(this.filePath))) {
      this.resolveTilde();
      return;
    }

    try {
      const raw = await this.hostFs.readFile(this.filePath);
      const data = JSON.parse(raw) as Record<string, unknown>;

      // Migrate old key
      if ('repositoriesBasePath' in data && !('basePath' in data)) {
        data['basePath'] = data['repositoriesBasePath'];
      }
      delete data['repositoriesBasePath'];
      // Don't load claudeCommand from disk
      delete data['claudeCommand'];

      this.config = { ...this.config, ...(data as Partial<AppConfig>) };
    } catch {
      // Use defaults
    }

    this.resolveTilde();
  }

  /** Replace leading ~ with the real homedir so callers always get an absolute path. */
  private resolveTilde(): void {
    if (this.config.basePath.startsWith('~')) {
      this.config.basePath = this.config.basePath.replace(/^~/, this.homedir);
    }
  }

  private async syncToDisk(): Promise<void> {
    await this.hostFs.writeFile(this.filePath, JSON.stringify(this.config, null, 2));
  }
}

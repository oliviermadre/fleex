import { join } from 'node:path';
import { ASM_DIR, CONFIG_FILE } from '@asm/shared';
import type { AppConfig, ConfigPort } from '../../application/ports/config.port.js';
import type { ExecFn, HostFs } from '../host/types.js';

export class JsonConfigAdapter implements ConfigPort {
  private config: AppConfig;
  private readonly filePath: string;
  private initialized = false;

  constructor(
    private readonly execFn: ExecFn,
    private readonly hostFs: HostFs,
    private readonly homedir: string,
  ) {
    const dir = join(this.homedir, ASM_DIR);
    this.filePath = join(dir, CONFIG_FILE);

    this.config = {
      repositoriesBasePath: '~/projects',
      defaultShell: process.env['SHELL'] ?? '/bin/zsh',
      claudeCommand: 'claude',
      repositoryRefreshIntervalMs: 0,
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const dir = join(this.homedir, ASM_DIR);
    if (!(await this.hostFs.exists(dir))) {
      await this.hostFs.mkdir(dir);
    }
    this.config.claudeCommand = await this.resolveClaudePath();
    await this.loadFromDisk();
    this.initialized = true;
  }

  get(): AppConfig {
    return { ...this.config };
  }

  async update(partial: Partial<AppConfig>): Promise<void> {
    this.config = { ...this.config, ...partial };
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
    if (!(await this.hostFs.exists(this.filePath))) return;

    try {
      const raw = await this.hostFs.readFile(this.filePath);
      const data = JSON.parse(raw) as Partial<AppConfig>;
      this.config = { ...this.config, ...data };
    } catch {
      // Use defaults
    }
  }

  private async syncToDisk(): Promise<void> {
    await this.hostFs.writeFile(this.filePath, JSON.stringify(this.config, null, 2));
  }
}

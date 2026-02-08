import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ASM_DIR, CONFIG_FILE } from '@asm/shared';
import type { AppConfig, ConfigPort } from '../../application/ports/config.port.js';

function resolveClaudePath(): string {
  const localBin = join(homedir(), '.local', 'bin', 'claude');
  if (existsSync(localBin)) return localBin;
  try {
    return execFileSync('which', ['claude'], { encoding: 'utf-8' }).trim();
  } catch {
    return 'claude';
  }
}

export class JsonConfigAdapter implements ConfigPort {
  private config: AppConfig;
  private readonly filePath: string;

  constructor() {
    const dir = join(homedir(), ASM_DIR);
    this.filePath = join(dir, CONFIG_FILE);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.config = {
      repositoriesBasePath: '~/projects',
      defaultShell: process.env['SHELL'] ?? '/bin/zsh',
      claudeCommand: resolveClaudePath(),
      repositoryRefreshIntervalMs: 0,
    };

    this.loadFromDisk();
  }

  get(): AppConfig {
    return { ...this.config };
  }

  update(partial: Partial<AppConfig>): void {
    this.config = { ...this.config, ...partial };
    this.syncToDisk();
  }

  private loadFromDisk(): void {
    if (!existsSync(this.filePath)) return;

    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as Partial<AppConfig>;
      this.config = { ...this.config, ...data };
    } catch {
      // Use defaults
    }
  }

  private syncToDisk(): void {
    writeFileSync(this.filePath, JSON.stringify(this.config, null, 2), 'utf-8');
  }
}

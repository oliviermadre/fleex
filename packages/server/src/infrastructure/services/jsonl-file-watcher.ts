import { EventEmitter } from 'node:events';
import { watch, type FSWatcher } from 'node:fs';

import type { LoggerPort } from '../../application/ports/logger.port.js';

const DEBOUNCE_MS = 80;

/**
 * Watches Claude JSONL project directories for file changes.
 * Emits 'change' events (debounced per directory) so the dashboard
 * can broadcast state updates near-instantly instead of waiting for polling.
 */
export class JsonlFileWatcher extends EventEmitter {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly logger: LoggerPort) {
    super();
  }

  /** Start watching a project directory (idempotent). */
  watchDirectory(projectDir: string): void {
    if (this.watchers.has(projectDir)) return;

    try {
      const watcher = watch(projectDir, (eventType, filename) => {
        if (!filename || !filename.endsWith('.jsonl')) return;
        this.debouncedEmit(projectDir);
      });

      watcher.on('error', (err) => {
        this.logger.debug('File watcher error', { projectDir, error: String(err) });
        this.unwatchDirectory(projectDir);
      });

      this.watchers.set(projectDir, watcher);
      this.logger.debug('Watching directory', { projectDir });
    } catch (err) {
      this.logger.debug('Failed to watch directory', { projectDir, error: String(err) });
    }
  }

  /** Stop watching a project directory. */
  unwatchDirectory(projectDir: string): void {
    const watcher = this.watchers.get(projectDir);
    if (watcher) {
      watcher.close();
      this.watchers.delete(projectDir);
    }

    const timer = this.debounceTimers.get(projectDir);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(projectDir);
    }
  }

  /** Returns list of currently watched directories. */
  getWatchedDirectories(): string[] {
    return [...this.watchers.keys()];
  }

  /** Close all watchers — call on shutdown. */
  closeAll(): void {
    for (const dir of [...this.watchers.keys()]) {
      this.unwatchDirectory(dir);
    }
  }

  private debouncedEmit(projectDir: string): void {
    const existing = this.debounceTimers.get(projectDir);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(projectDir);
      this.emit('change', projectDir);
    }, DEBOUNCE_MS);

    this.debounceTimers.set(projectDir, timer);
  }
}

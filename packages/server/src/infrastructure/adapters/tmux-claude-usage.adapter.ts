import type { ClaudeUsage, ClaudeUsageMetric } from '@asm/shared';
import type { ClaudeUsagePort } from '../../application/ports/claude-usage.port.js';
import type { ConfigPort } from '../../application/ports/config.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { ExecFn } from '../host/types.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TmuxClaudeUsageAdapter implements ClaudeUsagePort {
  constructor(
    private readonly execFn: ExecFn,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
  ) {}

  async fetch(): Promise<ClaudeUsage> {
    const sessionName = `asm_usage_${Date.now()}`;
    const claudeCmd = this.config.getClaudeCommand();

    try {
      // Create a temporary tmux session running claude with hooks disabled
      // to avoid triggering notification sounds during usage scraping
      const claudeWithSettings = `${claudeCmd} --settings '{"disableAllHooks": true}'`;
      await this.execFn('tmux', [
        'new-session', '-d',
        '-s', sessionName,
        '-x', '120',
        '-y', '40',
        claudeWithSettings,
      ]);

      // Wait for Claude TUI to boot
      await delay(8000);

      // Type /usage (triggers autocomplete)
      await this.execFn('tmux', ['send-keys', '-t', sessionName, '/usage']);

      // Wait for autocomplete dropdown
      await delay(3000);

      // Press Enter to select /usage
      await this.execFn('tmux', ['send-keys', '-t', sessionName, 'Enter']);

      // Wait for usage modal to render
      await delay(12000);

      // Capture pane output
      const { stdout } = await this.execFn('tmux', [
        'capture-pane', '-t', sessionName, '-p',
      ]);

      if (!stdout.trim()) {
        throw new Error('No output captured from claude');
      }

      return this.parse(stdout);
    } finally {
      // Always clean up
      try {
        await this.execFn('tmux', ['kill-session', '-t', sessionName]);
      } catch {
        this.logger.warn('Failed to kill usage tmux session', { sessionName });
      }
    }
  }

  private parse(raw: string): ClaudeUsage {
    const metrics: Array<{ key: string; metric: ClaudeUsageMetric }> = [];

    // Match: label line, progress bar line with percentage, reset line
    const regex = /(Current\s+(?:session|week\s*\([^)]*\)))\s*\n\s*[^\n]*?(\d+)%\s+used\s*\n\s*(Resets?\s+[^\n]+)/gi;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(raw)) !== null) {
      const label = match[1]!.replace(/\s+/g, ' ').trim();
      const percentage = parseInt(match[2]!, 10);
      const reset = match[3]!.replace(/\s+/g, ' ').trim();

      let key: string;
      if (/session/i.test(label)) {
        key = 'session';
      } else if (/all\s*models/i.test(label)) {
        key = 'weeklyAllModels';
      } else if (/sonnet/i.test(label)) {
        key = 'weeklySonnet';
      } else {
        key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      }

      metrics.push({ key, metric: { label, percentage, reset } });
    }

    if (metrics.length === 0) {
      this.logger.warn('No usage metrics found in captured output', { raw: raw.substring(0, 500) });
      throw new Error('Could not parse usage metrics');
    }

    const result: Partial<ClaudeUsage> = { fetchedAt: new Date().toISOString() };
    for (const { key, metric } of metrics) {
      (result as Record<string, unknown>)[key] = metric;
    }

    return result as ClaudeUsage;
  }
}

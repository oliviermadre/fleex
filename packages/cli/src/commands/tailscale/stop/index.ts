import type { Command } from 'commander';
import type { CommandDef } from '../../../core/types.ts';
import { c, present, die, warn } from '../../../core/colors.ts';
import {
  DEFAULT_HTTP_PORT,
  DEFAULT_HTTPS_PORT,
  hasTailscale,
  runTailscale,
} from '../_shared.ts';

interface StopOptions {
  httpsPort?: string;
  httpPort?: string;
  https?: boolean;
  http?: boolean;
  reset?: boolean;
}

interface StopResult {
  scheme: 'https' | 'http';
  port: number;
  ok: boolean;
  detail?: string;
}

const def: CommandDef = {
  name: 'stop',
  aliases: ['down', 'off'],
  description: 'Stop exposing on tailscale (turn serve off for the managed ports)',
  setup(cmd: Command) {
    cmd.option('--https-port <port>', 'HTTPS port to turn off', String(DEFAULT_HTTPS_PORT));
    cmd.option('--http-port <port>', 'HTTP port to turn off', String(DEFAULT_HTTP_PORT));
    cmd.option('--no-https', 'Leave the HTTPS port untouched');
    cmd.option('--no-http', 'Leave the HTTP port untouched');
    cmd.option('--reset', 'Clear the ENTIRE tailscale serve config (all ports, not just Fleex)');
  },
  async action(opts: StopOptions) {
    if (!hasTailscale()) {
      die('tailscale CLI not found in PATH — nothing to stop.');
    }

    // --reset wipes everything tailscale serve manages, Fleex or not.
    if (opts.reset) {
      const r = runTailscale(['serve', 'reset']);
      if (!r.ok) die(`tailscale serve reset failed: ${(r.stderr || r.stdout || `exit ${r.code}`).trim()}`);
      present({ ok: true, reset: true }, () => {
        process.stdout.write(`\n  ${c.green('Cleared the entire tailscale serve config.')}\n\n`);
      });
      return;
    }

    const httpsPort = opts.https === false ? null : Number(opts.httpsPort ?? DEFAULT_HTTPS_PORT);
    const httpPort = opts.http === false ? null : Number(opts.httpPort ?? DEFAULT_HTTP_PORT);
    if (httpsPort === null && httpPort === null) {
      die('Nothing to stop: both --no-https and --no-http were given.');
    }

    const plan: Array<{ scheme: 'https' | 'http'; port: number }> = [];
    if (httpsPort !== null) plan.push({ scheme: 'https', port: httpsPort });
    if (httpPort !== null) plan.push({ scheme: 'http', port: httpPort });

    const results: StopResult[] = [];
    for (const { scheme, port } of plan) {
      const r = runTailscale(['serve', `--${scheme}=${port}`, 'off']);
      results.push({
        scheme,
        port,
        ok: r.ok,
        detail: r.ok ? undefined : (r.stderr || r.stdout || `exit ${r.code}`).trim(),
      });
      // `off` on a port that isn't served is harmless; surface it as a note.
      if (!r.ok) warn(`could not turn off ${scheme} ${port}: ${results[results.length - 1]!.detail}`);
    }

    present({ ok: results.every((r) => r.ok), results }, () => {
      process.stdout.write(`\n  ${c.bold('tailscale serve — stopped')}\n\n`);
      for (const r of results) {
        const mark = r.ok ? c.green('✓') : c.red('✗');
        process.stdout.write(`    ${mark} ${r.scheme} ${r.port}${r.ok ? '' : c.dim(` — ${r.detail}`)}\n`);
      }
      process.stdout.write('\n');
    });
  },
};

export default def;

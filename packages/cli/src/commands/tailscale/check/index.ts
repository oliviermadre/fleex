import type { Command } from 'commander';
import type { CommandDef } from '../../../core/types.ts';
import { c, present } from '../../../core/colors.ts';
import {
  DEFAULT_HTTP_PORT,
  DEFAULT_HTTPS_PORT,
  preflight,
  renderCheckItems,
  resolveTarget,
} from '../_shared.ts';

interface CheckOptions {
  instance?: string;
  httpsPort?: string;
  httpPort?: string;
  https?: boolean;
  http?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'check',
  description: 'Verify that exposing an instance on tailscale is possible (no changes)',
  setup(cmd: Command) {
    cmd.argument('[instance]', 'Instance slug to check (defaults to the resolved instance, e.g. default@main)');
    cmd.option('--https-port <port>', 'HTTPS port to check', String(DEFAULT_HTTPS_PORT));
    cmd.option('--http-port <port>', 'HTTP port to check', String(DEFAULT_HTTP_PORT));
    cmd.option('--no-https', 'Do not check the HTTPS port');
    cmd.option('--no-http', 'Do not check the HTTP port');
  },
  async action(instance: string | undefined, opts: CheckOptions) {
    const target = resolveTarget(instance ?? opts.instance);
    const httpsPort = opts.https === false ? null : Number(opts.httpsPort ?? DEFAULT_HTTPS_PORT);
    const httpPort = opts.http === false ? null : Number(opts.httpPort ?? DEFAULT_HTTP_PORT);

    const report = await preflight(target, httpsPort, httpPort);
    const warnings = report.items.filter((i) => !i.ok && i.warn).length;
    const failures = report.items.filter((i) => !i.ok && !i.warn).length;

    present(
      {
        ok: !report.blocked,
        instance: target.slug,
        webPort: target.webPort,
        backend: {
          installed: report.backend.installed,
          state: report.backend.state,
          running: report.backend.running,
          dnsName: report.backend.dnsName,
        },
        checks: report.items,
        blocked: report.blocked,
      },
      () => {
        process.stdout.write(`\n  ${c.bold('tailscale serve — preflight')} ${c.dim(`(${target.slug})`)}\n\n`);
        renderCheckItems(report.items);
        process.stdout.write('\n');
        if (report.blocked) {
          process.stdout.write(`  ${c.red(`Serving is not possible yet (${failures} blocker(s)).`)}\n\n`);
        } else if (warnings > 0) {
          process.stdout.write(`  ${c.yellow(`Serving is possible, with ${warnings} warning(s).`)}\n\n`);
        } else {
          process.stdout.write(`  ${c.green('Serving is possible.')}\n\n`);
        }
      },
    );

    if (report.blocked) process.exit(1);
  },
};

export default def;

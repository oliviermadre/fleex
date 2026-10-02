import type { Command } from 'commander';
import type { CommandDef } from '../../../core/types.ts';
import { c, present, die } from '../../../core/colors.ts';
import {
  DEFAULT_HTTP_PORT,
  DEFAULT_HTTPS_PORT,
  preflight,
  renderCheckItems,
  resolveTarget,
  runTailscale,
  serveUrl,
} from '../_shared.ts';

interface ServeOptions {
  instance?: string;
  httpsPort?: string;
  httpPort?: string;
  https?: boolean;
  http?: boolean;
  force?: boolean;
}

interface Served {
  scheme: 'https' | 'http';
  port: number;
  url: string | null;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'serve',
  aliases: ['start', 'up'],
  description: 'Expose a Fleex instance on tailscale (HTTPS 443 and HTTP 80 by default)',
  setup(cmd: Command) {
    cmd.argument('[instance]', 'Instance slug to expose (defaults to the resolved instance, e.g. default@main)');
    cmd.option('--https-port <port>', 'HTTPS port to serve on', String(DEFAULT_HTTPS_PORT));
    cmd.option('--http-port <port>', 'HTTP port to serve on', String(DEFAULT_HTTP_PORT));
    cmd.option('--no-https', 'Do not expose HTTPS');
    cmd.option('--no-http', 'Do not expose HTTP');
    cmd.option('--force', 'Serve even if the preflight reports blockers');
  },
  async action(instance: string | undefined, opts: ServeOptions) {
    const target = resolveTarget(instance ?? opts.instance);
    const httpsPort = opts.https === false ? null : Number(opts.httpsPort ?? DEFAULT_HTTPS_PORT);
    const httpPort = opts.http === false ? null : Number(opts.httpPort ?? DEFAULT_HTTP_PORT);

    if (httpsPort === null && httpPort === null) {
      die('Nothing to serve: both --no-https and --no-http were given.');
    }

    // ── Preflight ──
    const report = await preflight(target, httpsPort, httpPort);
    if (report.blocked && !opts.force) {
      present(
        { ok: false, error: 'preflight failed', instance: target.slug, checks: report.items },
        () => {
          process.stdout.write(`\n  ${c.bold('tailscale serve — preflight')} ${c.dim(`(${target.slug})`)}\n\n`);
          renderCheckItems(report.items);
          process.stdout.write(
            `\n  ${c.red('Refusing to serve.')} Fix the blockers above, or re-run with ${c.cyan('--force')}.\n\n`,
          );
        },
      );
      process.exit(1);
    }

    // ── Apply serve config (one invocation per port) ──
    const served: Served[] = [];
    const plan: Array<{ scheme: 'https' | 'http'; port: number }> = [];
    if (httpsPort !== null) plan.push({ scheme: 'https', port: httpsPort });
    if (httpPort !== null) plan.push({ scheme: 'http', port: httpPort });

    for (const { scheme, port } of plan) {
      const r = runTailscale(['serve', '--bg', `--${scheme}=${port}`, target.proxyTarget]);
      if (!r.ok) {
        const detail = (r.stderr || r.stdout || `exit ${r.code}`).trim();
        die(`tailscale serve failed for ${scheme} ${port}: ${detail}`);
      }
      served.push({ scheme, port, url: serveUrl(report.backend, scheme, port) });
    }

    present(
      { ok: true, instance: target.slug, webPort: target.webPort, proxyTarget: target.proxyTarget, served },
      () => {
        process.stdout.write(
          `\n  ${c.green('Exposed')} ${c.bold(target.slug)} ${c.dim(`(→ ${target.proxyTarget})`)} on tailscale:\n\n`,
        );
        for (const s of served) {
          const url = s.url ?? `${s.scheme}://<your-node> :${s.port}`;
          process.stdout.write(`    ${c.cyan(url)}  ${c.dim(`${s.scheme} ${s.port}`)}\n`);
        }
        process.stdout.write(`\n  ${c.dim('Stop with: fleex tailscale stop')}\n\n`);
      },
    );
  },
};

export default def;

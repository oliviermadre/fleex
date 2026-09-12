import type { Command } from 'commander';
import type { CommandDef } from '../../../core/types.ts';
import { c, present } from '../../../core/colors.ts';
import {
  serveMappings,
  tailscaleBackend,
  tryResolveTarget,
} from '../_shared.ts';

interface StatusOptions {
  instance?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'status',
  description: 'Show what is currently exposed on tailscale (and whether an instance is)',
  setup(cmd: Command) {
    cmd.argument('[instance]', 'Instance slug to report on (defaults to the resolved instance, e.g. default@main)');
  },
  async action(instance: string | undefined, opts: StatusOptions) {
    const backend = tailscaleBackend();
    const mappings = backend.running ? serveMappings() : [];
    const target = tryResolveTarget(instance ?? opts.instance);

    // Which serve mappings point at this instance's web port?
    const exposed = target
      ? mappings.filter((m) => m.target === target.proxyTarget)
      : [];

    present(
      {
        backend: {
          installed: backend.installed,
          state: backend.state,
          running: backend.running,
          dnsName: backend.dnsName,
          tailnet: backend.tailnet,
        },
        instance: target?.slug ?? null,
        webPort: target?.webPort ?? null,
        exposed: exposed.length > 0,
        serve: mappings,
      },
      () => {
        process.stdout.write(`\n  ${c.bold('tailscale exposure')}\n\n`);

        if (!backend.installed) {
          process.stdout.write(`  ${c.red('tailscale CLI not installed.')}\n\n`);
          return;
        }
        const stateLabel = backend.running ? c.green(backend.state) : c.yellow(backend.state);
        process.stdout.write(`  Backend : ${stateLabel}\n`);
        if (backend.dnsName) process.stdout.write(`  Node    : ${c.cyan(backend.dnsName)}\n`);
        if (backend.tailnet) process.stdout.write(`  Tailnet : ${backend.tailnet}\n`);
        process.stdout.write('\n');

        if (target) {
          const label = exposed.length > 0 ? c.green('EXPOSED') : c.dim('not exposed');
          process.stdout.write(
            `  Instance ${c.bold(target.slug)} ${c.dim(`(localhost:${target.webPort})`)}: ${label}\n\n`,
          );
        } else {
          process.stdout.write(`  ${c.dim('No target instance resolved (not running?).')}\n\n`);
        }

        if (mappings.length === 0) {
          process.stdout.write(`  ${c.dim('Nothing is served on tailscale right now.')}\n\n`);
          return;
        }

        process.stdout.write(`  ${c.cyan('Current serve config:')}\n`);
        for (const m of mappings) {
          const mine = target && m.target === target.proxyTarget ? c.green(' ← this instance') : '';
          process.stdout.write(
            `    ${m.scheme.padEnd(5)} ${String(m.port).padEnd(5)} → ${m.target ?? '?'}${mine}\n`,
          );
        }
        process.stdout.write('\n');
      },
    );
  },
};

export default def;

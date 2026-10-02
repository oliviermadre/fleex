import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'tailscale',
  aliases: ['ts'],
  description: 'Expose a running Fleex instance on your tailnet (HTTPS 443 / HTTP 80)',
  isParent: true,
  extraHelp: `\n${SECTION('About:')}
  Wraps ${DIM('tailscale serve')} so a running Fleex instance is reachable from your
  tailnet on standard ports. It resolves the instance's web port for you, checks
  that serving is possible first, and shows what is currently exposed.

  Replaces the manual flow:
    ${DIM('$')} fleex start --workspace default --desktop
    ${DIM('$')} fleex status                       ${DIM('# read the web port')}
    ${DIM('$')} tailscale serve --bg --https=443 http://localhost:<webport>

${SECTION('Subcommands:')}
  ${DIM('$')} fleex tailscale check                ${DIM('# is serving possible? (no changes)')}
  ${DIM('$')} fleex tailscale serve                ${DIM('# expose default@main on 443 + 80')}
  ${DIM('$')} fleex tailscale status               ${DIM('# what is exposed right now')}
  ${DIM('$')} fleex tailscale stop                 ${DIM('# stop exposing (turn serve off)')}

${SECTION('Choosing the instance:')}
  Defaults to the workspace-resolved instance (typically ${DIM('default@main')}).
  Target another with a slug argument or ${DIM('--workspace')}:
  ${DIM('$')} fleex tailscale serve default@main
  ${DIM('$')} fleex tailscale serve --workspace staging
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;

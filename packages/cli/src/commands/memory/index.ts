import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'memory',
  aliases: ['mem'],
  description: 'Query this workspace\'s memory — semantic search over tickets, discussions, deliverables and notes',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex memory search "session expiry"        ${DIM('# ranked excerpts, offline, no LLM')}
  ${DIM('$')} fleex memory search "ERR_CONN_RESET" --kind deliverable
  ${DIM('$')} fleex memory ask "why did we choose sessions over JWT?"
  ${DIM('$')} fleex memory status                         ${DIM('# what the index holds')}
  ${DIM('$')} fleex memory reindex                        ${DIM('# walk the corpus again (safe to re-run)')}

${SECTION('Notes:')}
  ${DIM('search')} is purely algorithmic — it costs nothing and needs no network.
  ${DIM('ask')} adds one LLM call to synthesise an answer with citations.
  Both need the semantic engine on (Settings › Memory).
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;

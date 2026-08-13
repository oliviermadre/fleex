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
  ${DIM('$')} fleex memory compile "the auth module"      ${DIM('# a sourced reference document')}
  ${DIM('$')} fleex memory coach Builder --sources        ${DIM('# what this agent should have learned')}
  ${DIM('$')} fleex memory keep <executionId> -m "why"    ${DIM('# keep a moment of a run')}
  ${DIM('$')} fleex memory forget <noteId>                ${DIM('# and undo it')}
  ${DIM('$')} fleex memory suggest                        ${DIM('# work you keep repeating by hand')}
  ${DIM('$')} fleex memory similar "login times out"      ${DIM('# is this ticket already filed?')}
  ${DIM('$')} fleex memory links owner/app                ${DIM('# what links to a note, what resembles it')}
  ${DIM('$')} fleex memory engine                         ${DIM('# which engine is active, which features are on')}
  ${DIM('$')} fleex memory engine semantic                ${DIM('# opt into the beta')}
  ${DIM('$')} fleex memory engine --disable ask curation
  ${DIM('$')} fleex memory status                         ${DIM('# what the index holds')}
  ${DIM('$')} fleex memory reindex                        ${DIM('# walk the corpus again (safe to re-run)')}
  ${DIM('$')} fleex memory bench                          ${DIM('# how well retrieval finds things here')}

${SECTION('Notes:')}
  ${DIM('search')}, ${DIM('similar')}, ${DIM('links')}, ${DIM('suggest')} and ${DIM('bench')} are local and free — no network, no model.
  ${DIM('ask')}, ${DIM('compile')} and ${DIM('coach')} each spend one LLM call.
  All of them need the semantic engine on (Settings › Memory).
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;

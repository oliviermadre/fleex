import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';
import { c, die, ok } from '../../core/colors.ts';
import { apiBase, apiPost } from '../../core/api.ts';
import { resolveTicketId } from '../ticket/_shared.ts';
import {
  type AgenticType,
  type HandleCatalog,
  handle,
  loadHandleCatalog,
  suggest,
} from '../../core/agentic.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;
const GREEN = chalk.green;

interface TriggerOptions {
  agent?: string[];
  skill?: string[];
  panel?: string[];
  workflow?: string[];
  message?: string;
  board?: string;
}

function collect(val: string, prev: string[] = []): string[] {
  return [...prev, val];
}

const TYPES: AgenticType[] = ['agent', 'skill', 'panel', 'workflow'];

/** Parse a raw `@type:name` token. Returns null if it isn't a valid token. */
function parseToken(token: string): { type: AgenticType; name: string } | null {
  const m = token.match(/^@(agent|skill|panel|workflow):([a-zA-Z0-9_-]+)$/);
  if (!m) return null;
  return { type: m[1] as AgenticType, name: m[2]! };
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'trigger',
  description: 'Trigger an agentic action on a ticket (agent / skill / panel / workflow) via a mention',
  setup(cmd) {
    cmd.argument('<ticket>', 'Ticket display ID or UUID');
    cmd.argument('[mentions...]', 'Raw @type:name tokens (e.g. @agent:builder @skill:ship)');
    cmd.option('--agent <name>', 'Mention an agent (repeatable)', collect);
    cmd.option('--skill <name>', 'Run a skill (repeatable)', collect);
    cmd.option('--panel <name>', 'Run a panel (repeatable)', collect);
    cmd.option('--workflow <slug>', 'Start a workflow (repeatable)', collect);
    cmd.option('-m, --message <text>', 'Extra context added to the triggering comment');
    cmd.option('--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)');
  },
  extraHelp: `\n${SECTION('How it works:')}
  ${DIM('trigger posts a comment containing the @type:name token(s); the server')}
  ${DIM('parses them and runs the matching primitive — same path as the web UI.')}

${SECTION('Examples:')}
  ${DIM('$')} fleex trigger 42 --agent builder -m "implement phase 1"
  ${DIM('$')} fleex trigger 42 --skill security-review
  ${DIM('$')} fleex trigger 42 --workflow spec-dev-pr
  ${DIM('$')} fleex trigger 42 ${GREEN('@agent:catalyst @agent:builder')} -m "spec then build"

${SECTION('Discover handles:')}  fleex agent|skill|panel|workflow list
`,
  action: async (ticketArg: string, mentions: string[], opts: TriggerOptions) => {
    // Gather tokens from typed flags…
    const tokens: { type: AgenticType; name: string }[] = [];
    for (const type of TYPES) {
      for (const name of opts[type] ?? []) tokens.push({ type, name });
    }
    // …and from raw positional @type:name tokens.
    for (const raw of mentions ?? []) {
      const parsed = parseToken(raw);
      if (!parsed) {
        die(`Invalid mention token "${raw}" (expected @agent:name | @skill:name | @panel:name | @workflow:name)`);
      }
      tokens.push(parsed);
    }

    if (tokens.length === 0) {
      die('Nothing to trigger. Pass --agent/--skill/--panel/--workflow or a raw @type:name token.');
    }

    // Validate handles against the live catalog (fail loud on typos).
    const catalog: HandleCatalog = await loadHandleCatalog();
    for (const t of tokens) {
      const valid = catalog[t.type];
      if (!valid.includes(t.name)) {
        const hint = suggest(t.name, valid);
        const suffix = hint ? ` Did you mean ${c.green(hint)}?` : ` Run \`fleex ${t.type} list\` to see valid names.`;
        die(`Unknown ${t.type} "${t.name}".${suffix}`);
      }
    }

    const uuid = await resolveTicketId(ticketArg, opts.board);

    // Build the comment body: handles first, then the optional message.
    const handleTokens = tokens.map((t) => handle(t.type, t.name));
    const body = opts.message
      ? `${handleTokens.join(' ')} ${opts.message}`
      : handleTokens.join(' ');

    await apiPost(`${apiBase()}/api/tickets/${uuid}/comments`, { body });
    ok(`Comment posted on #${ticketArg} → triggered ${handleTokens.join(', ')}`);
  },
};

export default def;

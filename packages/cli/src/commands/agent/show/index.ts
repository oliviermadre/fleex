import type { CommandDef } from '../../../core/types.ts';
import { c, die, info } from '../../../core/colors.ts';
import {
  fetchPersonas,
  fetchPersonaStatuses,
  handle,
  type PersonaStatus,
  personaHandleName,
  printJson,
  resolveFromList,
} from '../../../core/agentic.ts';

interface ShowOptions { json?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  description: 'Show one agent (by name or UUID)',
  setup(cmd) {
    cmd.argument('<id|name>', 'Agent name (@agent: handle) or UUID');
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (arg: string, opts: ShowOptions) => {
    const personas = await fetchPersonas();
    const p = resolveFromList(arg, personas, personaHandleName, (x) => x.displayName);
    if (!p) die(`Agent not found: ${arg}`);

    const statuses = await fetchPersonaStatuses().catch(() => ({} as Record<string, PersonaStatus>));
    const st = statuses[p.id];
    if (opts.json) {
      printJson({ ...p, status: st ?? null });
      return;
    }
    process.stdout.write('\n');
    process.stdout.write(`  ${c.bold(p.displayName ?? p.name)}\n`);
    process.stdout.write(`  ${c.dim('handle')}    ${handle('agent', personaHandleName(p))}\n`);
    process.stdout.write(`  ${c.dim('id')}        ${p.id}\n`);
    process.stdout.write(`  ${c.dim('model')}     ${p.model ?? '-'}\n`);
    process.stdout.write(`  ${c.dim('mode')}      ${p.executionMode ?? '-'}\n`);
    if (p.humanMentionName) process.stdout.write(`  ${c.dim('human')}     @${p.humanMentionName}\n`);
    process.stdout.write(`  ${c.dim('running')}   ${st?.running ? 'yes' : 'no'}\n`);
    process.stdout.write(`  ${c.dim('pending')}   ${st?.pendingMentionCount ?? 0} mention(s)\n`);
    if (p.soulMd) {
      process.stdout.write(`\n  ${c.bold('SOUL.md')}\n`);
      process.stdout.write(p.soulMd.split('\n').map((l) => `  ${l}`).join('\n') + '\n');
    }
    process.stdout.write('\n');
    info(`Trigger with: fleex trigger <ticket> --agent ${personaHandleName(p)}`);
  },
};

export default def;

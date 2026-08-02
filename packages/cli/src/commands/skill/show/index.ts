import {
  fetchSkills,
  handle,
  printJson,
  resolveFromList,
  skillHandleName,
} from '../../../core/agentic.ts';
import { c, die, info } from '../../../core/colors.ts';

import type { CommandDef } from '../../../core/types.ts';

interface ShowOptions {
  json?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  description: 'Show one skill (by command name or UUID)',
  setup(cmd) {
    cmd.argument('<id|name>', 'Skill command name (@skill: handle) or UUID');
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (arg: string, opts: ShowOptions) => {
    const skills = await fetchSkills();
    const s = resolveFromList(arg, skills, skillHandleName, (x) => x.displayName);
    if (!s) die(`Skill not found: ${arg}`);

    if (opts.json) {
      printJson(s);
      return;
    }
    process.stdout.write('\n');
    process.stdout.write(`  ${c.bold(s.displayName ?? s.name)}\n`);
    process.stdout.write(`  ${c.dim('handle')}   ${handle('skill', skillHandleName(s))}\n`);
    process.stdout.write(`  ${c.dim('id')}       ${s.id}\n`);
    process.stdout.write(`  ${c.dim('enabled')}  ${s.enabled ? 'yes' : 'no'}\n`);
    if (s.markdownContent) {
      process.stdout.write(`\n  ${c.bold('Content')}\n`);
      process.stdout.write(
        s.markdownContent
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n') + '\n',
      );
    }
    process.stdout.write('\n');
    info(`Trigger with: fleex trigger <ticket> --skill ${skillHandleName(s)}`);
  },
};

export default def;

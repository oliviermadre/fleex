import type { CommandDef } from '../../../core/types.ts';
import { c, present } from '../../../core/colors.ts';
import { resolveSession } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  aliases: ['view'],
  description: 'Show details of one session',
  setup(cmd) {
    cmd.argument('<id>', 'Session UUID, 8-char prefix, or display name');
  },
  action: async (idArg: string) => {
    const s = await resolveSession(idArg);
    present(s, () => {
      process.stdout.write('\n');
      process.stdout.write(`  ${c.bold(`Session ${s.displayName ?? ''}`)}\n`);
      process.stdout.write('  ─────────────────────────────────────────────────────────\n');
      process.stdout.write(`  ${c.bold('Type:')}       ${s.type}\n`);
      process.stdout.write(`  ${c.bold('Status:')}     ${s.status}\n`);
      process.stdout.write(`  ${c.bold('Cwd:')}        ${s.cwd}\n`);
      process.stdout.write(`  ${c.bold('Repo:')}       ${s.repositoryOrg ?? '-'}/${s.repositoryName ?? '-'}\n`);
      process.stdout.write(`  ${c.bold('Branch:')}     ${s.worktreeBranch ?? '-'}\n`);
      process.stdout.write(`  ${c.bold('Created:')}    ${s.createdAt ?? '-'}\n`);
      process.stdout.write(`  ${c.bold('UUID:')}       ${c.dim(s.id)}\n`);
      process.stdout.write('\n');
    });
  },
};

export default def;

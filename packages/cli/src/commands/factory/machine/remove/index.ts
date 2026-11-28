import readline from 'node:readline/promises';
import type { CommandDef } from '../../../../core/types.ts';
import { c, info, ok, present } from '../../../../core/colors.ts';
import { apiDelete } from '../../../../core/api.ts';
import { enc, fx, resolveMachine } from '../../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'remove',
  access: 'destructive',
  aliases: ['rm'],
  description: 'Remove a machine from the floor (prompts unless -f is given) — its settings are lost; what stood on it is left on the floor where it stood',
  setup(cmd) {
    cmd.argument('<machine>', 'Machine name, id or id prefix');
    cmd.option('-f, --force', 'Skip confirmation');
  },
  action: async (ref: string, opts: { force?: boolean }) => {
    const m = await resolveMachine(ref);
    if (!opts.force) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ans = await rl.question(`${c.yellow('[fleex]')} Remove the ${m.kind} "${m.name}" at ${m.x},${m.y}${m.holds ? ` (it holds ${m.holds})` : ''}? [y/N] `);
      rl.close();
      if (!/^[yY]/.test(ans.trim())) { info('Cancelled.'); return; }
    }
    await apiDelete(fx(`/machines/${enc(m.id)}`));
    present({ ok: true, removed: m.id, kind: m.kind, name: m.name, leftOnTheFloor: m.holds }, () =>
      ok(`Removed the ${m.kind} "${m.name}"${m.holds ? ` — ${m.holds} left lying on the floor (fleex factory needs)` : ''}`));
  },
};

export default def;

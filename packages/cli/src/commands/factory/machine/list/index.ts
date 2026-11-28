import type { CommandDef } from '../../../../core/types.ts';
import { c, die, info, present } from '../../../../core/colors.ts';
import { renderTable, trunc } from '../../../../core/agentic.ts';
import { fetchMachines } from '../../_shared.ts';
import { MACHINE_KINDS } from '../_shared.ts';

/** What a floor is mostly made of, and what nobody lists a floor to read. */
const PLUMBING = ['belt', 'bridge', 'arm', 'label', 'area'];

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  access: 'read',
  aliases: ['ls'],
  description: 'List the machines of the floor with what each holds — stations, zones, exits, desks, intakes, teleporters; belts, arms and decor only with --kind or --all',
  setup(cmd) {
    cmd.option('--kind <kind>', `Only this kind: ${MACHINE_KINDS.join(', ')}`);
    cmd.option('--all', 'Also list belts, bridges, arms, labels and areas (a floor has hundreds)');
  },
  action: async (opts: { kind?: string; all?: boolean }) => {
    if (opts.kind !== undefined && !MACHINE_KINDS.includes(opts.kind as typeof MACHINE_KINDS[number])) die(`Invalid kind: ${opts.kind} (valid: ${MACHINE_KINDS.join(', ')})`);
    const all = await fetchMachines();
    const machines = all.filter((m) => (opts.kind ? m.kind === opts.kind : opts.all || !PLUMBING.includes(m.kind)));
    present(machines, () => {
      if (machines.length === 0) { info(all.length ? 'No such machine on the floor.' : 'Nothing is built yet.'); return; }
      renderTable(['ID', 'KIND', 'NAME', 'AT', 'SIZE', 'RUNS', 'HOLDS', 'STATE'], machines.map((m) => [
        m.id.slice(0, 8), m.kind, trunc(m.name, 26), `${m.x},${m.y}`, `${m.w}×${m.h}`,
        m.exec ? `${m.exec}${m.ref ? `: ${trunc(m.ref, 18)}` : ''}` : m.dir ?? m.source ?? '-',
        m.holds ? `${m.holds}${m.needs ? c.yellow(` (${m.needs} waiting)`) : ''}` : '-',
        m.gap ? c.yellow(`not set up (${m.gap})`) : m.off ? c.red('off') : m.pullError ? c.red('pull failed') : '-',
      ]));
      const hidden = all.length - machines.length;
      info(`${machines.length} machine(s)${hidden && !opts.kind ? c.dim(` — ${hidden} belt(s), arm(s) and decor hidden (--all)`) : ''}`);
    });
  },
};

export default def;

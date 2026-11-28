import type { CommandDef } from '../../../../core/types.ts';
import { die, ok, present } from '../../../../core/colors.ts';
import { apiPost } from '../../../../core/api.ts';
import { fx, parseInteger, type MachineDetail } from '../../_shared.ts';
import { MACHINE_KINDS, SPEC_NOTES, printMachine, specFlags, specFromFlags, type SpecOptions } from '../_shared.ts';

const STEP = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;

const def: CommandDef = {
  workspaceAware: true,
  name: 'add',
  access: 'write',
  description: 'Build a machine on the floor — a belt (or a line of them with --length), an arm, a station, a zone, an exit, an intake…; the floor refuses what cannot be built',
  setup(cmd) {
    cmd.argument('<kind>', `What to build: ${MACHINE_KINDS.join(', ')}`);
    cmd.requiredOption('--x <n>', 'Tile column of its top-left corner (counted from the left)');
    cmd.requiredOption('--y <n>', 'Tile row of its top-left corner (counted from the top)');
    specFlags(cmd);
    cmd.option('--length <n>', 'A belt: lay this many tiles in a line, along --dir, from --x,--y');
  },
  extraHelp: `\nNotes:\n${SPEC_NOTES}`,
  action: async (kind: string, opts: SpecOptions & { length?: string }) => {
    if (!MACHINE_KINDS.includes(kind as typeof MACHINE_KINDS[number])) die(`Invalid kind: ${kind} (valid: ${MACHINE_KINDS.join(', ')})`);
    const spec: Record<string, unknown> = { kind, ...specFromFlags(opts) };
    // What the page fills in when it places one: a belt or an arm faces east, a station has room for one outcome.
    if ((kind === 'belt' || kind === 'arm') && spec['dir'] === undefined) spec['dir'] = 0;
    if (kind === 'station' && spec['exec'] === undefined) die('A station needs --exec: what runs in it (agent, skill, panel, script, human_gate).');
    const length = opts.length !== undefined ? parseInteger(opts.length, '--length') : 1;
    if (length !== 1 && kind !== 'belt') die('--length lays a line of belts: it only goes with `add belt`.');
    if (length < 1 || length > 500) die('--length takes 1 to 500.');
    const [dx, dy] = STEP[spec['dir'] as number] ?? STEP[0];
    const body = length === 1 ? spec : { machines: Array.from({ length }, (_, i) => ({ ...spec, x: (spec['x'] as number) + i * dx, y: (spec['y'] as number) + i * dy })) };
    const { machines } = await apiPost<{ machines: MachineDetail[] }>(fx('/machines'), body);
    present(length === 1 ? machines[0] : { machines: machines.map(({ id, kind: k, x, y, dir }) => ({ id, kind: k, x, y, dir })) }, () => {
      if (length > 1) { ok(`Laid ${machines.length} belts from ${machines[0]!.x},${machines[0]!.y} to ${machines.at(-1)!.x},${machines.at(-1)!.y}`); return; }
      ok(`Built: ${kind}`);
      printMachine(machines[0]!);
    });
  },
};

export default def;

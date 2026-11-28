import fs from 'node:fs';
import readline from 'node:readline/promises';
import type { CommandDef } from '../../../../core/types.ts';
import { c, die, info, ok, present } from '../../../../core/colors.ts';
import { apiGet, apiPut } from '../../../../core/api.ts';
import { fx } from '../../_shared.ts';

interface Overview { machines: Record<string, number>; tickets: number; items: number; needsByKind: Record<string, number> }

/** The machines of a floor file, of a bare layout, or of `{ layout }` as the API gives it. */
export function machinesOf(text: string): unknown[] {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch (e) { die(`Not JSON: ${e instanceof Error ? e.message : String(e)}`); }
  const root = doc as { layout?: { machines?: unknown }; machines?: unknown } | null;
  const machines = root?.layout?.machines ?? root?.machines;
  if (!Array.isArray(machines)) die('Not a floor: expected a file from `fleex factory layout export` (or a layout with a "machines" array).');
  return machines;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'import',
  access: 'destructive',
  description: 'Replace the whole floor with the machines of a file (prompts unless -f is given) — machines not in the file are removed, their tickets left lying on the floor',
  setup(cmd) {
    cmd.argument('[file]', 'A floor file (from `layout export`, or the page\'s Export); "-" reads stdin');
    cmd.option('--layout <json>', 'The floor as JSON text instead of a file');
    cmd.option('-f, --force', 'Skip confirmation');
  },
  action: async (file: string | undefined, opts: { layout?: string; force?: boolean }) => {
    if ((file === undefined) === (opts.layout === undefined)) die('Give the floor once: a file, or --layout <json>.');
    let text = opts.layout;
    if (text === undefined) {
      try { text = fs.readFileSync(file === '-' ? 0 : file!, 'utf8'); } catch (e) { die(`Cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    const machines = machinesOf(text);
    if (!opts.force) {
      const before = await apiGet<Overview>(fx('/overview'));
      const built = Object.values(before.machines).reduce((a, b) => a + b, 0);
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ans = await rl.question(`${c.yellow('[fleex]')} Replace the floor (${built} machine(s), ${before.tickets + before.items} on it) with ${machines.length} machine(s)? [y/N] `);
      rl.close();
      if (!/^[yY]/.test(ans.trim())) { info('Cancelled.'); return; }
    }
    // The route answers with the whole floor for the page; the overview says what the import left.
    await apiPut(fx('/layout'), { layout: { w: 0, h: 0, machines } });
    const after = await apiGet<Overview>(fx('/overview'));
    const loose = after.needsByKind['floor'] ?? 0;
    present({ ok: true, machines: after.machines, lyingOnTheFloor: loose }, () =>
      ok(`Imported ${machines.length} machine(s)${loose ? ` — ${loose} ticket(s) or item(s) lie on the floor (fleex factory needs)` : ''}`));
  },
};

export default def;

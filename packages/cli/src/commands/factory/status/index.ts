import type { CommandDef } from '../../../core/types.ts';
import { c, info, present, warn } from '../../../core/colors.ts';
import { apiGet } from '../../../core/api.ts';
import { fx } from '../_shared.ts';

interface Overview {
  floor: { id: string; name: string }; halted: boolean;
  limits: { maxRunsPerHour: number; maxConcurrentRuns: number };
  runsLastHour: number; running: number; tickets: number; items: number;
  needs: number; needsByKind: Record<string, number>; machines: Record<string, number>;
  idleStations: { id: string; name: string; why: string }[]; notice: string | null;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'status',
  access: 'read',
  description: 'The floor at a glance — on or off, stopped or not, runs against its limits, how many wait for someone',
  action: async () => {
    const flag = await apiGet<{ supported: boolean; enabled: boolean }>(fx('/status'));
    if (!flag.supported || !flag.enabled) {
      present(flag, () => {
        if (!flag.supported) warn('The Factory is not available on this storage driver (SQLite and Supabase only).');
        else info('The Factory is switched off in this workspace. `fleex factory enable` switches it on.');
      });
      return;
    }
    const o = await apiGet<Overview>(fx('/overview'));
    present({ ...flag, ...o }, () => {
      const w = (label: string, value: string) => process.stdout.write(`  ${c.dim(label.padEnd(10))} ${value}\n`);
      process.stdout.write(`${c.bold('Factory')} ${o.halted ? c.red('STOPPED (emergency stop)') : c.green('running')}\n`);
      w('on it', `${o.tickets} ticket(s), ${o.items} item(s)`);
      w('runs', `${o.running}/${o.limits.maxConcurrentRuns} in flight · ${o.runsLastHour}/${o.limits.maxRunsPerHour} this hour`);
      const kinds = Object.entries(o.needsByKind).map(([k, n]) => `${n} ${k}`).join(', ');
      w('waiting', o.needs ? c.yellow(`${o.needs} for someone (${kinds})`) + c.dim('  → fleex factory needs') : 'nothing waits for anyone');
      w('built', Object.entries(o.machines).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing');
      for (const s of o.idleStations) w('idle', `${s.name} ${c.dim(`(${s.id.slice(0, 8)})`)} is ${s.why}`);
      if (o.notice) warn(o.notice);
    });
  },
};

export default def;

import type { CommandDef } from '../../core/types.ts';
import { runStatus } from './_impl.ts';

const def: CommandDef = {
  name: 'status',
  access: 'read',
  description: 'Show status of all instances (running services, ports, PIDs)',
  action: async () => runStatus(),
};

export default def;

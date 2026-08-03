import { ok, warn } from '../../../core/colors.ts';
import { stopCompanion } from '../../../core/companion.ts';

import type { CommandDef } from '../../../core/types.ts';

const def: CommandDef = {
  name: 'stop',
  description: 'Stop the side-panel companion',
  action: async () => {
    const stopped = await stopCompanion();
    if (stopped) ok('Companion stopped.');
    else warn('Companion was not running.');
  },
};

export default def;

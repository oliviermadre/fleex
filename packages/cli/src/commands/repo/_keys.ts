import { isWorktreeConfigKey } from '@fleex/shared';

/** `hooks.setup`, `server.start`, `action:lint`, `pin:npm:dev`… — a bare id means that action. */
export function toConfigKey(arg: string): string {
  return isWorktreeConfigKey(arg) ? arg : `action:${arg}`;
}

export const KEYS_HELP = `Keys: hooks.setup  hooks.teardown  hooks.timeoutSec  server.start  server.stop  server.probe
      server.url  server.clickByState  discovery.sources  ports  action:<id>  pin:<id>  hide:<id>
      (a bare id = action:<id>)`;

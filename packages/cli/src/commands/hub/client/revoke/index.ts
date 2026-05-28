import type { CommandDef } from '../../../../core/types.ts';
import { c, ok, info, warn, die } from '../../../../core/colors.ts';
import { readClientsFile, writeClientsFile, readHubState, isAlive } from '../../_state.ts';

async function runClientRevoke(name: string): Promise<void> {
  const file = readClientsFile();
  const before = file.clients.length;
  file.clients = file.clients.filter((e) => e.name !== name);
  if (file.clients.length === before) {
    die(`No authorized client named '${name}'.`);
  }
  writeClientsFile(file);

  ok(`Revoked client '${c.bold(name)}'.`);
  const hub = readHubState();
  if (hub && isAlive(hub.pid)) {
    info('Hub is running — it will pick up the change via fs.watch and close any matching socket.');
  } else {
    warn('Hub does not appear to be running. The change will take effect on the next start.');
  }
}

const def: CommandDef = {
  name: 'revoke',
  description: 'Revoke an authorized client (closes any active connection)',
  setup(cmd) {
    cmd.argument('<name>', 'Client name to revoke');
  },
  action: async (name: string) => {
    await runClientRevoke(name);
  },
};

export default def;

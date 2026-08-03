import { c, info } from '../../../../core/colors.ts';
import { readClientsFile, readHubState } from '../../_state.ts';

import type { CommandDef } from '../../../../core/types.ts';

interface HubHealth {
  servers?: Array<{
    clientName: string;
    serverId: string | null;
    pid: number | null;
    hostname: string | null;
    connectedAt: number;
  }>;
}

async function fetchHealth(port: number): Promise<HubHealth | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    return (await res.json()) as HubHealth;
  } catch {
    return null;
  }
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

async function runClientList(): Promise<void> {
  const file = readClientsFile();
  if (file.clients.length === 0) {
    info('No authorized clients yet.');
    info(`Provision one with: ${c.bold('fleex hub client add <name>')}`);
    return;
  }

  const hub = readHubState();
  const health = hub ? await fetchHealth(hub.port) : null;
  const connected = new Set((health?.servers ?? []).map((s) => s.clientName));

  process.stdout.write('\n');
  process.stdout.write(
    `  ${c.bold('NAME'.padEnd(28))} ${c.bold('CREATED'.padEnd(18))} ${c.bold('STATUS')}\n`,
  );
  for (const entry of file.clients) {
    const status = connected.has(entry.name) ? c.green('connected') : c.dim('offline');
    process.stdout.write(
      `  ${entry.name.padEnd(28)} ${relativeTime(entry.createdAt).padEnd(18)} ${status}\n`,
    );
  }
  process.stdout.write('\n');
  if (!hub) {
    info('Hub not running — connection status omitted. Start with: fleex hub start');
  } else if (!health) {
    info('Hub state file present but /health is unreachable — connection status omitted.');
  }
}

const def: CommandDef = {
  name: 'list',
  description: 'List authorized clients and their current connection status',
  action: async () => {
    await runClientList();
  },
};

export default def;

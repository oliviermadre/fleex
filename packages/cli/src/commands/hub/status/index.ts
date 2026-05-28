import type { CommandDef } from '../../../core/types.ts';
import { c, info, warn } from '../../../core/colors.ts';
import { readHubState, isAlive, clearHubState } from '../_state.ts';

interface HubHealth {
  ok: boolean;
  port?: number;
  connectedServers?: number;
  eventsForwarded?: number;
  uptimeMs?: number;
  servers?: Array<{ serverId: string; pid: number | null; hostname: string | null; connectedAt: number }>;
}

async function fetchHealth(port: number): Promise<HubHealth | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    return (await res.json()) as HubHealth;
  } catch {
    return null;
  }
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

async function runHubStatus(): Promise<void> {
  const state = readHubState();
  if (!state) {
    info('Event hub: not running.');
    info(`Start it with ${c.bold('fleex hub start')}.`);
    return;
  }

  if (!isAlive(state.pid)) {
    warn(`State file present but PID ${state.pid} is dead — cleaning up.`);
    clearHubState();
    return;
  }

  const health = await fetchHealth(state.port);
  const uptime = Date.now() - state.startedAt;

  process.stdout.write('\n');
  process.stdout.write(`  ${c.cyan('Status'.padEnd(20))} ${c.bold('running')}\n`);
  process.stdout.write(`  ${c.cyan('PID'.padEnd(20))} ${state.pid}\n`);
  process.stdout.write(`  ${c.cyan('Port'.padEnd(20))} ${state.port}\n`);
  process.stdout.write(`  ${c.cyan('URL'.padEnd(20))} ${state.url}\n`);
  process.stdout.write(`  ${c.cyan('Uptime'.padEnd(20))} ${formatDuration(uptime)}\n`);
  if (health) {
    process.stdout.write(`  ${c.cyan('Clients connected'.padEnd(20))} ${health.connectedServers ?? 0}\n`);
    process.stdout.write(`  ${c.cyan('Events forwarded'.padEnd(20))} ${health.eventsForwarded ?? 0}\n`);
    if (health.servers && health.servers.length > 0) {
      process.stdout.write('\n');
      process.stdout.write(`  ${c.bold('Connected servers:')}\n`);
      for (const s of health.servers) {
        const since = formatDuration(Date.now() - s.connectedAt);
        process.stdout.write(`    ${c.dim('•')} ${s.serverId} ${c.dim(`(pid ${s.pid ?? '?'}, ${s.hostname ?? '?'}, ${since})`)}\n`);
      }
    }
  } else {
    process.stdout.write(`  ${c.cyan('Health'.padEnd(20))} ${c.yellow('unreachable')}\n`);
  }
  process.stdout.write('\n');
  info(`Log: ${state.logFile}`);
  process.stdout.write('\n');
  process.stdout.write(`  ${c.cyan('export FLEEX_EVENT_HUB_URL=')}${state.url}\n`);
  process.stdout.write(`  ${c.cyan('export FLEEX_EVENT_HUB_TOKEN=')}${state.token}\n`);
  process.stdout.write('\n');
}

const def: CommandDef = {
  name: 'status',
  description: 'Show event hub status (port, connected clients, uptime)',
  action: async () => {
    await runHubStatus();
  },
};

export default def;

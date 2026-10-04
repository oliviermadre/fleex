import fs from 'node:fs';
import path from 'node:path';
import { c, padEndVisible, present } from '../../core/colors.ts';
import { FLEEX_HOME, resolveInstance, readInstanceMetaAt } from '../../core/instance.ts';
import { SERVICES, type Ports } from '../../core/ports.ts';
import { isAlive } from '../../core/process.ts';

export type ServiceState = 'running' | 'stopped' | 'dead';

export interface ServiceStatus {
  name: string;
  status: ServiceState;
  pid: number | null;
  url: string | null;
}

export interface InstanceStatus {
  slug: string;
  current: boolean;
  workspace: string | null;
  driver: string | null;
  services: ServiceStatus[];
}

export interface StackStatus {
  currentInstance: string;
  source: string;
  logsDir: string;
  instances: InstanceStatus[];
}

function readPorts(file: string): Partial<Ports> {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j;
  } catch {
    return {};
  }
}

function readServiceStatus(dir: string, svc: string, ports: Partial<Ports>): ServiceStatus {
  const pf = path.join(dir, `${svc}.pid`);
  let status: ServiceState = 'stopped';
  let pid: number | null = null;

  if (fs.existsSync(pf)) {
    try {
      const n = parseInt(fs.readFileSync(pf, 'utf8').trim(), 10);
      if (Number.isFinite(n) && isAlive(n)) {
        status = 'running';
        pid = n;
      } else {
        status = 'dead';
      }
    } catch {
      // leave defaults
    }
  }

  let portVal: number | undefined;
  if (svc === 'gateway') portVal = ports.gateway;
  else if (svc === 'server') portVal = ports.server;
  else if (svc === 'web') portVal = ports.web;

  return { name: svc, status, pid, url: portVal ? `http://localhost:${portVal}` : null };
}

export function collectStatus(): StackStatus {
  const ctx = resolveInstance();
  const runBase = path.join(FLEEX_HOME, '.run');
  const entries = fs.existsSync(runBase)
    ? fs.readdirSync(runBase).filter((e) => fs.statSync(path.join(runBase, e)).isDirectory())
    : [];

  const instances = entries.map((slug): InstanceStatus => {
    const dir = path.join(runBase, slug);
    const meta = readInstanceMetaAt(dir);
    const ports = readPorts(path.join(dir, 'ports.json'));
    return {
      slug,
      current: slug === ctx.instanceSlug,
      workspace: meta?.workspace ?? null,
      driver: meta?.driver ?? null,
      // bash status doesn't list desktop
      services: SERVICES.filter((svc) => svc !== 'desktop').map((svc) => readServiceStatus(dir, svc, ports)),
    };
  });

  return {
    currentInstance: ctx.instanceSlug,
    source: ctx.repoDir,
    logsDir: path.join(FLEEX_HOME, '.logs'),
    instances,
  };
}

function renderStatus(s: StackStatus): void {
  process.stdout.write('\n');
  process.stdout.write(`  ${c.bold('fleex stack status')}\n\n`);

  if (s.instances.length === 0) {
    process.stdout.write(`  ${c.dim('No instances found.')}\n\n`);
    return;
  }

  // Compute column widths.
  let maxIw = 'Instance'.length;
  let maxWs = 'Workspace'.length;
  let maxDr = 'Driver'.length;
  for (const inst of s.instances) {
    const w = inst.slug.length + (inst.current ? 2 : 0); // " *"
    if (w > maxIw) maxIw = w;
    if ((inst.workspace ?? '-').length > maxWs) maxWs = (inst.workspace ?? '-').length;
    if ((inst.driver ?? '-').length > maxDr) maxDr = (inst.driver ?? '-').length;
  }

  const writeRow = (parts: string[]) => process.stdout.write('  ' + parts.join('  ') + '\n');

  writeRow([
    c.cyan(padEndVisible('Instance', maxIw)),
    'Workspace'.padEnd(maxWs),
    'Driver'.padEnd(maxDr),
    'Service'.padEnd(10),
    'Status'.padEnd(10),
    'PID'.padEnd(8),
    'URL',
  ]);
  writeRow([
    '─'.repeat(maxIw),
    '─'.repeat(maxWs),
    '─'.repeat(maxDr),
    '─'.repeat(10),
    '─'.repeat(10),
    '─'.repeat(8),
    '─'.repeat(25),
  ]);

  const statusFns = { running: c.green, dead: c.red, stopped: c.dim } as const;

  for (const inst of s.instances) {
    inst.services.forEach((svc, i) => {
      // Instance/Workspace/Driver are per-instance: show them only on the first row.
      const first = i === 0;
      writeRow([
        padEndVisible(first ? `${inst.slug}${inst.current ? ' *' : ''}` : '', maxIw),
        (first ? inst.workspace ?? '-' : '').padEnd(maxWs),
        (first ? inst.driver ?? '-' : '').padEnd(maxDr),
        c.cyan(svc.name.padEnd(10)),
        statusFns[svc.status](svc.status.padEnd(10)),
        (svc.pid !== null ? String(svc.pid) : '-').padEnd(8),
        svc.url ?? '-',
      ]);
    });
    process.stdout.write('\n');
  }

  process.stdout.write(`  ${c.dim(`Logs: ${s.logsDir}/<instance>/`)}\n`);
  process.stdout.write(`  ${c.dim(`Current instance: ${s.currentInstance}`)}\n`);
  process.stdout.write(`  ${c.dim(`Source: ${s.source}`)}\n\n`);
}

export async function runStatus(): Promise<void> {
  const s = collectStatus();
  present(s, () => renderStatus(s));
}

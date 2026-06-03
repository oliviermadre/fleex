import fs from 'node:fs';
import path from 'node:path';
import { c, padEndVisible, visibleLength } from '../../core/colors.ts';
import { FLEEX_HOME, resolveInstance, readInstanceMetaAt, type InstanceMeta } from '../../core/instance.ts';
import { SERVICES, type Ports } from '../../core/ports.ts';
import { isAlive } from '../../core/process.ts';

function readPorts(file: string): Partial<Ports> {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j;
  } catch {
    return {};
  }
}

export async function runStatus(): Promise<void> {
  const ctx = resolveInstance();
  const runBase = path.join(FLEEX_HOME, '.run');

  process.stdout.write('\n');
  process.stdout.write(`  ${c.bold('fleex stack status')}\n\n`);

  if (!fs.existsSync(runBase) || fs.readdirSync(runBase).length === 0) {
    process.stdout.write(`  ${c.dim('No instances found.')}\n\n`);
    return;
  }

  // Compute column widths and preload per-instance metadata (workspace/driver).
  const entries = fs.readdirSync(runBase).filter((e) => fs.statSync(path.join(runBase, e)).isDirectory());
  const metaBySlug = new Map<string, InstanceMeta | null>();
  let maxIw = 'Instance'.length;
  let maxWs = 'Workspace'.length;
  let maxDr = 'Driver'.length;
  for (const slug of entries) {
    let w = slug.length;
    if (slug === ctx.instanceSlug) w += 2; // " *"
    if (w > maxIw) maxIw = w;

    const meta = readInstanceMetaAt(path.join(runBase, slug));
    metaBySlug.set(slug, meta);
    const wsLabel = meta?.workspace ?? '-';
    if (wsLabel.length > maxWs) maxWs = wsLabel.length;
    const drLabel = meta?.driver ?? '-';
    if (drLabel.length > maxDr) maxDr = drLabel.length;
  }

  // Header
  const headerInstance = padEndVisible(c.cyan('Instance'), maxIw + visibleLength(c.cyan('')) - 'Instance'.length);
  // Simpler: write with chalk, then pad. To keep visible length right, build header manually.
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
  // Reference value kept to satisfy noUnusedLocals; padEndVisible is exercised
  // by writeRow above.
  void headerInstance;

  for (const slug of entries) {
    const dir = path.join(runBase, slug);
    const portsFile = path.join(dir, 'ports.json');
    const ports = readPorts(portsFile);
    const isCurrent = slug === ctx.instanceSlug ? ' *' : '';
    const meta = metaBySlug.get(slug) ?? null;
    const wsLabel = meta?.workspace ?? '-';
    const drLabel = meta?.driver ?? '-';

    for (const svc of SERVICES) {
      if (svc === 'desktop') continue; // bash status doesn't list desktop
      const pf = path.join(dir, `${svc}.pid`);

      let statusText = 'stopped';
      let statusFn = c.dim;
      let pidLabel = '-';

      if (fs.existsSync(pf)) {
        try {
          const pid = parseInt(fs.readFileSync(pf, 'utf8').trim(), 10);
          if (Number.isFinite(pid) && isAlive(pid)) {
            statusText = 'running';
            statusFn = c.green;
            pidLabel = String(pid);
          } else {
            statusText = 'dead';
            statusFn = c.red;
          }
        } catch {
          // leave defaults
        }
      }

      let portVal: number | undefined;
      if (svc === 'gateway') portVal = ports.gateway;
      else if (svc === 'server') portVal = ports.server;
      else if (svc === 'web') portVal = ports.web;
      const portLabel = portVal ? `http://localhost:${portVal}` : '-';

      const inst = svc === 'gateway' ? `${slug}${isCurrent}` : '';
      // Workspace/Driver are per-instance: show them only on the first row.
      const wsCell = svc === 'gateway' ? wsLabel : '';
      const drCell = svc === 'gateway' ? drLabel : '';

      writeRow([
        padEndVisible(inst, maxIw),
        wsCell.padEnd(maxWs),
        drCell.padEnd(maxDr),
        c.cyan(svc.padEnd(10)),
        statusFn(statusText.padEnd(10)),
        pidLabel.padEnd(8),
        portLabel,
      ]);
    }
    process.stdout.write('\n');
  }

  process.stdout.write(`  ${c.dim(`Logs: ${FLEEX_HOME}/.logs/<instance>/`)}\n`);
  process.stdout.write(`  ${c.dim(`Current instance: ${ctx.instanceSlug}`)}\n`);
  process.stdout.write(`  ${c.dim(`Source: ${ctx.repoDir}`)}\n\n`);
}

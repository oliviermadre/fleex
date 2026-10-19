import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CommandDef } from '../../../core/types.ts';
import { die, info, ok, present } from '../../../core/colors.ts';
import { resolveInstance } from '../../../core/instance.ts';
import { SERVICES, loadPorts } from '../../../core/ports.ts';
import { isRunning } from '../../../core/process.ts';
import { apiCall } from '../../../core/api.ts';
import { runStart } from '../../start/_impl.ts';
import { stopCurrent } from '../../stop/_impl.ts';
import { SEED_STATE_FILE, assertDemoTarget, loadSeed, type SeedState } from '../_seed.ts';

interface ResetOptions { scenario?: string }

interface SeedResult {
  personas: number; boards: number; epics: number; tickets: number; comments: number;
  deliverables: number; annotations: number; workflowRuns: number;
  ticketsByKey: SeedState['ticketsByKey'];
  boardsByKey: SeedState['boardsByKey'];
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'reset',
  description: 'Recreate the demo database and replay the « Atelier Nova » seed (+ an optional scenario)',
  setup(cmd) {
    cmd.option('--scenario <name>', 'Also apply demo/scenarios/<name>.yaml');
  },
  action: async (opts: ResetOptions) => {
    const ctx = resolveInstance();
    let dbPath: string;
    let seed: ReturnType<typeof loadSeed>;
    try {
      dbPath = assertDemoTarget({ workspace: ctx.workspace, instanceSlug: ctx.instanceSlug, env: process.env, homedir: os.homedir() });
      // Read the seed before touching anything: a YAML typo must not cost the running demo.
      seed = loadSeed(ctx.repoDir, opts.scenario);
    } catch (e) {
      return die((e as Error).message);
    }

    if (SERVICES.some((svc) => isRunning(svc, ctx))) {
      info(`Stopping ${ctx.instanceSlug}…`);
      await stopCurrent();
    }
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, path.join(ctx.instanceRun, SEED_STATE_FILE)]) {
      fs.rmSync(f, { force: true });
    }
    info(`Database recreated: ${dbPath}`);

    await runStart({ workspace: 'demo' });
    const ports = loadPorts(ctx);
    if (!ports) return die(`The demo stack did not start. Check: fleex logs server --workspace demo`);

    const now = new Date();
    let res: SeedResult;
    try {
      res = await apiCall<SeedResult>('POST', `http://localhost:${ports.server}/api/demo/seed`, { seed, now: now.toISOString() }, 60_000);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith('HTTP 404')) {
        return die('The server has no /api/demo routes: FLEEX_DEMO_MODE=1 did not reach it. Check the demo workspace env in ~/.fleex/workspaces.json.');
      }
      return die(`Seed failed: ${msg}`);
    }

    const state: SeedState = {
      seededAt: now.toISOString(),
      scenario: opts.scenario ?? null,
      ticketsByKey: res.ticketsByKey,
      boardsByKey: res.boardsByKey,
    };
    fs.mkdirSync(ctx.instanceRun, { recursive: true });
    fs.writeFileSync(path.join(ctx.instanceRun, SEED_STATE_FILE), JSON.stringify(state, null, 2) + '\n');

    present({ ...res, web: `http://localhost:${ports.web}`, server: `http://localhost:${ports.server}` }, () => {
      ok(`Demo seeded${opts.scenario ? ` (+ scenario ${opts.scenario})` : ''}: ${res.boards} boards, ${res.epics} epics, ${res.tickets} tickets, `
        + `${res.comments} comments, ${res.deliverables} deliverables, ${res.annotations} annotations, ${res.workflowRuns} workflow runs.`);
      info(`Open http://localhost:${ports.web}/?demo=1 — or shoot it: fleex shoot demo/shots/<name>.yaml --workspace demo`);
    });
  },
};

export default def;

import type { Command } from 'commander';
import { c, die } from '../../../core/colors.ts';
import { parseDir, parseInteger, parseObject, type MachineDetail } from '../_shared.ts';

export const MACHINE_KINDS = ['belt', 'arm', 'station', 'zone', 'exit', 'label', 'bridge', 'teleporter', 'area', 'desk', 'intake'] as const;
export const STATION_EXECS = ['agent', 'skill', 'panel', 'script', 'human_gate', 'native'] as const;

/** The settings most machines are built with, as flags; anything else a machine has goes through `--spec`. */
export interface SpecOptions {
  x?: string; y?: string; w?: string; h?: string; name?: string; dir?: string;
  exec?: string; ref?: string; prompt?: string; outcomes?: string; cap?: string; model?: string; mode?: string;
  spec?: string;
}

/** The flags `machine add` and `machine edit` share. */
export function specFlags(cmd: Command): void {
  cmd.option('--name <text>', 'Its name on the floor (how it is found afterwards)');
  cmd.option('--dir <direction>', 'A belt or an arm: the way it faces — east, south, west, north');
  cmd.option('--w <n>', 'Width in tiles (a zone, an exit, an area; a station takes 5, or 7)');
  cmd.option('--h <n>', 'Height in tiles (a station takes 5, or 3)');
  cmd.option('--exec <kind>', `A station: what runs in it — ${STATION_EXECS.join(', ')}`);
  cmd.option('--ref <name>', 'An agent, skill or panel station: the persona, the skill command or the panel it runs');
  cmd.option('--prompt <text>', 'A station: its instructions for each ticket');
  cmd.option('--outcomes <list>', 'A station: its ways out, comma-separated, the way forward first (ok,rework)');
  cmd.option('--cap <n>', 'A station: how many tickets it works on at once (1 to 50)');
  cmd.option('--model <id>', 'An agent or skill station: the model to run on instead of the persona\'s own');
  cmd.option('--mode <mode>', 'An agent station: talk, plan or edit');
  cmd.option('--spec <json>', 'Any other setting, as a JSON object merged over the flags; on edit a null takes a setting off (see Notes)');
}

/** The part of a spec the flags name. `--spec` comes last, so it has the final word. */
export function specFromFlags(opts: SpecOptions): Record<string, unknown> {
  if (opts.exec !== undefined && !STATION_EXECS.includes(opts.exec as typeof STATION_EXECS[number])) die(`Invalid --exec: ${opts.exec} (valid: ${STATION_EXECS.join(', ')})`);
  if (opts.mode !== undefined && !['talk', 'plan', 'edit'].includes(opts.mode)) die(`Invalid --mode: ${opts.mode} (valid: talk, plan, edit)`);
  return {
    ...(opts.x !== undefined ? { x: parseInteger(opts.x, '--x') } : {}),
    ...(opts.y !== undefined ? { y: parseInteger(opts.y, '--y') } : {}),
    ...(opts.w !== undefined ? { w: parseInteger(opts.w, '--w') } : {}),
    ...(opts.h !== undefined ? { h: parseInteger(opts.h, '--h') } : {}),
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    ...(opts.dir !== undefined ? { dir: parseDir(opts.dir) } : {}),
    ...(opts.exec !== undefined ? { exec: opts.exec } : {}),
    ...(opts.ref !== undefined ? { ref: opts.ref } : {}),
    ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),
    ...(opts.outcomes !== undefined ? { outcomes: opts.outcomes.split(',').map((o) => o.trim()).filter(Boolean) } : {}),
    ...(opts.cap !== undefined ? { cap: parseInteger(opts.cap, '--cap') } : {}),
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
    ...(opts.spec !== undefined ? parseObject(opts.spec, '--spec') : {}),
  };
}

/** What `--spec` takes, kind by kind: the layout's own fields, so the help is the reference. */
export const SPEC_NOTES = `  --spec takes the machine's settings as the layout holds them. Beyond the flags:
    belt        "fast": true · "set": [{"field":"priority","op":"set","value":"high"}] (a Set gantry)
                · "toll": {"when":[<condition>],"out":1} (rejects what any condition holds for)
    arm         "when": [<condition>] (takes a ticket when all hold) · "fast": true · "color": "#rrggbb"
                condition: {"field":"outcome|type|priority|complexity|board|favorite|tag|tagkey",
                            "op":"is|is_not|gte|lte|gt|lt|between","values":["ok"]}
    station     "off": true · "sets": "doing" (exec native) · "script": {"lines":[{"target":"workspace","value":"make test"}]}
    zone        "status": "todo" (set on entry, "" for none) · "release": "manual|auto" · "limit": 5 · "needsYou": true
    exit        "status": "cancelled" (done unless said)
    intake      "source": "slack|gmail|github|manual" · "quietSec": 120 · "query": "from:@acme.com" · "everySec": 300
                · "rules": [{"field":"channel","op":"contains|is|is_not","value":"#ops","keep":true}]
    desk        "defaults": {"boardId":"…","type":"fix","priority":"high"}
    teleporter  "role": "departure|arrival" · "to": "<arrival id>" · "color": "#rrggbb"
    label       "text": "Rework line" · area  "color": "#rrggbb", "label": "tl|tr|bl|br|above|below"
`;

/** A machine and what stands on it, as `show`, `add` and `edit` end with. */
export function printMachine(m: MachineDetail): void {
  const w = (label: string, value: string) => process.stdout.write(`  ${c.dim(label.padEnd(9))} ${value}\n`);
  process.stdout.write(`${c.bold(m.name)} ${c.dim(m.exec ? `${m.kind} · ${m.exec}` : m.kind)}\n`);
  w('id', m.id);
  w('at', `${m.x},${m.y}  ${m.w}×${m.h}${m.dir ? `  facing ${m.dir}` : ''}`);
  if (m.gap) w('setup', c.yellow(`not set up (${m.gap}): it starts nothing until it is`));
  else if (m.off) w('power', c.red('off: it takes tickets in and starts nothing'));
  if (m.pullError) w('pull', c.red(m.pullError));
  const { id: _id, kind: _kind, x: _x, y: _y, w: _w, h: _h, name: _name, prompt, ...rest } = m.spec;
  if (Object.keys(rest).length) w('settings', JSON.stringify(rest));
  if (typeof prompt === 'string' && prompt) process.stdout.write(`  ${c.dim('prompt')}\n${prompt.split('\n').map((l) => `    ${l}`).join('\n')}\n`);
  w('holds', m.tokens.length ? '' : 'nothing');
  for (const t of m.tokens) process.stdout.write(`    ${(t.kind === 'ticket' && t.displayId != null ? `#${t.displayId}` : t.id.slice(0, 8)).padEnd(9)} ${t.title}  ${c.dim(t.state)}\n`);
}

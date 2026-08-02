/**
 * Doc-quality tests for the three write commands (agent/skill/panel update).
 *
 * The primary consumer of these commands is an LLM agent reading the output
 * of `fleex documentation` — the description strings ARE the spec (§4).
 * These tests lock the wording so it cannot silently regress:
 *  - every argument and option has a non-empty description;
 *  - enum flags spell out "Allowed values:";
 *  - PATCH semantics are stated in each command description;
 *  - a snapshot of the full `describeCommand` doc (including notes) per command.
 */
import { Command, type Option, type Argument } from 'commander';
import { describe, it, expect } from 'vitest';

import agentUpdate from '../../src/commands/agent/update/index.ts';
import { describeCommand, type CommandDoc } from '../../src/commands/documentation/index.ts';
import panelUpdate from '../../src/commands/panel/update/index.ts';
import skillUpdate from '../../src/commands/skill/update/index.ts';
import { recordExtraHelp } from '../../src/core/help.ts';

import type { CommandDef } from '../../src/core/types.ts';

const CASES: Array<{ resource: string; def: CommandDef }> = [
  { resource: 'agent', def: agentUpdate },
  { resource: 'skill', def: skillUpdate },
  { resource: 'panel', def: panelUpdate },
];

/** Build the Commander command the same way program.ts attaches it. */
function buildCmd(def: CommandDef): Command {
  const cmd = new Command(def.name).description(def.description ?? '');
  def.setup?.(cmd);
  if (def.extraHelp) {
    const text = typeof def.extraHelp === 'function' ? def.extraHelp() : def.extraHelp;
    recordExtraHelp(cmd, text);
  }
  return cmd;
}

function doc(resource: string, def: CommandDef): CommandDoc {
  return describeCommand(buildCmd(def), ['fleex', resource, def.name]);
}

describe.each(CASES)('fleex $resource update — doc quality', ({ resource, def }) => {
  const d = doc(resource, def);

  it('has a non-empty command description stating PATCH semantics', () => {
    expect(d.description.length).toBeGreaterThan(0);
    expect(d.description).toContain('ONLY the fields whose flags you pass');
  });

  it('every argument has a non-empty description', () => {
    expect(d.arguments.length).toBeGreaterThan(0);
    for (const a of d.arguments) {
      expect(a.description, `argument <${a.name}> of 'fleex ${resource} update'`).not.toBe('');
    }
  });

  it('every option has a non-empty description', () => {
    expect(d.options.length).toBeGreaterThan(0);
    for (const o of d.options) {
      expect(o.description, `option ${o.flags} of 'fleex ${resource} update'`).not.toBe('');
    }
  });

  it('exports extraHelp notes (examples + stdin rule) via describeCommand', () => {
    expect(d.notes).toBeDefined();
    expect(d.notes).toContain('Examples:');
    expect(d.notes).toContain('At most ONE flag may read from stdin ("-") per invocation.');
    expect(d.notes).not.toMatch(/\x1B/); // ANSI-stripped
  });
});

describe('enum flags spell out their allowed values', () => {
  it.each([
    { resource: 'agent', def: agentUpdate },
    { resource: 'panel', def: panelUpdate },
  ])('fleex $resource update --execution-mode', ({ resource, def }) => {
    const d = doc(resource, def);
    const opt = d.options.find((o) => o.flags.includes('--execution-mode'));
    expect(opt, `--execution-mode on 'fleex ${resource} update'`).toBeDefined();
    expect(opt!.description).toContain('Allowed values: claude_code | message');
  });
});

describe('documentation JSON snapshot (normative wording)', () => {
  it.each(CASES)('fleex $resource update', ({ resource, def }) => {
    expect(doc(resource, def)).toMatchSnapshot();
  });
});

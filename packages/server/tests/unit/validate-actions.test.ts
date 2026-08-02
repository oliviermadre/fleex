import { describe, it, expect } from 'vitest';
import { validateActionDefs } from '@fleex/shared';

const validExec = {
  id: 'open-ide',
  label: 'Open IDE',
  scope: 'workspace',
  icon: '<svg/>',
  iconType: 'svg',
  kind: 'exec',
  command: '/usr/bin/open',
  args: ['-a', 'PhpStorm', '{{workspace_path}}'],
};

/** Convenience: the field paths that failed, for order-independent assertions. */
function fields(input: unknown): string[] {
  return validateActionDefs(input).map((e) => e.field);
}

describe('validateActionDefs', () => {
  it('accepts a well-formed exec action', () => {
    expect(validateActionDefs([validExec])).toEqual([]);
  });

  it('accepts an empty registry', () => {
    expect(validateActionDefs([])).toEqual([]);
  });

  it('rejects a non-array registry', () => {
    expect(validateActionDefs({ nope: true })).toEqual([
      { field: 'actions', reason: 'expected an array' },
    ]);
  });

  it('reports the index of the offending action', () => {
    const errors = validateActionDefs([validExec, { ...validExec, id: 'x', label: '' }]);
    expect(errors).toEqual([{ field: 'actions[1].label', reason: 'required, non-empty string' }]);
  });

  it('rejects duplicate ids', () => {
    // The runner resolves an action by id, so duplicates would make which one
    // runs depend on array order.
    expect(fields([validExec, validExec])).toContain('actions[1].id');
  });

  it('rejects an unknown scope or kind', () => {
    expect(fields([{ ...validExec, scope: 'universe' }])).toContain('actions[0].scope');
    expect(fields([{ ...validExec, kind: 'eval' }])).toContain('actions[0].kind');
  });

  // ——— The core guarantee ———

  it('rejects a placeholder inside command', () => {
    // This is the single shape that would splice a runtime value into the
    // executable itself instead of into an argv element.
    const errors = validateActionDefs([{ ...validExec, command: '{{workspace_path}}/run.sh' }]);
    expect(errors).toEqual([
      { field: 'actions[0].command', reason: 'must be a literal — put dynamic values in args' },
    ]);
  });

  it('rejects a placeholder inside a shell script', () => {
    const action = {
      ...validExec,
      kind: 'shell',
      command: undefined,
      script: 'echo {{workspace_path}}',
    };
    expect(fields([action])).toEqual(['actions[0].script']);
  });

  it('accepts a shell script that reads its values as positionals', () => {
    const action = {
      ...validExec,
      kind: 'shell',
      command: undefined,
      script: 'open -a "PhpStorm" "$1"',
      args: ['{{workspace_path}}'],
    };
    expect(validateActionDefs([action])).toEqual([]);
  });

  it('requires the per-kind field', () => {
    expect(fields([{ ...validExec, kind: 'url', command: undefined }])).toEqual(['actions[0].url']);
    expect(fields([{ ...validExec, command: undefined }])).toEqual(['actions[0].command']);
    expect(fields([{ ...validExec, kind: 'shell', command: undefined }])).toEqual(['actions[0].script']);
  });

  // ——— Placeholders resolve against a known vocabulary ———

  it('rejects an unknown template variable in args', () => {
    // Left unchecked this would fail at run time, after the action was saved.
    const errors = validateActionDefs([{ ...validExec, args: ['{{home_dir}}'] }]);
    expect(errors).toEqual([
      { field: 'actions[0].args[0]', reason: 'unknown template variable: home_dir' },
    ]);
  });

  it('accepts a declared param as a template variable', () => {
    const action = {
      ...validExec,
      args: ['--env', '{{env}}'],
      params: [{ name: 'env', type: 'enum', values: ['staging', 'prod'] }],
    };
    expect(validateActionDefs([action])).toEqual([]);
  });

  it('checks placeholders in cwd too', () => {
    expect(fields([{ ...validExec, cwd: '{{nope}}' }])).toEqual(['actions[0].cwd']);
    expect(validateActionDefs([{ ...validExec, cwd: '{{workspace_path}}' }])).toEqual([]);
  });

  // ——— Params ———

  it('rejects an invalid param name', () => {
    const action = { ...validExec, params: [{ name: 'Not Valid', type: 'string' }] };
    expect(fields([action])).toContain('actions[0].params[0].name');
  });

  it('rejects duplicate param names', () => {
    const action = {
      ...validExec,
      params: [{ name: 'env', type: 'string' }, { name: 'env', type: 'string' }],
    };
    expect(fields([action])).toContain('actions[0].params[1].name');
  });

  it('requires non-empty values for an enum param', () => {
    const action = { ...validExec, params: [{ name: 'env', type: 'enum' }] };
    expect(fields([action])).toContain('actions[0].params[0].values');
  });

  it('rejects a pattern that will not compile', () => {
    const action = { ...validExec, params: [{ name: 'x', type: 'string', pattern: '[' }] };
    expect(fields([action])).toContain('actions[0].params[0].pattern');
  });

  // ——— Timeout ———

  it('rejects an out-of-range timeout', () => {
    expect(fields([{ ...validExec, timeoutMs: 1 }])).toEqual(['actions[0].timeoutMs']);
    expect(fields([{ ...validExec, timeoutMs: 10_000_000 }])).toEqual(['actions[0].timeoutMs']);
    expect(validateActionDefs([{ ...validExec, timeoutMs: 30_000 }])).toEqual([]);
  });

  it('collects errors across several actions', () => {
    const errors = validateActionDefs([
      { ...validExec, command: '{{workspace_path}}' },
      { ...validExec, id: 'b', args: ['{{unknown}}'] },
    ]);
    expect(errors.map((e) => e.field)).toEqual(['actions[0].command', 'actions[1].args[0]']);
  });
});

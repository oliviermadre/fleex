import { describe, it, expect } from 'vitest';
import { bashAccess, catalogFromDocumentation } from '../src/fleex-access.ts';

const catalog = catalogFromDocumentation({
  commands: [
    { path: 'fleex ticket', subcommands: ['list'] },
    { path: 'fleex ticket list', access: 'read' },
    { path: 'fleex ticket show', access: 'read' },
    { path: 'fleex ticket comment', access: 'write' },
    { path: 'fleex ticket delete', access: 'destructive' },
  ],
});

describe('badge of a Bash line running fleex (T9)', () => {
  it('takes the strictest command of a chained line (CA17)', () => {
    expect(bashAccess('fleex ticket list | head && fleex ticket delete 12', catalog)).toBe('destructive');
  });

  it('skips global options and their value', () => {
    expect(bashAccess('fleex --workspace tada ticket show 3', catalog)).toBe('read');
    expect(bashAccess('FLEEX_WORKSPACE=qa ~/.fleex/bin/fleex ticket comment 482 "done"', catalog)).toBe('write');
  });

  it('has no badge when fleex runs from a script or a substitution', () => {
    expect(bashAccess('bun export.ts', catalog)).toBeUndefined();
    expect(bashAccess('echo $(fleex ticket delete 1)', catalog)).toBeUndefined();
    expect(bashAccess('fleex unknown thing', catalog)).toBeUndefined();
  });

  it('does not split inside quotes', () => {
    expect(bashAccess('fleex ticket comment 1 "a | fleex ticket delete 2"', catalog)).toBe('write');
  });
});

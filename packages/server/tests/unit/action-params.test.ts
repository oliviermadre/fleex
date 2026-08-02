import { describe, it, expect } from 'vitest';
import { validateActionParams, anchoredPattern } from '@fleex/shared';
import type { ActionParamDef } from '@fleex/shared';

/**
 * Params are the only caller-controlled values that reach a command line, so
 * these tests are about the contract that makes that safe: a value is accepted
 * or rejected on its *declared shape*, and whatever is accepted is handed on
 * verbatim as a single argv element.
 */
describe('validateActionParams', () => {
  it('accepts a declared string param and returns it verbatim', () => {
    const defs: ActionParamDef[] = [{ name: 'branch', type: 'string' }];
    const result = validateActionParams(defs, { branch: 'feature/x' });
    expect(result).toEqual({ ok: true, values: { branch: 'feature/x' } });
  });

  it('rejects an undeclared param instead of silently dropping it', () => {
    // Dropping it would let a caller believe an option took effect when the
    // action never declared it.
    const result = validateActionParams([{ name: 'a', type: 'string' }], { a: '1', rogue: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual({ param: 'rogue', reason: 'unknown parameter' });
  });

  it('rejects every param supplied when none are declared', () => {
    const result = validateActionParams(undefined, { anything: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([{ param: 'anything', reason: 'unknown parameter' }]);
  });

  it('reports a missing required param', () => {
    const result = validateActionParams([{ name: 'env', type: 'string', required: true }], {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([{ param: 'env', reason: 'required' }]);
  });

  it('uses the declared default when the param is omitted', () => {
    const defs: ActionParamDef[] = [{ name: 'env', type: 'string', required: true, default: 'staging' }];
    const result = validateActionParams(defs, {});
    expect(result).toEqual({ ok: true, values: { env: 'staging' } });
  });

  it('substitutes an omitted optional param with an empty string', () => {
    // An absent optional must still resolve, otherwise `{{tag}}` would fail the
    // strict template resolution and turn a valid call into a 400.
    const result = validateActionParams([{ name: 'tag', type: 'string' }], {});
    expect(result).toEqual({ ok: true, values: { tag: '' } });
  });

  it('coerces numbers and rejects non-numeric input', () => {
    const defs: ActionParamDef[] = [{ name: 'count', type: 'number' }];
    expect(validateActionParams(defs, { count: 42 })).toEqual({ ok: true, values: { count: '42' } });
    expect(validateActionParams(defs, { count: '7' })).toEqual({ ok: true, values: { count: '7' } });

    const bad = validateActionParams(defs, { count: 'seven' });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors).toEqual([{ param: 'count', reason: 'expected a number' }]);
  });

  it('coerces booleans and rejects anything else', () => {
    const defs: ActionParamDef[] = [{ name: 'force', type: 'boolean' }];
    expect(validateActionParams(defs, { force: true })).toEqual({ ok: true, values: { force: 'true' } });
    expect(validateActionParams(defs, { force: 'FALSE' })).toEqual({ ok: true, values: { force: 'false' } });

    const bad = validateActionParams(defs, { force: 'yes' });
    expect(bad.ok).toBe(false);
  });

  it('restricts an enum param to its declared values', () => {
    const defs: ActionParamDef[] = [{ name: 'env', type: 'enum', values: ['staging', 'prod'] }];
    expect(validateActionParams(defs, { env: 'prod' })).toEqual({ ok: true, values: { env: 'prod' } });

    const bad = validateActionParams(defs, { env: 'production' });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors[0]?.reason).toContain('staging, prod');
  });

  it('enforces a declared pattern over the whole value', () => {
    const defs: ActionParamDef[] = [{ name: 'branch', type: 'string', pattern: '[a-z0-9-]+' }];
    expect(validateActionParams(defs, { branch: 'my-branch' }).ok).toBe(true);
    // Would pass an unanchored `.test()` because the prefix matches.
    expect(validateActionParams(defs, { branch: 'main; rm -rf /' }).ok).toBe(false);
  });

  it('collects every error rather than stopping at the first', () => {
    const defs: ActionParamDef[] = [
      { name: 'a', type: 'number' },
      { name: 'b', type: 'string', required: true },
    ];
    const result = validateActionParams(defs, { a: 'nope', rogue: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(3);
  });

  it('passes shell metacharacters through untouched', () => {
    // These are safe because the value becomes one argv element under execFile —
    // filtering them here would be theatre and would break legitimate values
    // such as a commit message or a glob passed to a tool.
    const value = "; rm -rf / && echo $(whoami) | tee /tmp/x";
    const result = validateActionParams([{ name: 'msg', type: 'string' }], { msg: value });
    expect(result).toEqual({ ok: true, values: { msg: value } });
  });
});

describe('anchoredPattern', () => {
  it('anchors an unanchored pattern', () => {
    const re = anchoredPattern('main');
    expect(re.test('main')).toBe(true);
    expect(re.test('main; evil')).toBe(false);
  });

  it('does not double-anchor an already anchored pattern', () => {
    const re = anchoredPattern('^main$');
    expect(re.test('main')).toBe(true);
    expect(re.test('main; evil')).toBe(false);
  });

  it('keeps top-level alternation covered by the anchors', () => {
    // Naive `^` + body + `$` concatenation would yield `^a|b$`, which matches
    // "a<anything>" — the non-capturing group prevents that.
    const re = anchoredPattern('a|b');
    expect(re.test('a')).toBe(true);
    expect(re.test('b')).toBe(true);
    expect(re.test('a; evil')).toBe(false);
  });
});

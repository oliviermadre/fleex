import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

import { parseDotEnv, loadDotEnv, applyEnv } from '../../src/core/env.ts';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-env-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeEnv(name: string, content: string): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

describe('parseDotEnv', () => {
  it('returns empty object when file does not exist', () => {
    expect(parseDotEnv(path.join(tmpDir, 'nonexistent.env'))).toEqual({});
  });

  it('parses simple KEY=value pairs', () => {
    const p = writeEnv('simple.env', 'FOO=bar\nBAZ=qux');
    expect(parseDotEnv(p)).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('strips double quotes from values', () => {
    const p = writeEnv('double-quotes.env', 'DB_HOST="localhost"');
    expect(parseDotEnv(p)).toEqual({ DB_HOST: 'localhost' });
  });

  it('strips single quotes from values', () => {
    const p = writeEnv('single-quotes.env', "SECRET='s3cret'");
    expect(parseDotEnv(p)).toEqual({ SECRET: 's3cret' });
  });

  it('skips blank lines', () => {
    const p = writeEnv('blanks.env', 'A=1\n\n\nB=2');
    expect(parseDotEnv(p)).toEqual({ A: '1', B: '2' });
  });

  it('skips comments, export prefix, digit-leading keys, and bare =', () => {
    const p = writeEnv('malformed.env', '# comment\nexport FOO=bar\n3INVALID=x\nGOOD=yes\n=nope');
    expect(parseDotEnv(p)).toEqual({ GOOD: 'yes' });
  });

  it('preserves = characters inside values', () => {
    const p = writeEnv('equals.env', 'CONNECTION=postgres://user:pass@host/db?ssl=true');
    expect(parseDotEnv(p)).toEqual({ CONNECTION: 'postgres://user:pass@host/db?ssl=true' });
  });

  it('handles empty value', () => {
    const p = writeEnv('empty-val.env', 'EMPTY=');
    expect(parseDotEnv(p)).toEqual({ EMPTY: '' });
  });

  it('does not strip mismatched quotes', () => {
    const p = writeEnv('mismatch.env', 'WEIRD="value\'');
    expect(parseDotEnv(p)).toEqual({ WEIRD: '"value\'' });
  });
});

describe('loadDotEnv', () => {
  let envSnapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    envSnapshot = { ...process.env };
  });

  afterEach(() => {
    process.env = envSnapshot;
  });

  it('merges parsed vars into process.env', () => {
    delete process.env.FLEEX_TEST_NEW_VAR;
    const p = writeEnv('merge.env', 'FLEEX_TEST_NEW_VAR=hello');
    loadDotEnv(p);
    expect(process.env.FLEEX_TEST_NEW_VAR).toBe('hello');
  });

  it('does not override existing process.env vars', () => {
    process.env.FLEEX_TEST_EXISTING = 'original';
    const p = writeEnv('no-override.env', 'FLEEX_TEST_EXISTING=from_file');
    loadDotEnv(p);
    expect(process.env.FLEEX_TEST_EXISTING).toBe('original');
  });

  it('no-ops when file does not exist', () => {
    const keysBefore = Object.keys(process.env).sort();
    loadDotEnv(path.join(tmpDir, 'ghost.env'));
    const keysAfter = Object.keys(process.env).sort();
    expect(keysAfter).toEqual(keysBefore);
  });
});

describe('applyEnv', () => {
  let envSnapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    envSnapshot = { ...process.env };
  });

  afterEach(() => {
    process.env = envSnapshot;
  });

  it('sets new variables', () => {
    delete process.env.FLEEX_TEST_APPLY_NEW;
    applyEnv({ FLEEX_TEST_APPLY_NEW: 'v' });
    expect(process.env.FLEEX_TEST_APPLY_NEW).toBe('v');
  });

  it('does not override existing vars by default', () => {
    process.env.FLEEX_TEST_APPLY_EXISTING = 'original';
    applyEnv({ FLEEX_TEST_APPLY_EXISTING: 'changed' });
    expect(process.env.FLEEX_TEST_APPLY_EXISTING).toBe('original');
  });

  it('overrides existing vars when override is true', () => {
    process.env.FLEEX_TEST_APPLY_OVERRIDE = 'original';
    applyEnv({ FLEEX_TEST_APPLY_OVERRIDE: 'changed' }, { override: true });
    expect(process.env.FLEEX_TEST_APPLY_OVERRIDE).toBe('changed');
  });

  it('precedence: workspace (override) wins over shell, then .env fills the rest', () => {
    // Simulate the start command ordering: shell already set, workspace injected
    // with override, then .env loaded without override.
    delete process.env.FLEEX_TEST_ONLY_ENV;
    process.env.FLEEX_TEST_SHARED = 'shell';
    // workspace env injected with override
    applyEnv({ FLEEX_TEST_SHARED: 'workspace' }, { override: true });
    // .env loaded afterwards, non-override
    const envFile = writeEnv(
      'precedence.env',
      'FLEEX_TEST_SHARED=dotenv\nFLEEX_TEST_ONLY_ENV=fromdotenv',
    );
    loadDotEnv(envFile);
    expect(process.env.FLEEX_TEST_SHARED).toBe('workspace'); // workspace beats shell + .env
    expect(process.env.FLEEX_TEST_ONLY_ENV).toBe('fromdotenv'); // .env still fills gaps
  });
});

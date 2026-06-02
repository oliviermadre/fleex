import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseDotEnv, loadDotEnv } from '../../src/core/env.ts';

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

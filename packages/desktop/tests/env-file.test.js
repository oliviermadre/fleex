/**
 * Tests for the .env parser used by the DMG bundle to persist API credentials
 * in ~/.fleex/.env. The parser is intentionally minimal — these tests pin down
 * the WHY: we need credentials to round-trip without corruption (quotes,
 * comments, whitespace) so a user editing the Settings panel doesn't silently
 * destroy their config.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseEnvFile,
  serializeEnvFile,
  updateEnvFile,
  readEnvFile,
} = require('../src/lib/env-file.js');

describe('parseEnvFile', () => {
  it('parses bare KEY=VALUE pairs', () => {
    expect(parseEnvFile('A=1\nB=hello')).toEqual({ A: '1', B: 'hello' });
  });

  it('ignores blank lines and comments', () => {
    const src = '\n# comment\n\nA=1\n  # leading space comment\nB=2\n';
    expect(parseEnvFile(src)).toEqual({ A: '1', B: '2' });
  });

  it('handles double-quoted values with spaces and #', () => {
    const src = 'A="hello world"\nB="contains # inside"';
    expect(parseEnvFile(src)).toEqual({ A: 'hello world', B: 'contains # inside' });
  });

  it('handles single-quoted values', () => {
    expect(parseEnvFile("A='value with spaces'")).toEqual({ A: 'value with spaces' });
  });

  it('strips trailing inline comments on unquoted values', () => {
    expect(parseEnvFile('A=foo # comment\nB=bar')).toEqual({ A: 'foo', B: 'bar' });
  });

  it('does NOT strip "#" that is part of an unquoted value (no leading space)', () => {
    // Why: a real API key like "sb_publishable_pBhVfvmIIA9LF62JaZKQ9Q_vQQrQlPX#tail"
    // would be destroyed if we stripped on any `#`. We only strip when `#` is
    // preceded by whitespace.
    expect(parseEnvFile('KEY=value#part')).toEqual({ KEY: 'value#part' });
  });

  it('accepts `export KEY=VALUE` prefix', () => {
    expect(parseEnvFile('export FOO=bar')).toEqual({ FOO: 'bar' });
  });

  it('rejects malformed keys', () => {
    expect(parseEnvFile('1BAD=x\n-also-bad=x\nGOOD=y')).toEqual({ GOOD: 'y' });
  });

  it('returns empty object on empty input', () => {
    expect(parseEnvFile('')).toEqual({});
  });
});

describe('serializeEnvFile', () => {
  it('round-trips simple values', () => {
    const obj = { A: '1', B: 'hello' };
    expect(parseEnvFile(serializeEnvFile(obj))).toEqual(obj);
  });

  it('quotes values that contain spaces', () => {
    const obj = { A: 'hello world' };
    const text = serializeEnvFile(obj);
    expect(text).toContain('A="hello world"');
    expect(parseEnvFile(text)).toEqual(obj);
  });

  it('quotes values that contain # (so they parse back identically)', () => {
    const obj = { KEY: 'value # not-a-comment' };
    expect(parseEnvFile(serializeEnvFile(obj))).toEqual(obj);
  });

  it('escapes embedded double quotes', () => {
    const obj = { K: 'a"b' };
    expect(parseEnvFile(serializeEnvFile(obj))).toEqual(obj);
  });

  it('skips invalid keys silently', () => {
    const obj = { GOOD: 'x', '1BAD': 'y' };
    expect(parseEnvFile(serializeEnvFile(obj))).toEqual({ GOOD: 'x' });
  });
});

describe('updateEnvFile / readEnvFile', () => {
  let tmpDir;
  let envPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-env-test-'));
    envPath = path.join(tmpDir, '.env');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readEnvFile returns {} when the file does not exist', () => {
    expect(readEnvFile(envPath)).toEqual({});
  });

  it('writes a new file with mode 600', () => {
    updateEnvFile(envPath, { ANTHROPIC_API_KEY: 'sk-foo' });
    const stat = fs.statSync(envPath);
    // mode & 0o777 — credentials must not leak to other users
    expect(stat.mode & 0o777).toBe(0o600);
    expect(readEnvFile(envPath)).toEqual({ ANTHROPIC_API_KEY: 'sk-foo' });
  });

  it('merges updates into an existing file (does not destroy other keys)', () => {
    updateEnvFile(envPath, { FLEEX_SUPABASE_URL: 'https://example.supabase.co' });
    updateEnvFile(envPath, { ANTHROPIC_API_KEY: 'sk-foo' });
    expect(readEnvFile(envPath)).toEqual({
      FLEEX_SUPABASE_URL: 'https://example.supabase.co',
      ANTHROPIC_API_KEY: 'sk-foo',
    });
  });

  it('treats an explicit empty-string update as deletion', () => {
    updateEnvFile(envPath, { OLD: 'value', KEEP: 'me' });
    updateEnvFile(envPath, { OLD: '' });
    expect(readEnvFile(envPath)).toEqual({ KEEP: 'me' });
  });

  it('creates parent directories on first write', () => {
    const nested = path.join(tmpDir, 'a', 'b', '.env');
    updateEnvFile(nested, { A: '1' });
    expect(fs.existsSync(nested)).toBe(true);
    expect(readEnvFile(nested)).toEqual({ A: '1' });
  });
});

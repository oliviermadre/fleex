/**
 * Pins down the *contract* of loadFleexEnv():
 *   - missing file → no-op
 *   - existing process.env wins (so dev workflow keeps working)
 *   - only valid KEY=VALUE pairs are loaded
 *
 * If any of these break, a user upgrading from the CLI workflow to the DMG
 * could find their dev .env silently overridden by an old ~/.fleex/.env,
 * or vice versa.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadFleexEnv } from '../../src/infrastructure/load-fleex-env.js';

describe('loadFleexEnv', () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-load-env-test-'));
    process.env['FLEEX_HOME'] = tmpDir;
    // Clean any leaks from previous tests
    for (const k of ['ANTHROPIC_API_KEY', 'FLEEX_SUPABASE_URL', 'FLEEX_SUPABASE_KEY']) {
      delete process.env[k];
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  it('is a no-op when the file does not exist', () => {
    const result = loadFleexEnv();
    expect(result.exists).toBe(false);
    expect(result.loaded).toBe(0);
  });

  it('loads new keys into process.env', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'ANTHROPIC_API_KEY=sk-foo\nFLEEX_SUPABASE_URL=https://x.supabase.co\n',
    );
    const result = loadFleexEnv();
    expect(result.exists).toBe(true);
    expect(result.loaded).toBe(2);
    expect(process.env['ANTHROPIC_API_KEY']).toBe('sk-foo');
    expect(process.env['FLEEX_SUPABASE_URL']).toBe('https://x.supabase.co');
  });

  it('does NOT override variables already set in process.env', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-from-shell';
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'ANTHROPIC_API_KEY=sk-from-file\nFLEEX_SUPABASE_URL=https://x.supabase.co\n',
    );
    const result = loadFleexEnv();
    // 1 loaded — FLEEX_SUPABASE_URL — ANTHROPIC_API_KEY was already set
    expect(result.loaded).toBe(1);
    expect(process.env['ANTHROPIC_API_KEY']).toBe('sk-from-shell');
    expect(process.env['FLEEX_SUPABASE_URL']).toBe('https://x.supabase.co');
  });

  it('ignores blank lines and comments', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      '# comment\n\nANTHROPIC_API_KEY=sk-foo\n',
    );
    const result = loadFleexEnv();
    expect(result.loaded).toBe(1);
    expect(process.env['ANTHROPIC_API_KEY']).toBe('sk-foo');
  });
});

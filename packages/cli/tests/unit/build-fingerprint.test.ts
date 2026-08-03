import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeFingerprint, UNKNOWN_FINGERPRINT } from '../../src/core/build-fingerprint.ts';

let repo: string;
const srcDir = () => path.join(repo, 'packages/sidepanel-host/src');

function writeSource(name: string, body: string): void {
  fs.mkdirSync(srcDir(), { recursive: true });
  fs.writeFileSync(path.join(srcDir(), name), body);
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-fingerprint-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('computeFingerprint', () => {
  it('is stable when nothing changed', () => {
    writeSource('server.ts', 'export const a = 1;');
    expect(computeFingerprint(repo)).toBe(computeFingerprint(repo));
  });

  it('changes when a source file is edited', () => {
    // This is the whole point: an edited companion must look different from the
    // one already running, so `fleex start` restarts it instead of reusing it.
    writeSource('server.ts', 'export const a = 1;');
    const before = computeFingerprint(repo);

    const file = path.join(srcDir(), 'server.ts');
    fs.writeFileSync(file, 'export const a = 2; // longer, so size moves too');
    fs.utimesSync(file, new Date(), new Date(Date.now() + 60_000));

    expect(computeFingerprint(repo)).not.toBe(before);
  });

  it('changes when a source file is added', () => {
    writeSource('server.ts', 'export const a = 1;');
    const before = computeFingerprint(repo);
    writeSource('global-allowlist.ts', 'export const b = 2;');
    expect(computeFingerprint(repo)).not.toBe(before);
  });

  it('picks up files in nested directories', () => {
    writeSource('server.ts', 'export const a = 1;');
    const before = computeFingerprint(repo);
    fs.mkdirSync(path.join(srcDir(), 'nested'), { recursive: true });
    fs.writeFileSync(path.join(srcDir(), 'nested', 'x.ts'), 'export const x = 1;');
    expect(computeFingerprint(repo)).not.toBe(before);
  });

  it('reports "unknown" rather than throwing when the sources are missing', () => {
    // A pure dev checkout or a broken install must not break `fleex start`.
    expect(computeFingerprint(path.join(repo, 'nope'))).toBe(UNKNOWN_FINGERPRINT);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GlobalAllowlist } from '../src/global-allowlist.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-global-allowlist-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const file = () => path.join(dir, 'auto-approve.json');

describe('GlobalAllowlist', () => {
  it('survives a process restart — the whole point of "always allow"', () => {
    // The companion is restarted on every update; a grant that dies with the
    // process is exactly the bug this replaces.
    new GlobalAllowlist(dir).allow('fleex_ticket_link');
    expect(new GlobalAllowlist(dir).has('fleex_ticket_link')).toBe(true);
  });

  it('grants only the tool that was named', () => {
    const a = new GlobalAllowlist(dir);
    a.allow('fleex_ticket_link');
    expect(a.has('fleex_ticket_create')).toBe(false);
  });

  it('is idempotent and does not duplicate entries', () => {
    const a = new GlobalAllowlist(dir);
    a.allow('fleex_ticket_link');
    a.allow('fleex_ticket_link');
    expect(a.list()).toEqual(['fleex_ticket_link']);
  });

  it('restores the prompt once a tool is revoked', () => {
    const a = new GlobalAllowlist(dir);
    a.allow('fleex_ticket_link');
    a.revoke('fleex_ticket_link');
    expect(a.has('fleex_ticket_link')).toBe(false);
    expect(new GlobalAllowlist(dir).list()).toEqual([]);
  });

  it('ignores a revoke for a tool that was never granted', () => {
    const a = new GlobalAllowlist(dir);
    a.allow('fleex_ticket_link');
    a.revoke('fleex_never_granted');
    expect(a.list()).toEqual(['fleex_ticket_link']);
  });

  it('clears everything at once', () => {
    const a = new GlobalAllowlist(dir);
    a.allow('fleex_ticket_link');
    a.allow('fleex_ticket_create');
    a.clear();
    expect(new GlobalAllowlist(dir).list()).toEqual([]);
  });

  it('treats a corrupt file as "nothing allowed", never as a crash or a grant', () => {
    // Failing open here would silently auto-approve mutating commands.
    fs.writeFileSync(file(), '{ this is not json');
    expect(new GlobalAllowlist(dir).list()).toEqual([]);
  });

  it('ignores non-string entries in the persisted list', () => {
    fs.writeFileSync(file(), JSON.stringify({ version: 1, tools: ['fleex_ticket_link', 42, null, ''] }));
    expect(new GlobalAllowlist(dir).list()).toEqual(['fleex_ticket_link']);
  });

  it('stores under FLEEX_HOME when no directory is given', () => {
    const prev = process.env.FLEEX_HOME;
    process.env.FLEEX_HOME = dir;
    try {
      new GlobalAllowlist().allow('fleex_ticket_link');
      expect(fs.existsSync(path.join(dir, '.sidepanel', 'auto-approve.json'))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.FLEEX_HOME;
      else process.env.FLEEX_HOME = prev;
    }
  });

  it('keeps the list sorted so the Settings view is stable', () => {
    const a = new GlobalAllowlist(dir);
    a.allow('fleex_ticket_link');
    a.allow('fleex_board_create');
    expect(a.list()).toEqual(['fleex_board_create', 'fleex_ticket_link']);
  });
});

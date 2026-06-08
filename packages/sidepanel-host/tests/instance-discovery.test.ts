import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listWorkspaceInstances, findWorkspaceServerPort } from '../src/instance-discovery.ts';

let home: string;
let runDir: string;
let prevHome: string | undefined;

function mkInstance(slug: string, ports: object | null) {
  const d = path.join(runDir, slug);
  fs.mkdirSync(d, { recursive: true });
  if (ports) fs.writeFileSync(path.join(d, 'ports.json'), JSON.stringify(ports));
}

beforeEach(() => {
  prevHome = process.env.FLEEX_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-home-'));
  runDir = path.join(home, '.run');
  fs.mkdirSync(runDir, { recursive: true });
  process.env.FLEEX_HOME = home;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.FLEEX_HOME;
  else process.env.FLEEX_HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('listWorkspaceInstances', () => {
  it('returns only matching-workspace instances that have a server port', () => {
    mkInstance('sqlite@main', { gateway: 1, server: 55275, web: 3 });
    mkInstance('sqlite@feature-x', { gateway: 4, server: 55280, web: 6 });
    mkInstance('default@main', { gateway: 7, server: 52216, web: 9 });
    mkInstance('sqlite@broken', null);
    const got = listWorkspaceInstances('sqlite', runDir).map((i) => i.server).sort();
    expect(got).toEqual([55275, 55280]);
  });

  it('does not match a workspace that is a prefix of another', () => {
    mkInstance('sql@main', { gateway: 1, server: 100, web: 3 });
    expect(listWorkspaceInstances('sqlite', runDir)).toEqual([]);
  });
});

describe('findWorkspaceServerPort', () => {
  it('returns the first instance whose server port is listening', async () => {
    mkInstance('sqlite@main', { gateway: 1, server: 55275, web: 3 });
    mkInstance('sqlite@feature', { gateway: 4, server: 55280, web: 6 });
    const got = await findWorkspaceServerPort('sqlite', async (port) => port === 55280);
    expect(got).toBe(55280);
  });

  it('returns null when nothing is listening', async () => {
    mkInstance('sqlite@main', { gateway: 1, server: 55275, web: 3 });
    const got = await findWorkspaceServerPort('sqlite', async () => false);
    expect(got).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';

import { GithubDiscovery } from '../../src/domain/services/github-discovery.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function execStub(responses: Record<string, string | Error>) {
  return vi.fn(async (_cmd: string, args: string[]) => {
    const key = args.join(' ');
    const match = Object.entries(responses).find(([k]) => key.startsWith(k));
    if (!match) throw new Error(`unexpected gh call: ${key}`);
    if (match[1] instanceof Error) throw match[1];
    return { stdout: match[1] as string, stderr: '' };
  });
}

describe('GithubDiscovery', () => {
  it('aggregates the user and org repos, lowercased', async () => {
    const exec = execStub({
      'api user --jq .login': 'Olivier\n',
      'api user/orgs': 'acme\nBigCorp\n',
      'repo list olivier': JSON.stringify([
        { nameWithOwner: 'Olivier/Tool', visibility: 'PRIVATE', updatedAt: '2026-07-01T00:00:00Z' },
      ]),
      'repo list acme': JSON.stringify([
        { nameWithOwner: 'acme/app', visibility: 'PUBLIC', updatedAt: '2026-07-02T00:00:00Z' },
      ]),
      'repo list bigcorp': JSON.stringify([]),
    });
    const d = new GithubDiscovery(exec as never, logger);
    const result = await d.discover();
    expect(result.owners.map((o) => o.login)).toEqual(['olivier', 'acme', 'bigcorp']);
    expect(result.owners[0]!.repos[0]).toEqual({
      nameWithOwner: 'olivier/tool',
      visibility: 'private',
      updatedAt: '2026-07-01T00:00:00Z',
    });
    expect(result.totalRepos).toBe(2);
  });

  it('tolerates a failing org listing (skips it, keeps the rest)', async () => {
    const exec = execStub({
      'api user --jq .login': 'olivier\n',
      'api user/orgs': 'acme\n',
      'repo list olivier': JSON.stringify([]),
      'repo list acme': new Error('boom'),
    });
    const d = new GithubDiscovery(exec as never, logger);
    const result = await d.discover();
    expect(result.owners.map((o) => o.login)).toEqual(['olivier', 'acme']);
    expect(result.owners[1]!.repos).toEqual([]);
  });

  it('propagates a failure to identify the user (gh not authenticated)', async () => {
    const exec = execStub({ 'api user --jq .login': new Error('gh: not logged in') });
    const d = new GithubDiscovery(exec as never, logger);
    await expect(d.discover()).rejects.toThrow();
  });

  it('verifyRepo returns the canonical name or exists:false', async () => {
    const exec = execStub({
      'repo view anthropics/claude-code': JSON.stringify({
        nameWithOwner: 'Anthropics/Claude-Code',
      }),
      'repo view nope/nope': new Error('not found'),
    });
    const d = new GithubDiscovery(exec as never, logger);
    expect(await d.verifyRepo('anthropics/claude-code')).toEqual({
      exists: true,
      nameWithOwner: 'anthropics/claude-code',
    });
    expect(await d.verifyRepo('nope/nope')).toEqual({ exists: false });
  });
});

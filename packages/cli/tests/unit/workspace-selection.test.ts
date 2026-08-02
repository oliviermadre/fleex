import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

import {
  resolveWorkspaceSelection,
  ambientWorkspaceWarning,
  type InstanceContext,
} from '../../src/core/instance.ts';
import { stackNotRunningMessage } from '../../src/core/ports.ts';
import {
  setSelectedWorkspace,
  resetSelectedWorkspace,
} from '../../src/core/workspace-selection.ts';
import { workspacesFilePath } from '../../src/core/workspaces.ts';

let tmpDir: string;
let envSnapshot: NodeJS.ProcessEnv;
let homeDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-wssel-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write the global workspaces.json (0600) under the active FLEEX_HOME. */
function writeGlobalWs(content: string): void {
  const p = workspacesFilePath();
  fs.writeFileSync(p, content);
  fs.chmodSync(p, 0o600);
}

/** Configure a single is_default workspace `name` (plus a sibling) on disk. */
function withDefault(name: string): void {
  writeGlobalWs(
    JSON.stringify({
      workspaces: [
        { name, is_default: true, env: {} },
        { name: `${name}-other`, env: {} },
      ],
    }),
  );
}

/** Build an InstanceContext, defaulting every field so tests set only what matters. */
function ctx(partial: Partial<InstanceContext>): InstanceContext {
  return {
    repoDir: '/repo',
    instanceSlug: 'default@main',
    instanceRun: '/run',
    instanceLog: '/log',
    portsFile: '/run/ports.json',
    workspace: 'default',
    workspaceSource: 'default',
    branch: 'main',
    ...partial,
  };
}

beforeEach(() => {
  envSnapshot = { ...process.env };
  homeDir = fs.mkdtempSync(path.join(tmpDir, 'home-'));
  process.env.FLEEX_HOME = homeDir;
  delete process.env.FLEEX_WORKSPACE;
  resetSelectedWorkspace();
});

afterEach(() => {
  process.env = envSnapshot;
  resetSelectedWorkspace();
});

describe('resolveWorkspaceSelection', () => {
  it('honours an explicit --workspace flag over env and default', () => {
    withDefault('default');
    process.env.FLEEX_WORKSPACE = 'from-env';
    setSelectedWorkspace('picked', 'flag');
    expect(resolveWorkspaceSelection()).toEqual({ workspace: 'picked', source: 'flag' });
  });

  it('honours a resolved-default activation (source=default) over env', () => {
    withDefault('default');
    process.env.FLEEX_WORKSPACE = 'from-env';
    setSelectedWorkspace('default', 'default');
    expect(resolveWorkspaceSelection()).toEqual({ workspace: 'default', source: 'default' });
  });

  it('falls back to an ambient FLEEX_WORKSPACE when nothing was activated', () => {
    withDefault('default');
    process.env.FLEEX_WORKSPACE = 'sqlite';
    expect(resolveWorkspaceSelection()).toEqual({ workspace: 'sqlite', source: 'env' });
  });

  it('trims a padded FLEEX_WORKSPACE and ignores a blank one', () => {
    withDefault('default');
    process.env.FLEEX_WORKSPACE = '  sqlite  ';
    expect(resolveWorkspaceSelection()).toEqual({ workspace: 'sqlite', source: 'env' });
    process.env.FLEEX_WORKSPACE = '   ';
    expect(resolveWorkspaceSelection()).toEqual({ workspace: 'default', source: 'default' });
  });

  it('falls back to the is_default workspace when no flag or env is present', () => {
    withDefault('default');
    expect(resolveWorkspaceSelection()).toEqual({ workspace: 'default', source: 'default' });
  });

  it('returns legacy (null) when there is no workspaces.json', () => {
    expect(resolveWorkspaceSelection()).toEqual({ workspace: null, source: 'legacy' });
  });
});

describe('ambientWorkspaceWarning', () => {
  it('warns when an env workspace differs from the configured default', () => {
    withDefault('default');
    const msg = ambientWorkspaceWarning({ workspace: 'sqlite', source: 'env' });
    expect(msg).not.toBeNull();
    expect(msg).toContain('sqlite');
    expect(msg).toContain('FLEEX_WORKSPACE');
    expect(msg).toContain("default 'default'");
    expect(msg).toContain('--workspace');
  });

  it('is silent when the env workspace equals the default', () => {
    withDefault('default');
    expect(ambientWorkspaceWarning({ workspace: 'default', source: 'env' })).toBeNull();
  });

  it('is silent when there is no configured default', () => {
    // no workspaces.json → defaultWorkspaceName() is null
    expect(ambientWorkspaceWarning({ workspace: 'sqlite', source: 'env' })).toBeNull();
  });

  it('is silent for non-env sources (flag / default / legacy)', () => {
    withDefault('default');
    expect(ambientWorkspaceWarning({ workspace: 'sqlite', source: 'flag' })).toBeNull();
    expect(ambientWorkspaceWarning({ workspace: 'default', source: 'default' })).toBeNull();
    expect(ambientWorkspaceWarning({ workspace: null, source: 'legacy' })).toBeNull();
  });
});

describe('stackNotRunningMessage', () => {
  it('names the exact instance and gives a plain start command for the default workspace', () => {
    withDefault('default');
    const msg = stackNotRunningMessage(
      ctx({
        workspace: 'default',
        workspaceSource: 'default',
        branch: 'main',
        instanceSlug: 'default@main',
      }),
    );
    expect(msg).toContain("workspace 'default'");
    expect(msg).toContain("branch 'main'");
    expect(msg).toContain("instance 'default@main'");
    expect(msg).toContain('fleex start');
    // The default resolves via a plain `fleex start`, so no flag is suggested.
    expect(msg).not.toContain('--workspace');
  });

  it('adds --workspace to the start command for a non-default workspace', () => {
    withDefault('default');
    const msg = stackNotRunningMessage(
      ctx({
        workspace: 'sqlite',
        workspaceSource: 'flag',
        branch: 'main',
        instanceSlug: 'sqlite@main',
      }),
    );
    expect(msg).toContain('fleex start --workspace sqlite');
  });

  it('explains the stale-env footgun when the workspace came from FLEEX_WORKSPACE', () => {
    withDefault('default');
    const msg = stackNotRunningMessage(
      ctx({
        workspace: 'sqlite',
        workspaceSource: 'env',
        branch: 'main',
        instanceSlug: 'sqlite@main',
      }),
    );
    expect(msg).toContain('fleex start --workspace sqlite');
    expect(msg).toContain('inherited $FLEEX_WORKSPACE');
    expect(msg).toContain("default 'default'");
    expect(msg).toContain('unset FLEEX_WORKSPACE');
    expect(msg).toContain('--workspace default');
  });

  it('does not add the stale-env note when the env workspace IS the default', () => {
    withDefault('default');
    const msg = stackNotRunningMessage(
      ctx({
        workspace: 'default',
        workspaceSource: 'env',
        branch: 'main',
        instanceSlug: 'default@main',
      }),
    );
    expect(msg).not.toContain('inherited $FLEEX_WORKSPACE');
    expect(msg).toContain('fleex start');
  });

  it('handles legacy (branch-only) mode without a workspace', () => {
    // no workspaces.json → defaultWorkspaceName() is null
    const msg = stackNotRunningMessage(
      ctx({ workspace: null, workspaceSource: 'legacy', branch: 'feat-x', instanceSlug: 'feat-x' }),
    );
    expect(msg).toContain("branch 'feat-x'");
    expect(msg).toContain("instance 'feat-x'");
    expect(msg).toContain('fleex start');
    expect(msg).not.toContain('--workspace');
  });
});

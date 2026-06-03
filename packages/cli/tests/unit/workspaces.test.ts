import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseWorkspacesFile,
  resolveWorkspace,
  activateWorkspace,
  bootstrapWorkspacesFromEnv,
  validateWorkspacesConfig,
  defaultWorkspaceName,
  workspacesFilePath,
  type Workspace,
} from '../../src/core/workspaces.ts';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-ws-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeWs(name: string, content: string): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

/** Write the global workspaces.json with secret-safe 0600 perms (no warning). */
function writeGlobalWs(content: string): void {
  const p = workspacesFilePath();
  fs.writeFileSync(p, content);
  fs.chmodSync(p, 0o600);
}

function ws(name: string, is_default: boolean, env: Record<string, string> = {}): Workspace {
  return { name, is_default, env };
}

describe('parseWorkspacesFile', () => {
  it('returns null when the file does not exist', () => {
    expect(parseWorkspacesFile(path.join(tmpDir, 'nope.json'))).toBeNull();
  });

  it('parses a valid workspaces file with nested env', () => {
    const p = writeWs(
      'valid.json',
      JSON.stringify({
        workspaces: [
          { name: 'tada', is_default: true, env: { FLEEX_STORAGE_DRIVER: 'supabase', X: '1' } },
          { name: 'perso', env: { FLEEX_STORAGE_DRIVER: 'sqlite' } },
        ],
      }),
    );
    const parsed = parseWorkspacesFile(p);
    expect(parsed).toEqual([
      { name: 'tada', is_default: true, env: { FLEEX_STORAGE_DRIVER: 'supabase', X: '1' } },
      { name: 'perso', is_default: false, env: { FLEEX_STORAGE_DRIVER: 'sqlite' } },
    ]);
  });

  it('defaults env to an empty object when omitted', () => {
    const p = writeWs('no-env.json', JSON.stringify({ workspaces: [{ name: 'bare' }] }));
    expect(parseWorkspacesFile(p)).toEqual([{ name: 'bare', is_default: false, env: {} }]);
  });

  it('throws on invalid JSON', () => {
    const p = writeWs('bad.json', '{ not json');
    expect(() => parseWorkspacesFile(p)).toThrow(/valid JSON/i);
  });

  it('throws when the workspaces array is missing', () => {
    const p = writeWs('missing-array.json', JSON.stringify({ foo: 'bar' }));
    expect(() => parseWorkspacesFile(p)).toThrow(/workspaces/i);
  });

  it('throws on a workspace without a name', () => {
    const p = writeWs('no-name.json', JSON.stringify({ workspaces: [{ env: {} }] }));
    expect(() => parseWorkspacesFile(p)).toThrow(/name/i);
  });

  it('throws on duplicate workspace names', () => {
    const p = writeWs(
      'dup.json',
      JSON.stringify({ workspaces: [{ name: 'x' }, { name: 'x' }] }),
    );
    expect(() => parseWorkspacesFile(p)).toThrow(/duplicate/i);
  });

  it('throws when env is not an object', () => {
    const p = writeWs('bad-env.json', JSON.stringify({ workspaces: [{ name: 'x', env: [] }] }));
    expect(() => parseWorkspacesFile(p)).toThrow(/env/i);
  });
});

describe('resolveWorkspace', () => {
  const list = [ws('tada', true, { A: '1' }), ws('perso', false, { B: '2' })];

  it('returns the named workspace when found', () => {
    expect(resolveWorkspace(list, 'perso')).toBe(list[1]);
  });

  it('throws with available names when the named workspace is unknown', () => {
    expect(() => resolveWorkspace(list, 'ghost')).toThrow(/ghost/);
    expect(() => resolveWorkspace(list, 'ghost')).toThrow(/tada/);
  });

  it('returns the single default when no name is given', () => {
    expect(resolveWorkspace(list)).toBe(list[0]);
  });

  it('throws when multiple defaults exist (corrupt)', () => {
    const bad = [ws('a', true), ws('b', true)];
    expect(() => resolveWorkspace(bad)).toThrow(/corrupt|default/i);
    expect(() => resolveWorkspace(bad)).toThrow(/a/);
    expect(() => resolveWorkspace(bad)).toThrow(/b/);
  });

  it('throws when no default exists and no name is given', () => {
    const bad = [ws('a', false), ws('b', false)];
    expect(() => resolveWorkspace(bad)).toThrow(/default/i);
  });
});

describe('activateWorkspace', () => {
  let envSnapshot: NodeJS.ProcessEnv;
  let homeDir: string;

  beforeEach(() => {
    envSnapshot = { ...process.env };
    homeDir = fs.mkdtempSync(path.join(tmpDir, 'home-'));
    process.env.FLEEX_HOME = homeDir;
    delete process.env.FLEEX_WORKSPACE;
  });

  afterEach(() => {
    process.env = envSnapshot;
  });

  it('returns null in legacy mode (no workspaces.json) and does not set FLEEX_WORKSPACE', () => {
    const result = activateWorkspace();
    expect(result).toBeNull();
    expect(process.env.FLEEX_WORKSPACE).toBeUndefined();
  });

  it('resolves the default workspace, sets FLEEX_WORKSPACE and injects env', () => {
    writeGlobalWs(
      JSON.stringify({ workspaces: [{ name: 'tada', is_default: true, env: { FLEEX_STORAGE_DRIVER: 'supabase' } }] }),
    );
    delete process.env.FLEEX_STORAGE_DRIVER;
    const result = activateWorkspace();
    expect(result?.name).toBe('tada');
    expect(process.env.FLEEX_WORKSPACE).toBe('tada');
    expect(process.env.FLEEX_STORAGE_DRIVER).toBe('supabase');
  });

  it('workspace env overrides an already-exported shell variable', () => {
    writeGlobalWs(
      JSON.stringify({ workspaces: [{ name: 'tada', is_default: true, env: { FLEEX_STORAGE_DRIVER: 'supabase' } }] }),
    );
    process.env.FLEEX_STORAGE_DRIVER = 'sqlite-from-shell';
    activateWorkspace();
    expect(process.env.FLEEX_STORAGE_DRIVER).toBe('supabase');
  });

  it('selects a named workspace over the default', () => {
    writeGlobalWs(
      JSON.stringify({
        workspaces: [
          { name: 'tada', is_default: true, env: { K: 'tada' } },
          { name: 'perso', env: { K: 'perso' } },
        ],
      }),
    );
    delete process.env.K;
    const result = activateWorkspace('perso');
    expect(result?.name).toBe('perso');
    expect(process.env.FLEEX_WORKSPACE).toBe('perso');
    expect(process.env.K).toBe('perso');
  });
});

describe('bootstrapWorkspacesFromEnv', () => {
  let homeDir: string;
  let repoDir: string;
  let envSnapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    envSnapshot = { ...process.env };
    homeDir = fs.mkdtempSync(path.join(tmpDir, 'bs-home-'));
    repoDir = fs.mkdtempSync(path.join(tmpDir, 'bs-repo-'));
    process.env.FLEEX_HOME = homeDir;
  });

  afterEach(() => {
    process.env = envSnapshot;
  });

  it('creates workspaces.json from an existing .env when the file is missing', () => {
    const envFile = path.join(repoDir, '.env');
    fs.writeFileSync(envFile, 'FLEEX_STORAGE_DRIVER=sqlite\nANTHROPIC_API_KEY=sk-test\n');
    const created = bootstrapWorkspacesFromEnv(envFile);
    expect(created?.name).toBe('default');
    expect(created?.is_default).toBe(true);
    expect(created?.env).toEqual({ FLEEX_STORAGE_DRIVER: 'sqlite', ANTHROPIC_API_KEY: 'sk-test' });

    const onDisk = parseWorkspacesFile(workspacesFilePath());
    expect(onDisk).toEqual([{ name: 'default', is_default: true, env: { FLEEX_STORAGE_DRIVER: 'sqlite', ANTHROPIC_API_KEY: 'sk-test' } }]);
    // secrets: file must be created with 0600 perms
    const mode = fs.statSync(workspacesFilePath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('returns null and does nothing when workspaces.json already exists', () => {
    fs.writeFileSync(workspacesFilePath(), JSON.stringify({ workspaces: [{ name: 'keep', is_default: true }] }));
    const envFile = path.join(repoDir, '.env');
    fs.writeFileSync(envFile, 'FLEEX_STORAGE_DRIVER=sqlite\n');
    expect(bootstrapWorkspacesFromEnv(envFile)).toBeNull();
    // existing file untouched
    expect(parseWorkspacesFile(workspacesFilePath())).toEqual([{ name: 'keep', is_default: true, env: {} }]);
  });

  it('returns null when no .env exists', () => {
    expect(bootstrapWorkspacesFromEnv(path.join(repoDir, '.env'))).toBeNull();
    expect(fs.existsSync(workspacesFilePath())).toBe(false);
  });
});

describe('validateWorkspacesConfig', () => {
  it('is ok in legacy mode (no workspaces.json)', () => {
    expect(validateWorkspacesConfig(path.join(tmpDir, 'absent.json'))).toEqual({ ok: true });
  });

  it('is ok with exactly one default', () => {
    const p = writeWs('v-one.json', JSON.stringify({
      workspaces: [
        { name: 'a', is_default: true, env: {} },
        { name: 'b', env: {} },
      ],
    }));
    expect(validateWorkspacesConfig(p)).toEqual({ ok: true });
  });

  it('is ok with zero defaults (explicit --workspace setup)', () => {
    const p = writeWs('v-zero.json', JSON.stringify({
      workspaces: [
        { name: 'a', env: {} },
        { name: 'b', env: {} },
      ],
    }));
    expect(validateWorkspacesConfig(p)).toEqual({ ok: true });
  });

  it('is invalid when more than one default is flagged', () => {
    const p = writeWs('v-two.json', JSON.stringify({
      workspaces: [
        { name: 'default', is_default: true, env: {} },
        { name: 'sqlite', is_default: true, env: {} },
      ],
    }));
    const res = validateWorkspacesConfig(p);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/only one default/);
    expect(res.ok === false && res.error).toMatch(/default, sqlite/);
  });

  it('is invalid on malformed JSON', () => {
    const p = writeWs('v-bad.json', '{ not json');
    const res = validateWorkspacesConfig(p);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/not valid JSON/);
  });

  it('is invalid on a duplicate workspace name', () => {
    const p = writeWs('v-dup.json', JSON.stringify({
      workspaces: [
        { name: 'dup', is_default: true, env: {} },
        { name: 'dup', env: {} },
      ],
    }));
    const res = validateWorkspacesConfig(p);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/duplicate/);
  });
});

describe('defaultWorkspaceName', () => {
  it('returns null in legacy mode (no file)', () => {
    expect(defaultWorkspaceName(path.join(tmpDir, 'absent.json'))).toBeNull();
  });

  it('returns the name of the single default', () => {
    const p = writeWs('d-one.json', JSON.stringify({
      workspaces: [
        { name: 'default', is_default: true },
        { name: 'sqlite' },
      ],
    }));
    expect(defaultWorkspaceName(p)).toBe('default');
  });

  it('returns null when there is no default (explicit --workspace setup)', () => {
    const p = writeWs('d-zero.json', JSON.stringify({
      workspaces: [{ name: 'a' }, { name: 'b' }],
    }));
    expect(defaultWorkspaceName(p)).toBeNull();
  });

  it('returns null when the config is ambiguous (>1 default)', () => {
    const p = writeWs('d-two.json', JSON.stringify({
      workspaces: [
        { name: 'a', is_default: true },
        { name: 'b', is_default: true },
      ],
    }));
    expect(defaultWorkspaceName(p)).toBeNull();
  });

  it('returns null on a corrupt config instead of throwing', () => {
    const p = writeWs('d-bad.json', '{ not json');
    expect(defaultWorkspaceName(p)).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { scriptFromAlias } from '@fleex/shared';
import { BinaryDiagnosisService } from './binary-diagnosis.service.js';
import { pinnedActionsRoutes } from '../../infrastructure/http/pinned-actions.routes.js';
import { ActionRunService } from './action-run.service.js';
import { PinnedStatusService } from './pinned-status.service.js';

/** Real zsh output, captured from `whence -w` / `alias` on macOS. */
const ALIAS_DEF = 'docker run --pull=always --rm -it -v ~/.kube/:${HOME}/.kube/ evaneos/platool:latest';
function fakeShell(byShell: { login: string; interactive: string }) {
  return vi.fn(async (command: string) => ({ stdout: command.startsWith('zsh -i') ? byShell.interactive : byShell.login, exitCode: 0 }));
}

describe('BinaryDiagnosisService', () => {
  it('tells an alias of .zshrc apart from a missing program — the platool case', async () => {
    const exec = fakeShell({ login: 'platool: none\n', interactive: `platool: alias\nplatool='${ALIAS_DEF}'\n` });
    const d = await new BinaryDiagnosisService(exec).diagnose('platool');
    expect(d).toEqual({ binary: 'platool', login: 'missing', interactive: 'alias', aliasDefinition: ALIAS_DEF, usesTty: true });
  });

  it('reports the path of a real command and a function of .zshrc', async () => {
    expect(await new BinaryDiagnosisService(fakeShell({ login: 'gh: command\n/opt/homebrew/bin/gh\n', interactive: 'gh: command\n/opt/homebrew/bin/gh\n' })).diagnose('gh'))
      .toMatchObject({ login: 'command', interactive: 'command', path: '/opt/homebrew/bin/gh' });
    expect((await new BinaryDiagnosisService(fakeShell({ login: 'kx: none', interactive: 'kx: function' })).diagnose('kx')).interactive).toBe('function');
  });

  it('refuses anything that is not a bare program name — it ends up in a command line', async () => {
    const exec = vi.fn();
    const svc = new BinaryDiagnosisService(exec);
    for (const bad of ['a;rm -rf ~', 'a b', '$(id)', '../x', '/bin/sh', '']) {
      await expect(svc.diagnose(bad)).rejects.toThrow('Invalid binary name');
    }
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('scriptFromAlias', () => {
  it('keeps the alias command, passes the arguments and only asks for a TTY inside a terminal', () => {
    const script = scriptFromAlias('platool', ALIAS_DEF);
    expect(script).toContain('tty=""; [ -t 0 ] && tty="-t"');
    expect(script).toContain('exec docker run --pull=always --rm -i $tty -v');
    expect(script.trimEnd().split('\n').pop()).toMatch(/"\$@"$/);
    expect(script).not.toContain(' -it ');
  });
});

describe('POST /api/action-runs/diagnose', () => {
  it('answers the diagnosis, and 400 on an unsafe name', async () => {
    const app = Fastify();
    await app.register(pinnedActionsRoutes({
      actionRuns: new ActionRunService({ exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }), defaultCwd: '/', broadcast: () => {} }),
      pinnedStatus: new PinnedStatusService({ exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }), cwd: '/', broadcast: () => {} }),
      binaryDiagnosis: new BinaryDiagnosisService(fakeShell({ login: 'nope: none', interactive: 'nope: none' })),
      logger: { info: () => {} },
    }));
    const ok = await app.inject({ method: 'POST', url: '/api/action-runs/diagnose', payload: { binary: 'nope' } });
    expect(ok.json()).toEqual({ binary: 'nope', login: 'missing', interactive: 'missing' });
    const bad = await app.inject({ method: 'POST', url: '/api/action-runs/diagnose', payload: { binary: 'x; reboot' } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});

describe('ShellBinaryLookup (AI suggestion binaries)', () => {
  it('flags an alias of .zshrc as not found in the background, with its kind', async () => {
    const { ShellBinaryLookup } = await import('../../infrastructure/adapters/actions-ai.adapters.js');
    const svc = new BinaryDiagnosisService(fakeShell({ login: 'platool: none', interactive: `platool: alias\nplatool='${ALIAS_DEF}'` }));
    expect(await new ShellBinaryLookup(svc).lookup('platool')).toEqual({ name: 'platool', found: false, kind: 'alias' });
  });
});

import { describe, it, expect } from 'vitest';
import { diagnoseRun, extractBinaries } from '@fleex/shared';

describe('diagnoseRun', () => {
  it('explains a command not found by naming the program and the .zshrc trap', () => {
    const hint = diagnoseRun({ exitCode: 127, stderr: 'zsh:1: command not found: platool', command: 'platool kubernetes connect' });
    expect(hint?.code).toBe('not-found');
    expect(hint?.binary).toBe('platool');
    expect(hint?.title).toBe('Command not found: platool');
    expect(hint?.detail).toContain('.zshrc');
    expect(hint?.suggest).toContain('run-in-terminal');
  });

  it('falls back to the first program of the command when the output does not name it', () => {
    expect(diagnoseRun({ exitCode: 127, stderr: '', command: 'FOO=1 sudo nexistepas --x' })?.binary).toBe('nexistepas');
  });

  it('recognises a missing TTY (docker run -it) and offers a terminal', () => {
    const hint = diagnoseRun({ exitCode: 1, stderr: 'the input device is not a TTY', command: 'docker run -it alpine true' });
    expect(hint?.code).toBe('no-tty');
    expect(hint?.suggest).toEqual(['run-in-terminal', 'always-terminal']);
  });

  it('recognises a file without the execute bit (126)', () => {
    const hint = diagnoseRun({ exitCode: 126, stderr: 'zsh:1: permission denied: ./deploy.sh', command: './deploy.sh' });
    expect(hint?.code).toBe('not-executable');
    expect(hint?.title).toContain('deploy.sh');
  });

  it('puts timeout before not-found: a killed run says it ran out of time', () => {
    const hint = diagnoseRun({ exitCode: 127, timedOut: true, timeoutSec: 300, stderr: 'command not found: x' });
    expect(hint?.code).toBe('timeout');
    expect(hint?.title).toBe('Timed out after 300 s');
  });

  it('says "Stopped" for a cancelled run', () => {
    expect(diagnoseRun({ exitCode: 143, cancelled: true })?.code).toBe('cancelled');
  });

  it('in a terminal, drops the .zshrc explanation (it is loaded) and never says no-tty', () => {
    expect(diagnoseRun({ mode: 'terminal', exitCode: 127, stderr: 'command not found: foo' })?.detail).not.toContain('.zshrc');
    expect(diagnoseRun({ mode: 'terminal', exitCode: 1, stdout: 'the input device is not a TTY' })).toBeNull();
  });

  it('never flags a successful run, even if its output mentions "command not found"', () => {
    expect(diagnoseRun({ exitCode: 0, stdout: 'docs: what "command not found" means' })).toBeNull();
  });

  it('keeps an unrecognised failure for the V1 toast (exit 3 + stderr)', () => {
    expect(diagnoseRun({ exitCode: 3, stderr: 'boom' })).toBeNull();
  });
});

describe('extractBinaries', () => {
  it('reads the first program of each segment and skips quoted text', () => {
    expect(extractBinaries('cd "$HOME" && gh pr view | grep "a | b"; kubectl get pods')).toEqual(['gh', 'grep', 'kubectl']);
  });
});

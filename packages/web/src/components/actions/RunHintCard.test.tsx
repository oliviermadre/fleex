import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { diagnoseRun } from '@fleex/shared';
import * as api from '../../services/api';
import { RunHintCard, CommandBinaryWarning, clearBinaryDiagnoses, BINARY_CHECK_DELAY_MS } from './RunHintCard';

vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  diagnoseBinary: vi.fn(),
}));

const ALIAS = { binary: 'platool', login: 'missing' as const, interactive: 'alias' as const, aliasDefinition: 'docker run --rm -it evaneos/platool:latest', usesTty: true };

beforeEach(() => {
  clearBinaryDiagnoses();
  vi.mocked(api.diagnoseBinary).mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RunHintCard', () => {
  it('diagnoses a command not found at once and shows the alias with a script to copy', async () => {
    vi.mocked(api.diagnoseBinary).mockResolvedValue(ALIAS);
    const writeText = vi.fn(async (_text: string) => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const hint = diagnoseRun({ exitCode: 127, stderr: 'zsh:1: command not found: platool' })!;
    render(<RunHintCard hint={hint} />);
    expect(await screen.findByText(/alias/)).toBeTruthy();
    expect(screen.getByText(ALIAS.aliasDefinition)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy an equivalent script' }));
    expect(writeText.mock.calls[0]![0]).toContain('exec docker run --rm -i $tty evaneos/platool:latest "$@"');
  });

  it('offers "Run in a terminal" only when the caller can do it', () => {
    const hint = diagnoseRun({ exitCode: 1, stderr: 'the input device is not a TTY' })!;
    const { rerender } = render(<RunHintCard hint={hint} />);
    expect(screen.queryByRole('button', { name: 'Run in a terminal' })).toBeNull();
    const onRun = vi.fn();
    rerender(<RunHintCard hint={hint} onRunInTerminal={onRun} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run in a terminal' }));
    expect(onRun).toHaveBeenCalled();
  });
});

describe('CommandBinaryWarning', () => {
  it('warns while typing that the program is an alias of .zshrc, once the user pauses', async () => {
    vi.useFakeTimers();
    vi.mocked(api.diagnoseBinary).mockResolvedValue(ALIAS);
    render(<CommandBinaryWarning command="platool login prod" />);
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(BINARY_CHECK_DELAY_MS); });
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toContain('platool is an alias of your .zshrc');
    expect(api.diagnoseBinary).toHaveBeenCalledWith('platool');
  });

  it('stays quiet for a real program', async () => {
    vi.useFakeTimers();
    vi.mocked(api.diagnoseBinary).mockResolvedValue({ binary: 'gh', login: 'command', interactive: 'command', path: '/opt/homebrew/bin/gh' });
    render(<CommandBinaryWarning command="gh auth status" />);
    await act(async () => { vi.advanceTimersByTime(BINARY_CHECK_DELAY_MS); });
    await act(async () => {});
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

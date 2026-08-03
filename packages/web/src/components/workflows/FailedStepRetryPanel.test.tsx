import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { FailedStepRetryPanel } from './FailedStepRetryPanel';

afterEach(() => {
  cleanup();
});

describe('FailedStepRetryPanel', () => {
  // WHY: the Workflow tab renders this panel WITHOUT the new props. If adding
  // them changed that surface, this shared component would have been the wrong
  // place to put them. This test is the contract that keeps ticket 479 free to
  // evolve the panel without breaking either caller.
  it('renders the bare Workflow-tab shape when no optional prop is given', () => {
    render(<FailedStepRetryPanel error="boom" onRetry={vi.fn()} />);
    expect(screen.getByText('Step failed')).toBeTruthy();
    expect(screen.queryByText(/attempt/)).toBeNull();
    expect(screen.queryByText('View logs')).toBeNull();
  });

  // WHY: in Comments the panel appears out of context, far from the workflow
  // graph — without the workflow/step label the user cannot tell WHAT failed.
  it('renders the composed title and attempt number when provided', () => {
    render(
      <FailedStepRetryPanel
        error="boom"
        onRetry={vi.fn()}
        title="Step failed · 🚦 Spec Dev PR › Dev"
        attempt={2}
      />,
    );
    expect(screen.getByText(/Step failed · 🚦 Spec Dev PR › Dev/)).toBeTruthy();
    expect(screen.getByText(/attempt 2/)).toBeTruthy();
  });

  // WHY: the stored error is often truncated; the logs hold the real cause. From
  // Comments there is no other way to reach them without switching tabs.
  it('calls onViewLogs when the logs link is clicked', () => {
    const onViewLogs = vi.fn();
    render(<FailedStepRetryPanel error="boom" onRetry={vi.fn()} onViewLogs={onViewLogs} />);
    fireEvent.click(screen.getByText('View logs'));
    expect(onViewLogs).toHaveBeenCalledTimes(1);
  });

  // WHY: a human_gate step has no execution behind it, so there are no logs to
  // open — a dead link would be worse than no link.
  it('hides the logs link when there is no execution to open', () => {
    render(<FailedStepRetryPanel error="boom" onRetry={vi.fn()} />);
    expect(screen.queryByText('View logs')).toBeNull();
  });

  // WHY: some executors die before writing structured output. Showing an empty
  // red box leaves the user wondering whether the UI is broken.
  it('states explicitly when no error message was recorded', () => {
    render(<FailedStepRetryPanel error={null} onRetry={vi.fn()} />);
    expect(screen.getByText('No error message was recorded.')).toBeTruthy();
  });

  // WHY: retry fires a real workflow step. Without disabling the button, an
  // impatient double-click starts the step twice.
  it('disables the button and shows progress while retrying', async () => {
    let resolveRetry: () => void = () => {};
    const onRetry = vi.fn(() => new Promise<void>((r) => { resolveRetry = r; }));
    render(<FailedStepRetryPanel error="boom" onRetry={onRetry} />);

    fireEvent.click(screen.getByText('Retry step'));

    const busyButton = screen.getByText('Retrying…') as HTMLButtonElement;
    expect(busyButton.closest('button')?.disabled).toBe(true);
    expect(onRetry).toHaveBeenCalledTimes(1);

    await act(async () => { resolveRetry(); });
    await waitFor(() => expect(screen.getByText('Retry step')).toBeTruthy());
  });

  // WHY: if the retry POST fails (404 on a stale run, 500), silently resetting
  // the button would look like the retry worked. The card must stay, and say why.
  it('surfaces the failure and re-enables the button when retry rejects', async () => {
    const onRetry = vi.fn().mockRejectedValue(new Error('run not found'));
    render(<FailedStepRetryPanel error="boom" onRetry={onRetry} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Retry step'));
    });

    expect(screen.getByText('run not found')).toBeTruthy();
    const button = screen.getByText('Retry step').closest('button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});

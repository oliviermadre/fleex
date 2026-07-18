import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConfirmModal } from './ConfirmModal';

afterEach(cleanup);

describe('ConfirmModal', () => {
  it('renders nothing when closed', () => {
    render(<ConfirmModal open={false} title="Remove repo" message="Sure?" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText('Remove repo')).toBeNull();
  });

  it('calls onConfirm / onCancel', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmModal open title="Remove repo" message="Sure?" confirmLabel="Remove" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Remove'));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('disables both buttons while busy', () => {
    render(<ConfirmModal open busy title="t" message="m" confirmLabel="Remove" onConfirm={() => {}} onCancel={() => {}} />);
    expect((screen.getByText('Remove') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Cancel') as HTMLButtonElement).disabled).toBe(true);
  });
});

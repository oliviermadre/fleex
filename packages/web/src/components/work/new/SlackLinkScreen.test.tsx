import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { SlackLinkScreen } from './SlackLinkScreen';

afterEach(cleanup);

const LINK = 'https://acme.slack.com/archives/C0123ABCD/p1700000000123456';
const field = () => screen.getByLabelText('Slack message link');

describe('SlackLinkScreen', () => {
  it('imports a Slack permalink on Enter, with the ref existing tickets are found by', () => {
    const onImport = vi.fn();
    render(<SlackLinkScreen onBack={() => {}} onImport={onImport} />);

    fireEvent.change(field(), { target: { value: LINK } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'slack_message', ref: 'C0123ABCD/1700000000.123456' }),
    );
  });

  it('refuses anything that is not a Slack message link, and says how to get one', () => {
    const onImport = vi.fn();
    render(<SlackLinkScreen onBack={() => {}} onImport={onImport} />);

    fireEvent.change(field(), { target: { value: 'https://github.com/acme/web/issues/1' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(onImport).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: /Import/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/doesn't look like a Slack message link/)).toBeTruthy();
  });

  it('goes back on Esc', () => {
    const onBack = vi.fn();
    render(<SlackLinkScreen onBack={onBack} onImport={() => {}} />);

    fireEvent.keyDown(field(), { key: 'Escape' });

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

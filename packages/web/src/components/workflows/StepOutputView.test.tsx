import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { StepOutput, TicketDeliverable } from '@fleex/shared';
import { StepOutputView } from './StepOutputView';

afterEach(() => {
  cleanup();
});

const baseOutput: StepOutput = {
  comment: '## Verdict\n\nThe migration is **safe** under concurrent writes.',
  deliverable: {
    title: 'Migration review',
    markdown: '# Findings\n\nAll good.',
    type: 'report',
    status: 'final',
  },
  mentionStatus: 'resolved',
  schemaFields: { severity: 'low', checks: { locks: 'ok' } },
  result: 'ok',
};

describe('StepOutputView', () => {
  it('renders the comment as markdown instead of an escaped JSON string', () => {
    // The whole point of the pretty view: `comment` is markdown, and markdown
    // inlined in a JSON string is the least readable way to show a paragraph.
    const { container, queryByText } = render(<StepOutputView output={baseOutput} />);

    expect(container.querySelector('h2')?.textContent).toBe('Verdict');
    expect(container.querySelector('strong')?.textContent).toBe('safe');
    // No raw JSON on screen by default.
    expect(queryByText(/"schemaFields"/)).toBeNull();
  });

  it('keeps the raw JSON one click away', () => {
    // A step with an output-format schema can put anything in schemaFields; when
    // the render is not what you expected the bytes are the only ground truth.
    const { getByText, container } = render(<StepOutputView output={baseOutput} />);

    fireEvent.click(getByText('raw'));
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toContain('"schemaFields"');
    expect(pre?.textContent).toContain('"result": "ok"');
  });

  it('surfaces the deliverable this attempt produced', () => {
    // Old vs new is the distinction the sidebar could not make: the previous
    // attempts sit in the "previous deliverables" box, this one lives in the
    // output and is badged accordingly.
    const { getByText } = render(<StepOutputView output={baseOutput} />);

    expect(getByText('Migration review')).toBeTruthy();
    expect(getByText('new')).toBeTruthy();
  });

  it('shows custom schema fields rather than hiding them behind the raw toggle', () => {
    const { getByText } = render(<StepOutputView output={baseOutput} />);

    expect(getByText('severity')).toBeTruthy();
    expect(getByText('low')).toBeTruthy();
    // Nested values have no better rendering than JSON — but they are shown.
    expect(getByText(/"locks": "ok"/)).toBeTruthy();
  });

  it('shows a deliverable the agent attached from the CLI, not only the one in its output', () => {
    // Attaching from the CLI is the recommended path for bulky content (it
    // never passes through the model), and such a run returns
    // `deliverable: null`. The run graph already draws the artifact on the
    // node; the sidebar showed nothing, which read as "the step produced
    // nothing" — the exact opposite of what happened.
    const attached = {
      id: 'd-1',
      title: 'Fireflies — weekly digest',
      content: '# Transcript\n\n…',
      type: 'fireflies',
      status: 'final',
      stepRunId: 'sr-1',
    } as TicketDeliverable;

    const { getByText } = render(
      <StepOutputView
        output={{ deliverable: null, comment: null, schemaFields: {}, result: 'ok' }}
        latestDeliverable={attached}
      />,
    );

    expect(getByText('Fireflies — weekly digest')).toBeTruthy();
  });

  it('renders a bare output (no comment, no deliverable) without crashing', () => {
    // Native steps (conditions, fan-out) emit little more than a result.
    const { getByText } = render(
      <StepOutputView output={{ schemaFields: {}, result: 'ko' }} />,
    );
    expect(getByText('ko')).toBeTruthy();
  });
});

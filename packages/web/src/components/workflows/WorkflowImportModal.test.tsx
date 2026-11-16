import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { minimalExample, EXAMPLE_REFS } from '@fleex/shared';
import { WorkflowImportModal, IMPORT_VALIDATION_DEBOUNCE_MS } from './WorkflowImportModal';

const dryRun = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  applyWorkflowDryRun: (...args: unknown[]) => dryRun.fn(...args),
}));

beforeEach(() => {
  vi.useFakeTimers();
  dryRun.fn.mockReset();
  dryRun.fn.mockResolvedValue({ errors: [], warnings: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(initialText = '') {
  const onReplace = vi.fn();
  render(<WorkflowImportModal open initialText={initialText} editorSlug="spec-dev-pr" onClose={() => {}} onReplace={onReplace} />);
  return { onReplace };
}

async function type(value: string) {
  fireEvent.change(screen.getByLabelText('Workflow JSON'), { target: { value } });
  await act(async () => { await vi.advanceTimersByTimeAsync(IMPORT_VALIDATION_DEBOUNCE_MS); });
}

const replaceButton = () => screen.getByRole('button', { name: /Replace editor/ }) as HTMLButtonElement;

describe('WorkflowImportModal', () => {
  it('blocks the import on invalid JSON and shows the parser message', async () => {
    setup();
    await type('{ "slug": ');
    expect(screen.getByText(/Invalid JSON:/)).toBeTruthy();
    expect(replaceButton().disabled).toBe(true);
    expect(dryRun.fn).not.toHaveBeenCalled();
  });

  it('blocks the import on an invalid shape and lists each issue with its path', async () => {
    setup();
    const doc = minimalExample(EXAMPLE_REFS) as unknown as Record<string, unknown>;
    delete doc.edges;
    await type(JSON.stringify(doc));
    expect(screen.getByText('$.edges')).toBeTruthy();
    expect(replaceButton().disabled).toBe(true);
    expect(dryRun.fn).not.toHaveBeenCalled();
  });

  it('checks references under the editor slug, says the file slug is ignored, and imports', async () => {
    const { onReplace } = setup();
    const doc = minimalExample(EXAMPLE_REFS);
    await type(JSON.stringify(doc));
    expect(dryRun.fn).toHaveBeenCalledWith(expect.objectContaining({ slug: 'spec-dev-pr' }));
    expect(screen.getByText(/Slug "hello" from file ignored — keeping "spec-dev-pr"/)).toBeTruthy();
    expect(replaceButton().textContent).toBe('Replace editor');
    fireEvent.click(replaceButton());
    expect(onReplace).toHaveBeenCalledWith(doc);
  });

  it('shows unknown references from the dry-run without blocking ("anyway")', async () => {
    dryRun.fn.mockResolvedValue({
      errors: [{ invariant: 'step.agent_ref_exists', severity: 'error', path: '$.steps[0].executorRef', message: 'agent "ghost" does not exist' }],
      warnings: [],
    });
    const { onReplace } = setup();
    await type(JSON.stringify(minimalExample(EXAMPLE_REFS)));
    expect(screen.getByText('agent "ghost" does not exist')).toBeTruthy();
    expect(replaceButton().textContent).toBe('Replace editor anyway');
    fireEvent.click(replaceButton());
    expect(onReplace).toHaveBeenCalled();
  });

  it('still allows the import when the server cannot be reached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    dryRun.fn.mockRejectedValue(new Error('502'));
    setup();
    await type(JSON.stringify(minimalExample(EXAMPLE_REFS)));
    expect(screen.getByText('Could not check references against this workspace')).toBeTruthy();
    expect(replaceButton().disabled).toBe(false);
  });

  it('validates text loaded from a file (initialText)', async () => {
    setup(JSON.stringify(minimalExample(EXAMPLE_REFS)));
    await act(async () => { await vi.advanceTimersByTimeAsync(IMPORT_VALIDATION_DEBOUNCE_MS); });
    expect(dryRun.fn).toHaveBeenCalledTimes(1);
    expect(replaceButton().disabled).toBe(false);
  });

  it('never imports a document that no longer matches the text (debounce window)', async () => {
    const { onReplace } = setup();
    await type(JSON.stringify(minimalExample(EXAMPLE_REFS)));
    expect(replaceButton().disabled).toBe(false);
    // The user edits the JSON: until the new text is checked, Replace must not
    // import the previous version of the document.
    fireEvent.change(screen.getByLabelText('Workflow JSON'), { target: { value: JSON.stringify({ ...minimalExample(EXAMPLE_REFS), name: 'Edited' }) } });
    expect(replaceButton().disabled).toBe(true);
    fireEvent.click(replaceButton());
    expect(onReplace).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(IMPORT_VALIDATION_DEBOUNCE_MS); });
    fireEvent.click(replaceButton());
    expect(onReplace).toHaveBeenCalledWith(expect.objectContaining({ name: 'Edited' }));
  });

  it('does not offer the previous import when the modal is reopened empty', async () => {
    const onReplace = vi.fn();
    const props = { initialText: '', editorSlug: 'spec-dev-pr', onClose: () => {}, onReplace };
    const { rerender } = render(<WorkflowImportModal open {...props} />);
    await type(JSON.stringify(minimalExample(EXAMPLE_REFS)));
    rerender(<WorkflowImportModal open={false} {...props} />);
    rerender(<WorkflowImportModal open {...props} />);
    expect((screen.getByLabelText('Workflow JSON') as HTMLTextAreaElement).value).toBe('');
    expect(replaceButton().disabled).toBe(true);
  });

  it('hints at ⌘V when clipboard read is denied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) },
      configurable: true,
    });
    setup();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' })); });
    expect(screen.getByText(/Clipboard access denied — paste with ⌘V/)).toBeTruthy();
  });
});

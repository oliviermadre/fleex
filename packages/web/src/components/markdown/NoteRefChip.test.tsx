import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';

function setEngine(engine: 'legacy' | 'semantic') {
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, memoryEngine: engine },
  });
}

beforeEach(() => setEngine('semantic'));

afterEach(() => {
  cleanup();
  useScratchpadStore.setState({ selectedScratchpadKey: null });
  setEngine('legacy');
});

const noop = () => {};

// The generic renderer backs the notes, the ticket description and deliverables,
// so a reference resolved here is resolved on all three.
describe('MarkdownRenderer — note references', () => {
  it('navigates to a repo note', () => {
    const { getByRole } = render(
      <MarkdownRenderer content="conventions live in @scratchpad:acme/app" onToggleCheckbox={noop} />,
    );
    fireEvent.click(getByRole('button'));
    expect(useUIStore.getState().activePanel).toBe('scratchpads');
    expect(useScratchpadStore.getState().selectedScratchpadKey).toBe('acme/app');
  });

  it('navigates to the global note', () => {
    const { getByRole } = render(
      <MarkdownRenderer content="see @scratchpad:global" onToggleCheckbox={noop} />,
    );
    fireEvent.click(getByRole('button'));
    expect(useScratchpadStore.getState().selectedScratchpadKey).toBe('__global__');
  });

  it('labels the global note Global rather than its storage key', () => {
    const { container } = render(
      <MarkdownRenderer content="see @scratchpad:global" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('Global');
    expect(container.textContent).not.toContain('__global__');
  });

  it('renders under the legacy engine', () => {
    // Navigating to a note reads no index, so it must not depend on the memory
    // engine — exactly as @ticket: never has.
    setEngine('legacy');
    const { getByRole } = render(
      <MarkdownRenderer content="see @scratchpad:acme/app" onToggleCheckbox={noop} />,
    );
    fireEvent.click(getByRole('button'));
    expect(useScratchpadStore.getState().selectedScratchpadKey).toBe('acme/app');
  });

  it('leaves a value that names no note as plain text', () => {
    const { container, queryByRole } = render(
      <MarkdownRenderer content="see @scratchpad:my-idea" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('@scratchpad:my-idea');
    expect(queryByRole('button')).toBeNull();
  });
});

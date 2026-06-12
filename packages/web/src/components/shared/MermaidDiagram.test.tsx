import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { MermaidDiagram, isMermaidCode, codeNodeToString } from './MermaidDiagram';

// ── Mermaid mock ──────────────────────────────────────────────────────────────
// jsdom can't actually lay out SVG (no getBBox), so the real render() can't run
// here. We mock the module the component dynamically imports and assert that the
// component drives the mermaid API correctly and maps its outcomes to states.

const { initialize, parse, renderFn } = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  renderFn: vi.fn(),
}));

vi.mock('mermaid', () => ({
  default: { initialize, parse, render: renderFn },
}));

beforeEach(() => {
  initialize.mockClear();
  parse.mockClear();
  parse.mockImplementation(async () => true);
  renderFn.mockClear();
  renderFn.mockImplementation(async (id: string, code: string) => ({
    svg: `<svg data-id="${id}">${code}</svg>`,
  }));
});

afterEach(cleanup);

describe('isMermaidCode', () => {
  it('matches only the mermaid language class', () => {
    expect(isMermaidCode('hljs language-mermaid')).toBe(true);
    expect(isMermaidCode('language-mermaid')).toBe(true);
    expect(isMermaidCode('hljs language-js')).toBe(false);
    expect(isMermaidCode('language-mermaidjs')).toBe(false);
    expect(isMermaidCode(undefined)).toBe(false);
  });
});

describe('codeNodeToString', () => {
  it('flattens string and nested node children', () => {
    expect(codeNodeToString('graph TD; A-->B;')).toBe('graph TD; A-->B;');
    expect(codeNodeToString(['a', 'b'])).toBe('ab');
    expect(codeNodeToString(123)).toBe('123');
    expect(codeNodeToString(null)).toBe('');
  });
});

describe('MermaidDiagram', () => {
  it('renders the SVG returned by mermaid for a valid diagram (AC1)', async () => {
    const { container } = render(<MermaidDiagram code="graph TD; A-->B;" colorMode="light" />);
    // Loading placeholder first
    expect(screen.getByRole('status').textContent).toContain('Rendu du diagramme');
    // Then the SVG once the async render resolves
    const svg = await screen.findByText('graph TD; A-->B;');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(container.querySelector('svg')).not.toBeNull();
    expect(parse).toHaveBeenCalledWith('graph TD; A-->B;');
  });

  it('shows a clear error with a source toggle on invalid syntax (AC2)', async () => {
    parse.mockImplementation(async () => {
      throw new Error('Parse error on line 1');
    });
    render(<MermaidDiagram code="graph TD; A--" colorMode="light" />);

    expect(await screen.findByText('Diagramme Mermaid invalide')).toBeTruthy();
    expect(screen.getByText('Parse error on line 1')).toBeTruthy();
    // Source is hidden until toggled
    expect(screen.queryByText('graph TD; A--')).toBeNull();
    fireEvent.click(screen.getByText('Voir le code source'));
    expect(screen.getByText('graph TD; A--')).toBeTruthy();
  });

  it('re-renders with the dark theme when colorMode changes (AC3)', async () => {
    const { rerender } = render(<MermaidDiagram code="graph TD; A-->B;" colorMode="light" />);
    await screen.findByText('graph TD; A-->B;');
    expect(initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: 'default', securityLevel: 'strict' }),
    );

    rerender(<MermaidDiagram code="graph TD; A-->B;" colorMode="dark" />);
    await screen.findByText('graph TD; A-->B;');
    expect(initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: 'dark', securityLevel: 'strict' }),
    );
  });

  it('always renders with securityLevel strict (AC6)', async () => {
    render(<MermaidDiagram code="graph TD; A-->B;" colorMode="light" />);
    await screen.findByText('graph TD; A-->B;');
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', startOnLoad: false }),
    );
  });

  it('gives each diagram instance a unique render id (AC7)', async () => {
    // Mount sequentially in the SAME React root: useId() is only unique within a
    // single root, and vitest serializes concurrent mocked dynamic imports, so a
    // staggered mount is the deterministic way to exercise two live instances.
    const { rerender } = render(
      <>
        <MermaidDiagram key="a" code="graph TD; A-->B;" colorMode="light" />
      </>,
    );
    await waitFor(() => expect(renderFn).toHaveBeenCalledTimes(1));
    rerender(
      <>
        <MermaidDiagram key="a" code="graph TD; A-->B;" colorMode="light" />
        <MermaidDiagram key="b" code="graph TD; C-->D;" colorMode="light" />
      </>,
    );
    await waitFor(() => expect(renderFn).toHaveBeenCalledTimes(2));
    const ids = renderFn.mock.calls.map((c) => c[0] as string);
    expect(new Set(ids).size).toBe(ids.length);
    // Ids must be valid DOM/CSS selectors (no colons from useId) to avoid the
    // documented collision risk when mermaid injects nodes keyed by id.
    for (const id of ids) expect(id).toMatch(/^mermaid-[A-Za-z0-9]+$/);
  });
});

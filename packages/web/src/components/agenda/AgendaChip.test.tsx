import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { AgendaItem } from '@fleex/shared';
import { ChipName, chipHoverTitle } from './AgendaChip';

afterEach(cleanup);

const pr = {
  id: 'pr.merged:1', type: 'pr.merged', shape: 'point', start: '2026-11-05T14:03:00Z',
  title: 'odys-travel/agentic-dmc-2#77', prRef: 'odys-travel/agentic-dmc-2#77',
  ticket: { id: 'tk', displayId: 766, title: 'Skill Discovery Call', boardId: 'b', status: 'reviewing', tags: [], epicIds: [], repos: [] },
} as unknown as AgendaItem;

describe('merged PR chip', () => {
  it('leads with the linked ticket so you know what the PR was for', () => {
    const { container } = render(<div><ChipName item={pr} /></div>);
    expect(container.textContent).toContain('#766');
    expect(container.textContent).toContain('Skill Discovery Call');
    expect(container.textContent).toContain('agentic-dmc-2#77');
    expect(chipHoverTitle(pr)).toBe('#766 Skill Discovery Call · odys-travel/agentic-dmc-2#77');
  });

  it('a PR with no matched ticket keeps its repo#number', () => {
    const { container } = render(<div><ChipName item={{ ...pr, ticket: null } as unknown as AgendaItem} /></div>);
    expect(container.textContent).toBe('odys-travel/agentic-dmc-2#77');
  });
});

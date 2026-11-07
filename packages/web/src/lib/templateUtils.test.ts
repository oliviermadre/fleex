import { describe, it, expect } from 'vitest';
import type { Ticket } from '@fleex/shared';
import { buildWorkspaceContext } from './templateUtils';

/**
 * Workspace actions (`{{workspace_path}}`, `{{ticket_slug}}`…) must target the
 * folder the server created — fixed at creation, never re-derived from the
 * current title — for new tickets (`<n>-<slug>`) and for tickets that kept their
 * former folder (`<id6>-<slug>`). `ticket_slug` used to be cut out of the folder
 * name at a fixed offset, which only fit the 6-char id prefix.
 */
const ticket = (over: Partial<Ticket>) =>
  ({ id: 'e3265423-0182-483e-81cd-62fdb54841e9', displayId: 654, title: 'Renamed later', slug: 'foo', workspaceDir: null, branchName: null, ...over }) as Ticket;

describe('buildWorkspaceContext', () => {
  it('a ticket named at creation: `<n>-<slug>`, whatever its current title', () => {
    expect(buildWorkspaceContext(ticket({}), '/base')).toEqual({
      workspace_path: '/base/workspaces/654-foo',
      workspace_name: '654-foo',
      ticket_id: 'e3265423-0182-483e-81cd-62fdb54841e9',
      ticket_slug: 'foo',
      ticket_display_id: '654',
    });
  });

  it('a ticket that kept its former folder targets it', () => {
    const ctx = buildWorkspaceContext(ticket({ slug: 'old', workspaceDir: 'e32654-old' }), '/base');
    expect(ctx.workspace_path).toBe('/base/workspaces/e32654-old');
    expect(ctx.ticket_slug).toBe('old');
  });
});

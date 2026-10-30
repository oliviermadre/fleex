/** One-shot panels a Work URL can open next to the task (`?panel=`, see RouterSync). */
export type WorkUrlPanel = 'deliv' | 'mentions' | 'timeline';

/**
 * Where each tab of the retired ticket-detail screen lives in the Work view.
 * Callers still name a tab (a deliverable notification → `deliverables`); old
 * /tickets/board/:b/ticket/:id[/:tab] links redirect through the same table.
 */
const TAB_TARGET: Record<string, { suffix?: string; panel?: WorkUrlPanel }> = {
  description: {},
  comments: {},
  deliverables: { panel: 'deliv' },
  mentions: { panel: 'mentions' },
  workflow: { suffix: '/workflow' },
  activity: { panel: 'timeline' },
};

export type TicketLinkTab = 'description' | 'comments' | 'deliverables' | 'mentions' | 'workflow' | 'activity';

/**
 * Build an in-app deep link to a ticket: the Work view, on the center mode or
 * panel matching `tab` — `/work/{ticketId}[/workflow][?panel=…]`. The ticket is
 * shown (pinned) whatever the Work queue filters.
 */
export function ticketLink(ticketId: string, tab?: TicketLinkTab | string | null): string {
  const target = (tab && TAB_TARGET[tab]) || {};
  return `/work/${ticketId}${target.suffix ?? ''}${target.panel ? `?panel=${target.panel}` : ''}`;
}

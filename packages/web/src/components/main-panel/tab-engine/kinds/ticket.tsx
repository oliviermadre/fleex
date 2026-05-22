import type { Ticket } from '@fleex/shared';
import { TicketDetail } from '../../../tickets/TicketDetail';
import { registerTabKind } from '../registry';
import type { TabDescriptor, TabIconProps, TabContentProps } from '../types';

// ——— Icon ———

function TicketIcon(_props: TabIconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M5 5h6M5 8h4M5 11h2" />
    </svg>
  );
}

// ——— Content ———

function TicketContent({ tab }: TabContentProps) {
  const ticketId = tab.meta.ticketId as string;
  return <TicketDetail ticketId={ticketId} embedded />;
}

// ——— Registration ———

registerTabKind('ticket', {
  Icon: TicketIcon,
  Content: TicketContent,
  defaultCapabilities: { closable: false, renamable: false, orderable: true },
});

// ——— Builder ———

export function buildTicketTab(ticket: Ticket): TabDescriptor {
  return {
    key: `t:${ticket.id}`,
    kind: 'ticket',
    label: 'Ticket Details',
    capabilities: { closable: false, renamable: false, orderable: true },
    meta: { ticketId: ticket.id },
  };
}

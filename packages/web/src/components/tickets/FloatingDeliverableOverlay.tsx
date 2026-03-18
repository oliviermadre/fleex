import { useEffect } from 'react';
import type { TicketDeliverable, TicketWsMessage } from '@fleex/shared';
import { useUIStore } from '../../stores/uiStore';
import { ticketWs } from '../../services/websocket';
import { FloatingDeliverablePanel } from './FloatingDeliverablePanel';

export function FloatingDeliverableOverlay() {
  const floatingDeliverableIds = useUIStore((s) => s.floatingDeliverableIds);
  const floatingDeliverables = useUIStore((s) => s.floatingDeliverables);
  const floatingPanelOrder = useUIStore((s) => s.floatingPanelOrder);
  const focusedFloatingPanelId = useUIStore((s) => s.focusedFloatingPanelId);
  const removeFloatingDeliverable = useUIStore((s) => s.removeFloatingDeliverable);
  const bringDeliverableToFront = useUIStore((s) => s.bringDeliverableToFront);
  const clearFloatingPanelFocus = useUIStore((s) => s.clearFloatingPanelFocus);
  const updateFloatingDeliverable = useUIStore((s) => s.updateFloatingDeliverable);

  // Click-outside detection: clear focus when clicking outside all floating panels
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-floating-panel]')) {
        clearFloatingPanelFocus();
      }
    }
    window.addEventListener('mousedown', handleMouseDown);
    return () => window.removeEventListener('mousedown', handleMouseDown);
  }, [clearFloatingPanelFocus]);

  // WebSocket listener: keep floating deliverables content fresh
  useEffect(() => {
    const decoder = new TextDecoder();
    const unsub = ticketWs.onMessage((buf: ArrayBuffer) => {
      try {
        const msg = JSON.parse(decoder.decode(buf)) as TicketWsMessage;
        if (msg.type === 'deliverable:updated') {
          const d = msg.data as TicketDeliverable;
          updateFloatingDeliverable(d);
        }
      } catch {
        // ignore
      }
    });
    return unsub;
  }, [updateFloatingDeliverable]);

  if (floatingDeliverableIds.length === 0) return null;

  return (
    <>
      {floatingDeliverableIds.map((id, index) => {
        const deliverable = floatingDeliverables[id];
        if (!deliverable) return null;
        return (
          <FloatingDeliverablePanel
            key={id}
            deliverable={deliverable}
            onClose={() => removeFloatingDeliverable(id)}
            zIndex={45 + Math.max(0, floatingPanelOrder.indexOf(id))}
            initialOffset={index * 30}
            onFocus={() => bringDeliverableToFront(id)}
            isFocused={focusedFloatingPanelId === id}
          />
        );
      })}
    </>
  );
}

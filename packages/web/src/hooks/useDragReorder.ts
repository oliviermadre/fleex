import { useState, useCallback } from 'react';
import type { DragEvent } from 'react';

interface DragReorderProps {
  draggable: true;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

/**
 * Encapsulates the drag-to-reorder interaction for a list of identifiable
 * items. `mimeType` scopes the drag payload so distinct lists cannot accept
 * each other's drops. The caller renders the drop-edge indicators from the
 * returned `dragOverId` / `dropEdge`.
 */
export function useDragReorder<T extends { id: string }>(options: {
  items: T[];
  onReorder: (items: T[]) => void;
  mimeType: string;
}): {
  dragOverId: string | null;
  dropEdge: 'top' | 'bottom';
  getDragProps: (id: string) => DragReorderProps;
} {
  const { items, onReorder, mimeType } = options;
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<'top' | 'bottom'>('bottom');

  const getDragProps = useCallback(
    (id: string): DragReorderProps => ({
      draggable: true,
      onDragStart: (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(mimeType, id);
        (e.currentTarget as HTMLElement).style.opacity = '0.4';
      },
      onDragEnd: (e) => {
        setDragOverId(null);
        (e.currentTarget as HTMLElement).style.opacity = '';
      },
      onDragOver: (e) => {
        if (!e.dataTransfer.types.includes(mimeType)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        setDropEdge(e.clientY < midY ? 'top' : 'bottom');
        setDragOverId(id);
      },
      onDragLeave: (e) => {
        if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
        if (dragOverId === id) setDragOverId(null);
      },
      onDrop: (e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData(mimeType);
        setDragOverId(null);
        if (!draggedId || draggedId === id) return;

        const next = [...items];
        const fromIdx = next.findIndex((it) => it.id === draggedId);
        if (fromIdx === -1) return;
        const moved = next.splice(fromIdx, 1)[0];
        if (!moved) return;
        let toIdx = next.findIndex((it) => it.id === id);
        if (toIdx === -1) return;
        if (dropEdge === 'bottom') toIdx += 1;
        next.splice(toIdx, 0, moved);
        onReorder(next);
      },
    }),
    [items, onReorder, mimeType, dragOverId, dropEdge]
  );

  return { dragOverId, dropEdge, getDragProps };
}

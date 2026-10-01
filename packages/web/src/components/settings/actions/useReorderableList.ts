import { useCallback, useState } from 'react';
import type React from 'react';

/**
 * HTML5 drag-to-reorder for a vertical list, with a top/bottom drop edge so the
 * insertion line can be drawn. Factored out of the two Settings tabs that each
 * carried a copy of it; `mime` keeps two lists on one screen from accepting
 * each other's rows.
 */
export function useReorderableList<T extends { id: string }>(
  items: readonly T[],
  onReorder: (next: T[]) => void,
  mime = 'application/x-fleex-reorder',
) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<'top' | 'bottom'>('bottom');
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const rowProps = useCallback(
    (id: string) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(mime, id);
        setDraggingId(id);
      },
      onDragEnd: () => {
        setDraggingId(null);
        setDragOverId(null);
      },
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(mime)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setDropEdge(e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom');
        setDragOverId(id);
      },
      onDragLeave: (e: React.DragEvent) => {
        if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
        setDragOverId((cur) => (cur === id ? null : cur));
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData(mime);
        setDragOverId(null);
        setDraggingId(null);
        if (!draggedId || draggedId === id) return;
        const next = [...items];
        const from = next.findIndex((x) => x.id === draggedId);
        if (from < 0) return;
        const [moved] = next.splice(from, 1);
        let to = next.findIndex((x) => x.id === id);
        if (to < 0 || !moved) return;
        if (dropEdge === 'bottom') to += 1;
        next.splice(to, 0, moved);
        onReorder(next);
      },
    }),
    [items, onReorder, mime, dropEdge],
  );

  /** Which edge of which row shows the insertion line, if any. */
  const dropIndicator = (id: string): 'top' | 'bottom' | null => (dragOverId === id ? dropEdge : null);

  return { rowProps, dropIndicator, draggingId };
}

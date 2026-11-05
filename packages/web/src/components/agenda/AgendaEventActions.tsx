import type { AgendaItem } from '@fleex/shared';
import { Button } from '../ui/Button';
import { EditIcon, RepeatIcon, TrashIcon } from '../ui/icons/AgendaIcons';
import { deleteEventWithUndo, useEventEditor } from './EventEditor';

/**
 * E1: edit / delete a free event from its card. A recurring event is edited
 * and deleted as a whole series (the card says so). The forms live at page
 * level (`EventEditorHost`): the card closes first.
 */
export function AgendaEventActions({ item, onClose }: { item: AgendaItem; onClose: () => void }) {
  const ev = item.event;
  if (!ev) return null;
  const recurring = !!ev.recurrence;
  return (
    <div className="space-y-1.5 border-t border-[var(--theme-border)] pt-2">
      {recurring && (
        <div className="flex items-center gap-1 text-[var(--theme-text-muted)]">
          <RepeatIcon size={11} /> Edits and deletion apply to the whole series.
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          className="inline-flex items-center gap-1"
          onClick={() => { onClose(); useEventEditor.getState().openEdit(ev); }}
        >
          <EditIcon size={12} /> {recurring ? 'Edit series' : 'Edit'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="inline-flex items-center gap-1"
          onClick={() => {
            onClose();
            if (recurring) useEventEditor.getState().askDelete(ev);
            else void deleteEventWithUndo(ev);
          }}
        >
          <TrashIcon size={12} /> {recurring ? 'Delete series' : 'Delete'}
        </Button>
      </div>
    </div>
  );
}

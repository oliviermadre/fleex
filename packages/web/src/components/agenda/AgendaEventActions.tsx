import type { AgendaItem } from '@fleex/shared';
import { Button } from '../ui/Button';
import { EditIcon, TrashIcon } from '../ui/icons/AgendaIcons';
import { deleteEventWithUndo, useEventEditor } from './EventEditor';

/**
 * E1: edit / delete a free event, as two buttons of the card footer. A
 * recurring event is edited and deleted as a whole series (the card body says
 * so). The forms live at page level (`EventEditorHost`): the card closes first.
 */
export function AgendaEventActions({ item, onClose, primary = true }: { item: AgendaItem; onClose: () => void; primary?: boolean }) {
  const ev = item.event;
  if (!ev) return null;
  const recurring = !!ev.recurrence;
  return (
    <>
      <Button
        size="sm"
        variant={primary ? 'primary' : 'secondary'}
        className="gap-1"
        onClick={() => { onClose(); useEventEditor.getState().openEdit(ev); }}
      >
        <EditIcon size={12} /> {recurring ? 'Edit series' : 'Edit'}
      </Button>
      <Button
        size="sm"
        className="gap-1"
        onClick={() => {
          onClose();
          if (recurring) useEventEditor.getState().askDelete(ev);
          else void deleteEventWithUndo(ev);
        }}
      >
        <TrashIcon size={12} /> {recurring ? 'Delete series' : 'Delete'}
      </Button>
    </>
  );
}

import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import type { Dropped } from './floorFile';

/** Where a floor read from a file goes: in place of this one, or in hand to be put down beside what is there. */
export function FloorImportChoice({ name, incoming, here, onReplace, onHand, onClose }: {
  name: string; incoming: number; here: number; onReplace: () => void; onHand: () => void; onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} maxWidth="max-w-md">
      <div className="flex flex-col gap-3">
        <div className="text-base font-semibold text-[var(--theme-text-primary)]">Import {name}</div>
        <p className="text-sm text-[var(--theme-text-secondary)]">
          {incoming} machine{incoming === 1 ? '' : 's'} to import. Replace the {here} machine{here === 1 ? '' : 's'} of this floor (Undo brings them back; their tickets fall on the floor), or take them in hand and put them down where there is room.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onHand}>Place it in hand</Button>
          <Button variant="primary" onClick={onReplace}>Replace the floor</Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * What an import took off the machines because this instance does not have it, machine by machine: a persona, a
 * skill, a model, a board. The machines are all there; "Go to it" selects one and brings it to the middle of the view.
 */
export function FloorImportReport({ total, dropped, unset, onGo, onClose }: { total: number; dropped: Dropped[]; unset: number; onGo: (machineId: string) => void; onClose: () => void }) {
  const rows = new Map<string, { name: string; what: string[]; nothing: boolean }>();
  for (const d of dropped) {
    const r = rows.get(d.machineId) ?? { name: d.name, what: [], nothing: false };
    if (d.nothing) r.nothing = true; else r.what.push(d.what);
    rows.set(d.machineId, r);
  }
  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg">
      <div className="flex flex-col gap-3">
        <div className="text-base font-semibold text-[var(--theme-text-primary)]">Floor imported: {total} machine{total === 1 ? '' : 's'}</div>
        <p className="text-sm text-[var(--theme-text-secondary)]">
          {unset ? `${unset} station${unset === 1 ? ' needs' : 's need'} setting up: until then ${unset === 1 ? 'it takes' : 'they take'} tickets in and start nothing. ` : ''}
          What this instance does not have was taken off:
        </p>
        <ul className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto text-sm" aria-label="Taken off on import">
          {[...rows].map(([id, r]) => (
            <li key={id} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1">
                <b className="text-[var(--theme-text-primary)]">{r.name}</b>
                <span className="text-[var(--theme-text-secondary)]">{r.what.length ? `: ${r.what.join(', ')}` : ''}</span>
                {r.nothing && <span className="text-[var(--theme-warning)]">{r.what.length ? '; ' : ': '}its condition on a board is left with none, so it takes nothing</span>}
              </span>
              <Button size="sm" variant="ghost" onClick={() => onGo(id)}>Go to it</Button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end"><Button variant="primary" onClick={onClose}>OK</Button></div>
      </div>
    </Modal>
  );
}

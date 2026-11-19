import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { useFactoryStore } from './factoryStore';
import { lampLines, lampOf } from './machineArt';

export interface LampTipHandle {
  /** Show what a machine's light says, next to a point given in the floor's own pixels. */
  show(machineId: string, x: number, y: number): void;
  hide(): void;
}

/**
 * What a machine's light says, in words, while the pointer is on it: on or off, what runs, what is set aside and
 * why, whether the exit is clear, and what a click would do. Like the ticket card, only this re-renders as the
 * pointer moves.
 */
export const FactoryLampTip = forwardRef<LampTipHandle>(function FactoryLampTip(_, ref) {
  const [at, setAt] = useState<{ id: string; x: number; y: number } | null>(null);
  const el = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({
    show: (id, x, y) => setAt((cur) => (cur && cur.id === id && Math.abs(cur.x - x) < 2 && Math.abs(cur.y - y) < 2 ? cur : { id, x, y })),
    hide: () => setAt(null),
  }), []);
  const machine = useFactoryStore((s) => (at ? s.layout?.machines.find((m) => m.id === at.id) ?? null : null));
  const tickets = useFactoryStore((s) => s.snapshot?.tickets);

  useLayoutEffect(() => {
    const node = el.current, host = node?.parentElement;
    if (!node || !host || !at) return;
    const w = node.offsetWidth, h = node.offsetHeight;
    const left = at.x + 16 + w > host.clientWidth ? Math.max(4, at.x - 12 - w) : at.x + 16;
    const top = at.y + 16 + h > host.clientHeight ? Math.max(4, at.y - 12 - h) : at.y + 16;
    node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  });

  if (!at || !machine || machine.kind !== 'station') return null;
  const inside = (tickets ?? []).filter((t) => t.machineId === machine.id), lamp = lampOf(machine, inside), [head, ...lines] = lampLines(machine, inside);
  return (
    <div ref={el} role="tooltip" className="pointer-events-none absolute left-0 top-0 z-10 flex w-max max-w-[280px] flex-col gap-0.5 rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2.5 py-2 text-[11px] text-[var(--theme-text-secondary)] shadow-xl">
      <div className={cn('text-xs font-semibold', lamp === 'off' ? 'text-[var(--theme-danger)]' : lamp === 'call' ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-success)]')}>{machine.name || 'Station'}: {head}</div>
      {lines.map((l, i) => <div key={l} className={i === lines.length - 1 ? 'text-[var(--theme-text-muted)]' : undefined}>{l}</div>)}
    </div>
  );
});

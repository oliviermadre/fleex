import { cn } from '../lib/cn';
import { FIcon } from './icons';
import { machineIcon, machineKind } from './FactoryMachinePopup';
import { TicketToken, typeLabel } from './FactoryTicketMeta';
import { DESK_COLOR, KIND_LOOK, kindOf, MACHINE_ICONS } from './machineArt';
import { armColor } from './armRules';
import { PORT_COLOR } from './teleport';
import { TYPE_COLORS } from './renderer';
import type { FactoryTicketInfo, MachineSpec } from './types';

/** What the avatar stands for: the floor, build mode, a ticket, a machine, or several things at once. */
export type AvatarOf =
  | { kind: 'floor' } | { kind: 'build' }
  | { kind: 'ticket'; info: FactoryTicketInfo | null }
  | { kind: 'machine'; machine: MachineSpec }
  | { kind: 'many'; count: number; of: 'tickets' | 'machines' };

/* what moves in an avatar: little, and slowly; nothing at all for whoever asked for less motion */
const CSS = `
@keyframes fxav-tilt { 0%, 100% { transform: rotate(-5deg); } 25% { transform: rotate(3deg) translateY(-3px); } 50% { transform: rotate(6deg); } 75% { transform: rotate(-2deg) translateY(2px); } }
@keyframes fxav-bob { 50% { transform: translateY(-3px); } }
@keyframes fxav-pulse { 50% { opacity: 0.35; } }
@keyframes fxav-march { to { stroke-dashoffset: -21; } }
@keyframes fxav-slide { to { transform: translateX(30px); } }
@keyframes fxav-sweep { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(-62deg); } }
@keyframes fxav-smoke { to { transform: translate(9px, -28px); opacity: 0; } }
.fxav-tilt { animation: fxav-tilt 5s ease-in-out infinite; }
.fxav-bob { animation: fxav-bob 4s ease-in-out infinite; }
.fxav-pulse { animation: fxav-pulse 2s ease-in-out infinite; }
.fxav-march { animation: fxav-march 1.6s linear infinite; }
.fxav-slide { animation: fxav-slide 1s linear infinite; }
.fxav-slide.fast { animation-duration: 0.5s; }
.fxav-sweep { transform-origin: 34px 70px; animation: fxav-sweep 3.2s ease-in-out infinite; }
.fxav-smoke { animation: fxav-smoke 3s ease-out infinite; }
.fxav-smoke.late { animation-delay: 1.5s; }
@media (prefers-reduced-motion: reduce) { [class*="fxav-"] { animation: none !important; } }
`;
const FACTORY = ['M3 20V11l5 3v-3l5 3V6h5v14z', 'M2 20h20'];
const HAT = ['M5 15.5a7 7 0 0 1 14 0z', 'M2.5 15.5h19v2.5h-19z', 'M10.2 8.8V5.5h3.6v3.3', 'M7.3 10.5l1.7 5M16.700 10.500l-1.700 5'];
const STACK = ['M12 4l8 4-8 4-8-4z', 'M4 12l8 4 8-4', 'M4 16l8 4 8-4'];
const EXIT = ['M4 12h11M11 7l5 5-5 5', 'M20 4v16'];

/** A sign as strokes in a 24 by 24 box, drawn large. */
const Glyph = ({ paths, hue, size = 84, className }: { paths: string[]; hue: string; size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={hue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{paths.map((d) => <path key={d} d={d} />)}</svg>
);

/** What a machine looks like at work, in a box of 100 by 100. */
function Machine({ m, hue }: { m: MachineSpec; hue: string }) {
  if (m.kind === 'station') {
    const run = kindOf(m);
    if (run) return <Glyph paths={MACHINE_ICONS[run]} hue={hue} className="fxav-bob" />;
    if (m.exec === 'human_gate') return <Glyph paths={MACHINE_ICONS.human_gate} hue={hue} className="fxav-bob" />;
  }
  if (m.kind === 'belt') return (
    <svg width="132" height="100" viewBox="0 0 132 100" aria-hidden="true">
      <rect x="0" y="30" width="132" height="40" fill="var(--theme-bg-overlay)" /><path d="M0 32h132M0 68h132" stroke="var(--theme-border-input)" strokeWidth="5" />
      <g className={cn('fxav-slide', m.fast && 'fast')}>{[-1, 0, 1, 2, 3, 4].map((i) => <path key={i} d={`M${6 + i * 30} 39 l10 11 -10 11`} fill="none" stroke={m.fast ? 'var(--theme-accent)' : 'var(--theme-text-secondary)'} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />)}</g>
      {m.set !== undefined && <><rect x="58" y="14" width="16" height="72" rx="4" fill="var(--theme-bg-base)" stroke={hue} strokeWidth="3" />{m.toll && <circle cx="66" cy="14" r="6" fill="var(--theme-danger)" />}</>}
    </svg>
  );
  if (m.kind === 'arm') return (
    <svg width="100" height="100" viewBox="0 0 100 100" aria-hidden="true">
      <g className="fxav-sweep"><path d="M34 70 L80 30" stroke="var(--theme-border-input)" strokeWidth="14" strokeLinecap="round" /><path d="M34 70 L80 30" stroke={hue} strokeWidth="3.5" strokeLinecap="round" /><circle cx="80" cy="30" r="10" fill="var(--theme-bg-base)" stroke="var(--theme-text-primary)" strokeWidth="3" /></g>
      <circle cx="34" cy="70" r="13" fill="var(--theme-bg-overlay)" stroke={hue} strokeWidth="3.500" />
    </svg>
  );
  if (m.kind === 'zone') { const lock = m.release === 'auto' ? 'var(--theme-success)' : 'var(--theme-danger)'; return (
    <svg width="100" height="100" viewBox="0 0 100 100" aria-hidden="true">
      <rect className="fxav-march" x="12" y="12" width="76" height="76" rx="6" fill="none" stroke={hue} strokeWidth="3" strokeDasharray="12 9" />
      <rect x="38" y="48" width="24" height="20" rx="4" fill={lock} /><path d={m.release === 'auto' ? 'M43 48v-7a7 7 0 0 1 14 0v1' : 'M43 48v-6a7 7 0 0 1 14 0v6'} fill="none" stroke={lock} strokeWidth="4" strokeLinecap="round" />
    </svg>
  ); }
  if (m.kind === 'exit') return (
    <svg width="100" height="100" viewBox="0 0 100 100" aria-hidden="true">
      <rect className="fxav-pulse" x="14" y="14" width="72" height="72" rx="12" fill="none" stroke={hue} strokeOpacity="0.3" strokeWidth="12" /><rect x="14" y="14" width="72" height="72" rx="12" fill="none" stroke={hue} strokeWidth="3" />
      <g transform="translate(28 28) scale(1.85)" fill="none" stroke={hue} strokeWidth="2.200" strokeLinecap="round" strokeLinejoin="round">{EXIT.map((d) => <path key={d} d={d} />)}</g>
    </svg>
  );
  if (m.kind === 'teleporter') return (
    <svg width="100" height="100" viewBox="0 0 100 100" aria-hidden="true">
      <rect x="14" y="14" width="72" height="72" rx="14" fill="var(--theme-bg-base)" stroke={hue} strokeWidth="3" strokeDasharray={m.role === 'arrival' ? '22 12' : undefined} />
      <circle className="fxav-pulse" cx="50" cy="50" r="24" fill="none" stroke={hue} strokeOpacity="0.5" strokeWidth="8" /><circle cx="50" cy="50" r="15" fill="none" stroke={hue} strokeWidth="3" />
    </svg>
  );
  return <span className="fxav-bob" style={{ color: hue }}><FIcon name={machineIcon(m)} size={80} /></span>;
}

/** The colour a machine's avatar glows in: its kind's hue where it has one, its own colour for an arm or a teleporter. */
function hueOf(m: MachineSpec): string {
  if (m.kind === 'station') { const run = kindOf(m); return run ? KIND_LOOK[run].hue : m.exec === 'human_gate' ? 'var(--theme-warning)' : 'var(--theme-success)'; }
  if (m.kind === 'arm') return armColor(m, { plain: '#a1a1aa', sorts: '#facc15' });
  if (m.kind === 'teleporter') return m.color ?? PORT_COLOR;
  if (m.kind === 'belt') return m.set !== undefined ? '#f472b6' : '#a1a1aa';
  if (m.kind === 'desk') return DESK_COLOR;
  return m.kind === 'zone' ? (m.inbound ? 'var(--theme-accent)' : '#60a5fa') : m.kind === 'exit' ? 'var(--theme-success)' : '#a1a1aa';
}

/**
 * The portrait of what is selected, against the command card: the floor or build mode when nothing is, a ticket as
 * its own object, large and gently tilting before a glow of its colour, a machine as what it does, or a stack with
 * a count for several things.
 */
export function FactoryAvatar({ of, className }: { of: AvatarOf; className?: string }) {
  let hue = 'var(--theme-accent)', label = 'Factory', body: React.ReactNode;
  if (of.kind === 'floor') body = (
    <span className="relative"><Glyph paths={FACTORY} hue={hue} className="fxav-bob" />
      <span className="fxav-smoke absolute left-[60px] top-[14px] h-2 w-2 rounded-full opacity-50" style={{ background: hue }} /><span className="fxav-smoke late absolute left-[60px] top-[14px] h-1.5 w-1.5 rounded-full opacity-40" style={{ background: hue }} />
    </span>
  );
  else if (of.kind === 'build') { hue = 'var(--theme-warning)'; label = 'Build'; body = <Glyph paths={HAT} hue={hue} className="fxav-bob" />; }
  else if (of.kind === 'ticket') {
    hue = TYPE_COLORS[of.info?.type ?? ''] ?? '#8b949e'; label = `${of.info ? `#${of.info.displayId} ` : ''}${typeLabel(of.info)}`;
    body = <span className="fxav-tilt"><TicketToken info={of.info ? { ...of.info, favorite: false } : null} size={72} /></span>;
  } else if (of.kind === 'machine') { hue = hueOf(of.machine); label = machineKind(of.machine); body = <Machine m={of.machine} hue={hue} />; }
  else {
    hue = of.of === 'tickets' ? '#818cf8' : '#a1a1aa'; label = of.of === 'tickets' ? 'Tickets' : 'Machines';
    body = (
      <span className="relative"><Glyph paths={STACK} hue={hue} className="fxav-bob" />
        <span className="absolute -right-1 top-1 grid h-8 min-w-8 place-items-center rounded-full px-1.5 font-mono text-sm font-bold text-[var(--theme-bg-base)]" style={{ background: hue }}>{of.count}</span>
      </span>
    );
  }
  return (
    <div className={cn('relative overflow-hidden rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)]', className)} role="img" aria-label={`${label}${of.kind === 'many' ? `: ${of.count}` : ''}`}>
      <style>{CSS}</style>
      {/* a glow of its colour, fading out */}
      <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 50% 44%, color-mix(in srgb, ${hue} 40%, transparent), color-mix(in srgb, ${hue} 11%, transparent) 55%, transparent)` }} />
      <div className="absolute inset-x-0 bottom-5 top-0 grid place-items-center overflow-hidden">{body}</div>
      {of.kind === 'build' && <div className="absolute inset-x-0 bottom-[22px] h-2" style={{ background: 'repeating-linear-gradient(45deg, #eab308 0 7px, #18181b 7px 14px)' }} />}
      <div className="absolute inset-x-1 bottom-1.5 truncate text-center font-mono text-[9px] font-bold uppercase tracking-wider" style={{ color: hue }}>{label}</div>
    </div>
  );
}

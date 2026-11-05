/**
 * Line icons of the /agenda page (labels, chips, popovers). Same frame as
 * AnnotationIcons (24 × 24, round caps, `currentColor`), so the label hue tints
 * them. Existing icons are re-exported under an agenda name rather than redrawn.
 * Never emoji or Unicode glyphs: they render differently on every OS.
 */
import type { ComponentType } from 'react';
import { Icon, type IconProps, CircleCheckIcon, PinIcon, PlusIcon } from './AnnotationIcons';
import { CancelIcon, CheckIcon, ChevronLeftIcon, ChevronDownIcon, GripIcon, ReopenIcon } from './TodoIcons';
import { ExternalLinkIcon } from '../../sidebar/icons';
import { PrimitiveIcon, RoutineIcon } from '../../../lib/primitives';

export type { IconProps };
/** What `AgendaLabel.icon` holds: any icon taking a size and a class. */
export type AgendaIconComponent = ComponentType<IconProps>;

export { CircleCheckIcon, PinIcon, PlusIcon, CancelIcon, CheckIcon, ChevronLeftIcon, ChevronDownIcon, GripIcon, ReopenIcon, ExternalLinkIcon };

/** Calendar page: the agenda itself. */
export function CalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
      <path d="M8 2.5v4M16 2.5v4M3 10h18" />
    </Icon>
  );
}

/** A ticket stub with a plus: ticket created. */
export function TicketPlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8a2 2 0 0 0 2-2V5h14v1a2 2 0 0 0 2 2v8a2 2 0 0 0-2 2v1H5v-1a2 2 0 0 0-2-2z" />
      <path d="M12 9v6M9 12h6" />
    </Icon>
  );
}

/** Flag on a pole: due date. */
export function FlagIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </Icon>
  );
}

/** The routine loop arrows, untinted (the label hue colours them). */
export function RoutineRunIcon({ size = 14, className }: IconProps) {
  return <RoutineIcon size={size} className={className} tinted={false} strokeWidth={1.75} />;
}

/** Workflow nodes graph, untinted. */
export function WorkflowRunIcon({ size = 14, className }: IconProps) {
  return <PrimitiveIcon kind="workflow" size={size} className={className} tinted={false} />;
}

/** Dashed clock: an upcoming slot that has not run yet. */
export function UpcomingIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

/** Clock struck through: a slot the scheduler missed. */
export function MissedIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
      <path d="M4 4l16 16" />
    </Icon>
  );
}

/** Git merge: a merged pull request. */
export function GitMergeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="5" r="2.2" />
      <circle cx="6" cy="19" r="2.2" />
      <circle cx="18" cy="13" r="2.2" />
      <path d="M6 7.2v9.6" />
      <path d="M6 7.2c0 3.5 3 5.8 9.8 5.8" />
    </Icon>
  );
}

/** Two bars: a run held at a human gate. */
export function PauseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="6.5" y="5" width="3.5" height="14" rx="1" />
      <rect x="14" y="5" width="3.5" height="14" rx="1" />
    </Icon>
  );
}

/** Circled question mark: an agent waiting on an answer. */
export function QuestionIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6" />
      <path d="M12 17h.01" />
    </Icon>
  );
}

/** Raised hand: a run launched by hand, not by the scheduler. */
export function HandIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 11V6a2 2 0 0 0-4 0v5" />
      <path d="M14 10V4a2 2 0 0 0-4 0v6" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </Icon>
  );
}

/** Chevron, pointing right: next. */
export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  );
}

/** Arrow up: a block that began on an earlier day. */
export function ArrowUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </Icon>
  );
}

/** Arrow down: a block that goes on past midnight. */
export function ArrowDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </Icon>
  );
}

/** Calendar with a dot: a free event created in the agenda. */
export function CalendarEventIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
      <path d="M8 2.5v4M16 2.5v4M3 10h18" />
      <circle cx="12" cy="15.5" r="1.6" fill="currentColor" />
    </Icon>
  );
}

/** Calendar with an outgoing arrow: a meeting read from Google Calendar. */
export function ExternalCalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 11V6.5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h7" />
      <path d="M8 2.5v4M16 2.5v4M3 10h18" />
      <path d="M16 15h5v5M21 15l-6 6" />
    </Icon>
  );
}

/** Stacked pages: a deliverable. */
export function DocumentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </Icon>
  );
}

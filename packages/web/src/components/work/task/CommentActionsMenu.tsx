/**
 * The one entry point for a stream comment's actions: a "⋯" button, always on
 * the right of the comment whoever wrote it, opening a contextual menu. Actions
 * are a plain list so new ones (edit, copy markdown…) are one more item, not
 * one more icon. The button shows on hover/focus, and stays while the menu is open.
 */
import { useState, type ReactNode } from 'react';
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { cn } from '../../../lib/cn';

export interface CommentAction {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** Destructive: red, and set apart below a separator. */
  danger?: boolean;
}

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}

export function CommentActionsMenu({ actions, className }: { actions: CommentAction[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context), useRole(context, { role: 'menu' })]);

  if (actions.length === 0) return null;
  const plain = actions.filter((a) => !a.danger);
  const danger = actions.filter((a) => a.danger);

  const item = (a: CommentAction) => (
    <button
      key={a.key}
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        a.onSelect();
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--theme-bg-hover)] focus-visible:bg-[var(--theme-bg-hover)] focus-visible:outline-none',
        a.danger ? 'text-[var(--theme-danger)]' : 'text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]',
      )}
    >
      <span className="flex w-4 shrink-0 justify-center">{a.icon}</span>
      {a.label}
    </button>
  );

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label="Actions du commentaire"
        title="Actions"
        className={cn(
          'shrink-0 rounded p-1 leading-none text-[var(--theme-text-faint)] transition-opacity hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)] focus-visible:opacity-100 group-hover/comment:opacity-100',
          open ? 'bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)] opacity-100' : 'opacity-0',
          className,
        )}
        {...getReferenceProps()}
      >
        <MoreIcon />
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              aria-label="Actions du commentaire"
              className="z-50 min-w-[210px] rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] p-1 text-[12px] shadow-lg"
              {...getFloatingProps()}
            >
              {plain.map(item)}
              {plain.length > 0 && danger.length > 0 && <div className="my-1 h-px bg-[var(--theme-border)]" role="separator" />}
              {danger.map(item)}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

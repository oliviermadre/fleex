/**
 * The Timeline annotation popovers (SPEC annotations §5.2–5.3): the composer
 * (create / pin a comment / edit / retry), the reader of a card, and the list
 * of a stacked group. Click-opened, never hover: Échap or a click outside
 * closes them. Rendered in a portal at fixed coordinates next to their anchor,
 * so the drawer's overflow never clips them.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ANNOTATION_BODY_MAX, ANNOTATION_TITLE_MAX, ANNOTATION_TONES, type AnnotationTone } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { useFileUpload } from '../../../hooks/useFileUpload';
import { MessageMarkdown } from '../task/MessageMarkdown';
import type { AnnotationDraft, ComposerRequest, UiAnnotation } from '../../../stores/annotationStore';
import { TONE_HUE, TONE_LABEL, firstImage } from './layoutAnnotations';
import { AnnotationToneIcon } from './AnnotationToneIcon';
import { AlertIcon, CloseIcon, CommentLineIcon, ImageIcon, PencilIcon, PinIcon } from '../../ui/icons/AnnotationIcons';
import { TrashIcon } from '../../ui/TrashIcon';

export interface AnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "mar. 14 oct. 14:32" */
export function longWhen(iso: string | number): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Shell ─────────────────────────────────────────────────────────────────────

function Popover({
  anchor,
  width,
  onClose,
  label,
  children,
}: {
  anchor: AnchorRect;
  width: number;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Above the anchor when there is room (the drawer sits at the bottom), else below.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - width / 2, vw - width - 8));
    let top = anchor.top - h - 8;
    if (top < 8) top = Math.min(anchor.top + anchor.height + 8, vh - h - 8);
    setPos({ left, top: Math.max(8, top) });
  }, [anchor, width, children]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // Next tick: the click that opened us must not close us.
    const id = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      className="fixed z-50 rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] p-3 shadow-2xl"
      style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

function TonePicker({ value, onChange, compact = false }: { value: AnnotationTone; onChange: (t: AnnotationTone) => void; compact?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Ton">
      {ANNOTATION_TONES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          title={TONE_LABEL[t]}
          aria-label={TONE_LABEL[t]}
          onClick={() => onChange(t)}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] text-[var(--theme-text-secondary)]',
            value === t ? 'text-[var(--theme-text-primary)]' : 'border-[var(--theme-border-input)]',
          )}
          style={value === t ? { borderColor: `var(--tint-${TONE_HUE[t]}-solid)`, background: `var(--tint-${TONE_HUE[t]}-bg)` } : undefined}
        >
          <AnnotationToneIcon tone={t} size={13} />
          {!compact && TONE_LABEL[t]}
        </button>
      ))}
    </div>
  );
}

// ── Composer ──────────────────────────────────────────────────────────────────

const TITLES: Record<ComposerRequest['mode'], string> = {
  create: 'Annoter',
  promote: 'Épingler sur la timeline',
  edit: "Modifier l'annotation",
  retry: 'Réessayer',
};

export function AnnotationComposer({
  request,
  anchor,
  ticketCreatedAt,
  onSubmit,
  onCancel,
  onDiscard,
}: {
  request: ComposerRequest;
  /** Retry mode only: drop the failed draft for good ("Abandonner"). */
  onDiscard?: () => void;
  anchor: AnchorRect;
  /** ISO — an annotation cannot predate the ticket. */
  ticketCreatedAt: string | null;
  onSubmit: (req: ComposerRequest) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<AnnotationDraft>(request.draft);
  const [editAt, setEditAt] = useState(false);
  const [atNote, setAtNote] = useState<string | null>(null);
  const [atError, setAtError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const set = (p: Partial<AnnotationDraft>) => setDraft((d) => ({ ...d, ...p }));

  const upload = useFileUpload({ textareaRef: bodyRef, value: draft.body, onChange: (body) => set({ body }) });

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const title = draft.title.trim();
  const valid = title.length >= 1 && title.length <= ANNOTATION_TITLE_MAX && draft.body.length <= ANNOTATION_BODY_MAX && !atError && !upload.isUploading;
  const dirty = draft.title !== request.draft.title || draft.body !== request.draft.body;

  const submit = () => {
    if (valid) onSubmit({ ...request, draft: { ...draft, title } } as ComposerRequest);
  };
  const cancel = () => {
    if (dirty && (draft.title.trim() || draft.body.trim()) && !confirmDiscard) setConfirmDiscard(true);
    else onCancel();
  };

  const onAtChange = (value: string) => {
    const t = new Date(value).getTime();
    if (Number.isNaN(t)) return;
    setAtNote(null);
    if (ticketCreatedAt && t < Date.parse(ticketCreatedAt)) {
      setAtError(`Avant la création du ticket (${longWhen(ticketCreatedAt)}).`);
      return;
    }
    setAtError(null);
    if (t > Date.now()) {
      set({ at: new Date().toISOString() });
      setAtNote('Instant dans le futur : ramené à maintenant.');
    } else {
      set({ at: new Date(t).toISOString() });
    }
  };

  return (
    <Popover anchor={anchor} width={420} onClose={cancel} label={TITLES[request.mode]}>
      <div
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        data-testid="annotation-composer"
      >
        <div className="mb-2 flex items-center gap-1.5 text-[12px] text-[var(--theme-text-secondary)]">
          {request.mode === 'promote' && <PinIcon size={13} className="shrink-0 text-[var(--theme-accent)]" />}
          <span>{TITLES[request.mode]} ·</span>
          <span className="text-[var(--theme-text-primary)]">{longWhen(draft.at)}</span>
          <button type="button" onClick={() => setEditAt((v) => !v)} className="ml-auto text-[11px] text-[var(--theme-accent)] underline underline-offset-2">
            modifier
          </button>
        </div>
        {editAt && (
          <input
            type="datetime-local"
            aria-label="Instant de l'annotation"
            defaultValue={toLocalInput(draft.at)}
            onChange={(e) => onAtChange(e.target.value)}
            className="mb-2 rounded border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--theme-text-primary)]"
          />
        )}
        {atError && (
          <div role="alert" className="mb-2 flex items-center gap-1 text-[11px] text-[var(--theme-danger)]">
            <AlertIcon size={12} className="shrink-0" />
            {atError}
          </div>
        )}
        {atNote && <div className="mb-2 text-[11px] text-[var(--theme-text-muted)]">{atNote}</div>}

        <div {...upload.dragProps} className={cn('rounded-md', upload.isDragOver && 'outline-dashed outline-1 outline-[var(--theme-accent)]')}>
          <input
            ref={titleRef}
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            // A screenshot pasted in the title goes to the detail: "paste, type three words, ⌘↵".
            onPaste={(e) => upload.pasteHandler(e as unknown as React.ClipboardEvent<HTMLTextAreaElement>)}
            placeholder={`Titre (obligatoire, ${ANNOTATION_TITLE_MAX} max) — colle une capture ici`}
            aria-label="Titre"
            className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-2 py-1.5 text-[13px] font-semibold text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
          />
          <div className={cn('mt-0.5 text-right font-mono text-[10px]', title.length > ANNOTATION_TITLE_MAX ? 'text-[var(--theme-danger)]' : 'text-[var(--theme-text-faint)]')}>
            {title.length}/{ANNOTATION_TITLE_MAX}
          </div>
          <textarea
            ref={bodyRef}
            value={draft.body}
            onChange={(e) => set({ body: e.target.value })}
            onPaste={upload.pasteHandler}
            placeholder="Détail, markdown… (coller / déposer une image)"
            aria-label="Détail"
            rows={4}
            className="mt-1 w-full resize-y rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-2 py-1.5 text-[12px] text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
          />
          <div className="mt-0.5 flex items-center">
            <button type="button" onClick={upload.openFilePicker} className="inline-flex items-center gap-1 text-[11px] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]">
              <ImageIcon size={13} />
              Joindre une capture
            </button>
            {upload.isUploading && <span className="ml-2 text-[11px] text-[var(--theme-text-muted)]">envoi…</span>}
            <span className={cn('ml-auto font-mono text-[10px]', draft.body.length > ANNOTATION_BODY_MAX ? 'text-[var(--theme-danger)]' : 'text-[var(--theme-text-faint)]')}>
              {draft.body.length}/{ANNOTATION_BODY_MAX}
            </span>
          </div>
        </div>

        <div className="mt-2">
          <TonePicker value={draft.tone} onChange={(tone) => set({ tone })} />
        </div>

        <div className="mt-3 flex items-center justify-end gap-1.5">
          {confirmDiscard && (
            <span className="mr-auto text-[11px] text-[var(--theme-text-muted)]">
              Abandonner le brouillon ?{' '}
              <button type="button" className="text-[var(--theme-accent)] underline" onClick={onCancel}>Oui</button>
              {' · '}
              <button type="button" className="text-[var(--theme-accent)] underline" onClick={() => setConfirmDiscard(false)}>Non</button>
            </span>
          )}
          {request.mode === 'retry' && onDiscard && (
            <button type="button" onClick={onDiscard} className="rounded-md px-2.5 py-1 text-[12px] text-[var(--theme-danger)] hover:bg-[var(--theme-bg-hover)]">
              Abandonner
            </button>
          )}
          <button type="button" onClick={cancel} className="rounded-md px-2.5 py-1 text-[12px] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]">
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid}
            className="rounded-md bg-[var(--theme-accent)] px-2.5 py-1 text-[12px] font-semibold text-[var(--theme-accent-fg)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {request.mode === 'edit' ? 'Enregistrer' : 'Annoter'} ⌘↵
          </button>
        </div>
      </div>
    </Popover>
  );
}

// ── Reader ────────────────────────────────────────────────────────────────────

export function AnnotationViewer({
  annotation,
  anchor,
  onClose,
  onEdit,
  onDelete,
  onTone,
  onSeeComment,
}: {
  annotation: UiAnnotation;
  anchor: AnchorRect;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTone: (tone: AnnotationTone) => void;
  onSeeComment: (commentId: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const a = annotation;
  return (
    <Popover anchor={anchor} width={520} onClose={onClose} label={`Annotation : ${a.title}`}>
      <div data-testid="annotation-viewer">
        <div className="flex items-center gap-2">
          <AnnotationToneIcon tone={a.tone} size={14} />
          <span className="font-mono text-[10px] uppercase text-[var(--theme-text-muted)]">{TONE_LABEL[a.tone]}</span>
          <button type="button" onClick={onClose} aria-label="Fermer" className="ml-auto rounded p-1 text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]">
            <CloseIcon size={14} />
          </button>
        </div>
        <div className="mb-1 mt-2 text-[15px] font-semibold leading-snug text-[var(--theme-text-primary)]">{a.title}</div>
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-[var(--theme-text-muted)]">
          {a.authorType === 'agent' && <AgentTag />}
          <span>{a.authorName}</span>
          <span>· {longWhen(a.at)}</span>
          {a.sourceCommentId && (
            <button type="button" onClick={() => onSeeComment(a.sourceCommentId!)} className="inline-flex items-center gap-1 text-[var(--theme-accent)] underline underline-offset-2">
              · <CommentLineIcon size={12} /> Voir le commentaire
            </button>
          )}
        </div>
        {a.body.trim() && (
          <div className="mt-2 max-h-[340px] overflow-auto border-t border-[var(--theme-border)] pt-2 text-[12px] [&_img]:max-w-[480px] [&_img]:cursor-zoom-in">
            <div
              onClick={(e) => {
                const img = (e.target as HTMLElement).closest('img');
                if (img) window.open(img.src, '_blank', 'noopener');
              }}
            >
              <MessageMarkdown body={a.body} />
            </div>
          </div>
        )}
        <div className="mt-2 flex items-center gap-1.5 border-t border-[var(--theme-border)] pt-2">
          <TonePicker value={a.tone} onChange={onTone} compact />
          <span className="flex-1" />
          {confirmDelete ? (
            <span className="text-[11px] text-[var(--theme-text-muted)]">
              Supprimer ?{' '}
              <button type="button" className="text-[var(--theme-danger)] underline" onClick={onDelete}>Oui</button>
              {' · '}
              <button type="button" className="text-[var(--theme-accent)] underline" onClick={() => setConfirmDelete(false)}>Non</button>
            </span>
          ) : (
            <>
              <button type="button" onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--theme-border-input)] px-2.5 py-1 text-[12px] hover:bg-[var(--theme-bg-hover)]">
                <PencilIcon size={13} />
                Modifier
              </button>
              <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--theme-border-input)] px-2.5 py-1 text-[12px] text-[var(--theme-danger)] hover:bg-[var(--theme-bg-hover)]">
                <TrashIcon size={13} />
                Supprimer
              </button>
            </>
          )}
        </div>
      </div>
    </Popover>
  );
}

export function AgentTag() {
  return (
    <span className="rounded-sm border border-[var(--tint-purple-border)] px-1 text-[9px] text-[var(--tint-purple-text)]">agent</span>
  );
}

// ── Stack list ────────────────────────────────────────────────────────────────

export function AnnotationStackList({
  annotations,
  anchor,
  onClose,
  onOpen,
}: {
  annotations: UiAnnotation[];
  anchor: AnchorRect;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <Popover anchor={anchor} width={300} onClose={onClose} label={`${annotations.length} annotations`}>
      <div className="mb-1 text-[12px] text-[var(--theme-text-secondary)]">{annotations.length} annotations</div>
      <div className="flex flex-col">
        {annotations.map((a) => {
          const img = firstImage(a.body);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onOpen(a.id)}
              data-testid="annotation-stack-item"
              className="flex items-stretch gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-[var(--theme-bg-hover)]"
            >
              <i className="w-[3px] shrink-0 rounded" style={{ background: `var(--tint-${TONE_HUE[a.tone]}-solid)` }} />
              {img && <img src={img} alt="" className="h-10 w-10 shrink-0 self-center rounded border border-[var(--theme-border)] object-cover" />}
              <span className="min-w-0 self-center">
                <span className="flex items-center gap-1.5">
                  <AnnotationToneIcon tone={a.tone} size={12} />
                  <span className="truncate text-[12px] font-semibold text-[var(--theme-text-primary)]">{a.title}</span>
                </span>
                <span className="font-mono text-[10px] text-[var(--theme-text-muted)]">{longWhen(a.at)} · {a.authorName}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

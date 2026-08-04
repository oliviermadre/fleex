import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject, TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useScrollSync } from '../../hooks/useScrollSync';
import { MarkdownModeToggle } from './MarkdownModeToggle';
import { nextMarkdownMode, useMarkdownMode, type MarkdownMode } from './useMarkdownMode';
import type { MarkdownProfile } from './profiles';

export type { MarkdownMode };

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Persistence + default-mode key, shared by every instance of the same kind
   * of surface (e.g. `ticket_description`). Not per entity.
   */
  surfaceKind: string;
  /** `panel` = full-height field, `composer` = auto-growing message box. */
  variant?: 'panel' | 'composer';
  /** Mode used the first time this surface kind is opened. */
  defaultMode?: MarkdownMode;
  /**
   * Controlled mode. Only for surfaces whose mode is driven from outside —
   * the scratchpad, where a global hotkey (Alt+Shift+V) cycles it.
   * Omit it and the editor owns (and persists) its own mode.
   */
  mode?: MarkdownMode;
  onModeChange?: (mode: MarkdownMode) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Wires drag-drop / paste / picker uploads and renders the attach button. */
  enableFileUpload?: boolean;
  /**
   * Notifies the caller while an upload is in flight, so it can block a save
   * that would persist the `![Uploading …](fleex-upload-…)` placeholder.
   */
  onUploadingChange?: (uploading: boolean) => void;
  /**
   * Drag-over state owned by the caller. For surfaces that run their own
   * `useFileUpload` on an outer wrapper and just want the field highlighted.
   */
  dragOver?: boolean;
  /** Cancels the caller's pending debounced save before an upload rewrites the value. */
  onFlushDebounce?: () => void;
  /** Defaults to toggling the checkbox in `value` — override only if the source of truth is elsewhere. */
  onToggleCheckbox?: (lineIndex: number) => void;
  profile?: MarkdownProfile;
  /** Escape hatch for mention autocomplete, submit-on-Enter, spellcheck… */
  textareaProps?: TextareaHTMLAttributes<HTMLTextAreaElement>;
  /** Pass a ref when the caller needs the textarea (caret handling, autocomplete anchoring). */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;

  // ── composer variant only ──
  /** Rows before the field starts growing. */
  minRows?: number;
  /** Rows after which the field scrolls instead of growing. */
  maxRows?: number;
  /** Buttons rendered to the right of the input (attach, send…). */
  trailing?: ReactNode;
  /** Extra controls rendered in the bottom bar, next to the mode toggle. */
  actions?: ReactNode;
  /** Absolutely-positioned overlay inside the input row (mention autocomplete…). */
  overlay?: ReactNode;
}

const EMPTY_PREVIEW = 'Nothing to preview';

/**
 * The single markdown surface of Fleex: a textarea, its rendered preview, and
 * one three-state toggle to switch between write / preview / split.
 *
 * Two variants:
 * - `panel` — fills its container; the toggle overlays the top-right corner and
 *   split is side-by-side, scroll-synced.
 * - `composer` — grows with its content; the toggle only appears once the field
 *   has grown past one line, and split stacks the preview *above* the input
 *   (the column is too narrow to halve, and that's where the message will land).
 */
export function MarkdownEditor({
  value,
  onChange,
  surfaceKind,
  variant = 'panel',
  defaultMode = variant === 'composer' ? 'write' : 'split',
  mode: controlledMode,
  onModeChange,
  placeholder,
  disabled,
  className,
  enableFileUpload = false,
  onUploadingChange,
  dragOver = false,
  onFlushDebounce,
  onToggleCheckbox,
  profile,
  textareaProps,
  textareaRef: externalRef,
  minRows = 1,
  maxRows = 10,
  trailing,
  actions,
  overlay,
}: MarkdownEditorProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalRef ?? internalRef;
  const previewRef = useRef<HTMLDivElement>(null);
  const {
    mode: uncontrolledMode,
    setMode: setUncontrolledMode,
    cycleMode: cycleUncontrolledMode,
    allowSplit,
  } = useMarkdownMode(surfaceKind, defaultMode, { persistPreview: variant !== 'composer' });
  const mode = controlledMode
    ? (!allowSplit && controlledMode === 'split' ? 'preview' : controlledMode)
    : uncontrolledMode;
  const setMode = useCallback(
    (next: MarkdownMode) => {
      if (controlledMode) onModeChange?.(next);
      else setUncontrolledMode(next);
    },
    [controlledMode, onModeChange, setUncontrolledMode],
  );
  const cycleMode = useCallback(() => {
    if (controlledMode) onModeChange?.(nextMarkdownMode(mode, allowSplit));
    else cycleUncontrolledMode();
  }, [controlledMode, onModeChange, mode, allowSplit, cycleUncontrolledMode]);
  const [grown, setGrown] = useState(false);

  const valueRef = useRef(value);
  valueRef.current = value;

  const { handleTyping, handlePreviewScroll } = useScrollSync(
    textareaRef,
    previewRef,
    variant === 'panel' && mode === 'split',
  );

  const fileUpload = useFileUpload({
    textareaRef,
    value,
    onChange,
    onFlushDebounce,
  });

  // Auto-grow. Runs on every value change — including the ones no keystroke
  // produced: mount with a restored draft, tab switch remount, programmatic
  // insert, clear-on-submit. `useLayoutEffect` so the field never flashes at
  // one line before snapping to its real height.
  useLayoutEffect(() => {
    if (variant !== 'composer') return;
    // In preview the field is display:none — every measurement reads 0. Keep
    // the height (and `grown`) from before the switch.
    if (mode === 'preview') return;
    const ta = textareaRef.current;
    if (!ta) return;

    const styles = getComputedStyle(ta);
    const lineHeight = parseFloat(styles.lineHeight);
    const padding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const border = parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth);

    if (Number.isFinite(lineHeight)) {
      ta.style.maxHeight = `${lineHeight * maxRows + padding + border}px`;
    }
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;

    // "Grown" drives the toggle's appearance. Fall back to a newline scan when
    // the line-height isn't computable (jsdom).
    const multiline = Number.isFinite(lineHeight)
      ? ta.scrollHeight > lineHeight * (minRows + 0.5) + padding
      : value.includes('\n');
    setGrown(multiline || value.includes('\n'));
  }, [value, mode, variant, maxRows, minRows, textareaRef]);

  const isUploading = enableFileUpload && fileUpload.isUploading;
  useEffect(() => {
    onUploadingChange?.(isUploading);
  }, [isUploading, onUploadingChange]);

  const defaultToggleCheckbox = useCallback(
    (lineIndex: number) => {
      const lines = valueRef.current.split('\n');
      const line = lines[lineIndex];
      if (!line) return;
      if (line.includes('[ ]')) {
        lines[lineIndex] = line.replace('[ ]', '[x]');
      } else if (/\[[xX]\]/.test(line)) {
        lines[lineIndex] = line.replace(/\[[xX]\]/, '[ ]');
      } else {
        return;
      }
      onChange(lines.join('\n'));
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // ⌘/Ctrl+⇧+P — cycle write → preview → split. Chosen because it collides
      // with nothing in the composer (Shift+Tab, Ctrl+1/2/3, Enter are taken).
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        e.stopPropagation();
        cycleMode();
      }
    },
    [cycleMode],
  );

  const previewPane = (
    <div
      ref={previewRef}
      className={cn(
        'overflow-y-auto rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3',
        variant === 'composer' ? 'max-h-64' : 'h-full',
        variant === 'panel' && mode === 'split' ? 'w-1/2' : 'w-full min-w-0',
      )}
      onScroll={handlePreviewScroll}
    >
      {value.trim() ? (
        <MarkdownRenderer
          content={value}
          onToggleCheckbox={onToggleCheckbox ?? defaultToggleCheckbox}
          profile={profile}
        />
      ) : (
        <p className="text-sm italic text-[var(--theme-text-muted)]">{EMPTY_PREVIEW}</p>
      )}
    </div>
  );

  // The caller may own the upload hook (and the drop target) itself.
  const dragActive = enableFileUpload ? fileUpload.isDragOver : dragOver;

  const textarea = (
    <textarea
      {...textareaProps}
      ref={textareaRef}
      rows={variant === 'composer' ? minRows : undefined}
      disabled={disabled}
      className={cn(
        'resize-none bg-[var(--theme-bg-surface)] text-sm text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none',
        variant === 'panel'
          ? 'h-full w-full rounded-md border p-3 font-mono'
          : 'min-h-[36px] w-full flex-1 overflow-y-auto rounded-lg border px-3 py-2 leading-snug',
        dragActive
          ? 'border-[var(--theme-accent)] ring-2 ring-[var(--theme-accent)]/30'
          : 'border-[var(--theme-border)]',
        textareaProps?.className,
      )}
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        onChange(e.target.value);
        handleTyping();
        textareaProps?.onChange?.(e);
      }}
      onPaste={(e) => {
        if (enableFileUpload) fileUpload.pasteHandler(e);
        textareaProps?.onPaste?.(e);
      }}
    />
  );

  const attachButton = enableFileUpload && (
    <>
      <button
        type="button"
        onClick={fileUpload.openFilePicker}
        className="absolute bottom-2 right-2 rounded p-1 text-[var(--theme-text-muted)] opacity-50 transition-opacity hover:text-[var(--theme-accent)] hover:opacity-100"
        title="Attach file"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
        </svg>
      </button>
      {fileUpload.isUploading && (
        <div className="absolute bottom-2 left-3 text-xs text-[var(--theme-text-muted)]">
          Uploading...
        </div>
      )}
    </>
  );

  // `collapsible` only in `panel`: there the toggle is overlaid on the text.
  // The composer's lives in the bottom bar, where it covers nothing.
  const toggle = (
    <MarkdownModeToggle
      mode={mode}
      onChange={setMode}
      allowSplit={allowSplit}
      collapsible={variant === 'panel'}
    />
  );

  const dragProps = enableFileUpload ? fileUpload.dragProps : {};

  if (variant === 'panel') {
    return (
      <div
        className={cn('group relative flex min-h-0 flex-1 gap-4 overflow-hidden', className)}
        onKeyDown={handleKeyDown}
      >
        {/*
          The textarea is hidden, never unmounted: unmounting drops the caret,
          the selection, and any `onBlur`-based save the caller relies on.
        */}
        <div
          className={cn(
            'relative min-w-0',
            mode === 'preview' ? 'hidden' : mode === 'split' ? 'w-1/2' : 'w-full',
          )}
          {...dragProps}
        >
          {textarea}
          {attachButton}
        </div>
        {mode !== 'write' && previewPane}
        {/*
          Overlaid on the content: at rest it is dim *and* collapsed to the
          active mode alone, so it stops competing with the text underneath.
          Focus deliberately doesn't open it — focus means "I'm typing", which
          is exactly when the toggle is least useful and most in the way.
          Hover, and only hover, expands it.
        */}
        <div className="absolute right-2 top-2 z-10 opacity-35 transition-opacity group-hover:opacity-100">
          {toggle}
        </div>
      </div>
    );
  }

  // ── composer ──
  // The toggle stays out of the way while there is nothing worth previewing.
  const showToggle = grown || mode !== 'write';

  return (
    <div className={cn('flex flex-col gap-2', className)} onKeyDown={handleKeyDown}>
      {mode === 'split' && previewPane}
      <div className="relative flex items-end gap-2" {...dragProps}>
        {overlay}
        {mode === 'preview' && previewPane}
        {/* Hidden, not unmounted — see the panel branch. */}
        <div className={cn('relative flex min-w-0 flex-1', mode === 'preview' && 'hidden')}>
          {textarea}
          {attachButton}
        </div>
        {trailing}
      </div>
      {(showToggle || actions) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {showToggle && toggle}
          {actions}
        </div>
      )}
    </div>
  );
}

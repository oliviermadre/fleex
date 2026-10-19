import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { getProxiedImageSrc } from '../../lib/image';

// ── Lightbox (shared by thumbnail & placeholder) ─────────────────────────────

interface ImageLightboxProps {
  src: string;
  alt?: string;
  open: boolean;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, open, onClose }: ImageLightboxProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        // Stop other window-level Escape handlers (e.g. TicketDetail close)
        e.stopImmediatePropagation();
        onClose();
      }
    }
    // Use capture so we fire before bubble-phase listeners
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      data-overlay-top
      className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          className="absolute -top-3 -right-3 w-8 h-8 flex items-center justify-center rounded-full bg-black/60 text-white/80 hover:text-white hover:bg-black/80 transition text-lg leading-none z-10"
          onClick={onClose}
          aria-label="Close"
        >
          &times;
        </button>

        <img
          src={src}
          alt={alt ?? ''}
          className="max-w-full max-h-[85vh] rounded-md object-contain shadow-2xl"
        />

        {alt && (
          <p className="text-xs text-white/70 mt-2 px-4 text-center">{alt}</p>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Thumbnail (96×96, used in gallery strip) ─────────────────────────────────

interface ImageThumbnailProps {
  src: string;
  alt?: string;
}

export function ImageThumbnail({ src, alt }: ImageThumbnailProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <img
        src={src}
        alt={alt ?? ''}
        className="w-24 h-24 object-cover rounded-md border border-[var(--theme-border)] cursor-pointer hover:ring-2 hover:ring-[var(--theme-accent)] transition"
        loading="lazy"
        onClick={() => setOpen(true)}
      />
      <ImageLightbox src={src} alt={alt} open={open} onClose={close} />
    </>
  );
}

// ── Inline placeholder pill (clickable reference in text) ────────────────────

interface ImagePlaceholderProps {
  src: string;
  alt?: string;
  index: number;
}

export function ImagePlaceholder({ src, alt, index }: ImagePlaceholderProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const label = alt || `Image ${index + 1}`;

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--theme-bg-overlay)] text-[var(--theme-accent)] text-xs font-medium cursor-pointer hover:ring-1 hover:ring-[var(--theme-accent)] transition align-baseline"
        onClick={() => setOpen(true)}
      >
        <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {label}
      </button>
      <ImageLightbox src={src} alt={alt} open={open} onClose={close} />
    </>
  );
}

// ── Gallery strip (renders a row of thumbnails) ──────────────────────────────

interface MarkdownImage {
  src: string;
  alt: string;
}

interface ImageGalleryStripProps {
  images: MarkdownImage[];
}

export function ImageGalleryStrip({ images }: ImageGalleryStripProps) {
  if (images.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {images.map((img, i) => (
        <ImageThumbnail key={i} src={img.src} alt={img.alt} />
      ))}
    </div>
  );
}

// ── Markdown image extraction utility ────────────────────────────────────────

/** The few mdast fields the extraction reads (avoids depending on @types/mdast). */
interface MdNode {
  type: string;
  alt?: string | null;
  url?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MdNode[];
}

/** Image nodes of the tree, in document order. Code spans/blocks hold text, never image nodes. */
function collectImages(node: MdNode, out: MdNode[]): void {
  if (node.type === 'image') {
    out.push(node);
    return;
  }
  for (const child of node.children ?? []) collectImages(child, out);
}

/**
 * Extracts all markdown images from content.
 * Returns the image list (with proxied src) and the cleaned markdown
 * where images are replaced with placeholder link markers.
 *
 * The markdown is parsed (CommonMark) rather than matched by regex: whether a
 * `![alt](url)` is an image or just text quoted in a code span, a fenced or indented
 * code block, or escaped, depends on the whole document (e.g. a lone ``` in prose does
 * not open a span, backtick runs only pair with a run of the same length). Only real
 * image nodes are rewritten, by their source range.
 */
export function extractMarkdownImages(markdown: string): {
  images: MarkdownImage[];
  cleaned: string;
} {
  const images: MarkdownImage[] = [];
  if (!markdown.includes('![')) return { images, cleaned: markdown };

  const nodes: MdNode[] = [];
  collectImages(fromMarkdown(markdown) as unknown as MdNode, nodes);

  let cleaned = '';
  let cursor = 0;
  for (const node of nodes) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined || start < cursor) continue;
    const alt = node.alt ?? '';
    images.push({ src: getProxiedImageSrc(node.url ?? ''), alt });
    const label = alt || `Image ${images.length}`;
    cleaned += `${markdown.slice(cursor, start)}[🖼 ${label}](#fleex-img:${images.length - 1})`;
    cursor = end;
  }
  return { images, cleaned: cleaned + markdown.slice(cursor) };
}

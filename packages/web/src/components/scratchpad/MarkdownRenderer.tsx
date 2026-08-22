import { memo, useMemo, useState, Children } from 'react';
import Markdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Components } from 'react-markdown';
import { ImageGalleryStrip, ImagePlaceholder, extractMarkdownImages } from '../shared/ImageThumbnail';
import { MermaidDiagram, isMermaidCode, codeNodeToString } from '../shared/MermaidDiagram';
import { useColorMode } from '../../hooks/useActiveTheme';
import { preprocessReferences, SCRATCHPAD_REF_HREF_PREFIX, TICKET_MENTION_HREF_PREFIX } from '../markdown/mentions';
import { NoteRefChip } from '../markdown/NoteRefChip';
import { CITATION_HREF_PREFIX, decodeCitation } from '../markdown/citations';
import { TicketMentionChip } from '../markdown/TicketMentionChip';
import { remarkPluginsFor, type MarkdownProfile } from '../markdown/profiles';

interface MarkdownRendererProps {
  content: string;
  onToggleCheckbox: (lineIndex: number) => void;
  /**
   * Handle a `[3]` citation the caller encoded with `linkifyCitations`.
   *
   * Passed in rather than resolved here because only the caller knows what the
   * numbers point at — a cited answer owns its own source list.
   */
  onCitation?: (index: number) => void;
  /**
   * `user` (default) renders a lone `\n` as a <br> — the right behaviour for
   * everything Fleex displays today. Use `doc` for hand-wrapped authored
   * markdown. See ../markdown/profiles.
   */
  profile?: MarkdownProfile;
}

// ── Segment types ─────────────────────────────────────────────────────────────

interface TextSegment {
  type: 'text';
  content: string;
  /** 0-indexed line offset in the original content */
  startLine: number;
}

interface ToggleSegment {
  type: 'toggle';
  summary: string;
  content: string;
  /** 0-indexed line of the first content line in the original content */
  contentStartLine: number;
}

type Segment = TextSegment | ToggleSegment;

/**
 * Split content into plain text segments and toggle blocks (>>> ... <<<).
 * Toggle block content is not passed to react-markdown — it's rendered
 * recursively by MarkdownRenderer itself, which handles nesting correctly.
 */
function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  const lines = content.split('\n');
  let i = 0;
  let textBuffer: string[] = [];
  let textStartLine = 0;

  const flushText = () => {
    if (textBuffer.length > 0) {
      segments.push({ type: 'text', content: textBuffer.join('\n'), startLine: textStartLine });
      textBuffer = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith('>>>')) {
      flushText();

      const summary = line.slice(3).trim() || 'Toggle';
      i++;
      const contentStartLine = i;
      const blockLines: string[] = [];

      while (i < lines.length && !lines[i]!.startsWith('<<<')) {
        blockLines.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++; // skip <<<

      segments.push({ type: 'toggle', summary, content: blockLines.join('\n'), contentStartLine });
      textStartLine = i;
    } else {
      if (textBuffer.length === 0) textStartLine = i;
      textBuffer.push(line);
      i++;
    }
  }

  flushText();
  return segments;
}

// ── rehype plugins config ─────────────────────────────────────────────────────

// detect: true → rehype-highlight adds the `hljs` class even to code blocks
// without a language specifier, so we can reliably distinguish block vs inline
// code in the `code` component override.

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img ?? []), 'width', 'height'],
  },
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    ...['details', 'summary'].filter((t) => !defaultSchema.tagNames?.includes(t)),
  ],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rehypePlugins: any[] = [rehypeRaw, [rehypeSanitize, sanitizeSchema], [rehypeHighlight, { detect: true }]];

// ── Main component ────────────────────────────────────────────────────────────

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  onToggleCheckbox,
  profile = 'user',
  onCitation,
}: MarkdownRendererProps) {
  const segments = useMemo(() => parseSegments(content), [content]);

  return (
    <div className="scratchpad-md">
      {segments.map((segment, i) => {
        if (segment.type === 'toggle') {
          return (
            <ToggleBlock key={i} summary={segment.summary}>
              <MarkdownRenderer
                content={segment.content}
                profile={profile}
                onCitation={onCitation}
                onToggleCheckbox={(localLine) =>
                  onToggleCheckbox(segment.contentStartLine + localLine)
                }
              />
            </ToggleBlock>
          );
        }

        return (
          <MarkdownSection
            key={i}
            content={segment.content}
            startLine={segment.startLine}
            profile={profile}
            onToggleCheckbox={onToggleCheckbox}
            onCitation={onCitation}
          />
        );
      })}
    </div>
  );
});

// ── Section renderer ──────────────────────────────────────────────────────────

function MarkdownSection({
  content,
  startLine,
  profile,
  onToggleCheckbox,
  onCitation,
}: {
  content: string;
  startLine: number;
  profile: MarkdownProfile;
  onToggleCheckbox: (lineIndex: number) => void;
  onCitation?: (index: number) => void;
}) {
  const colorMode = useColorMode();

  // Extract images — gallery strip at top, inline placeholders in text
  const { images, cleaned: contentWithoutImages } = useMemo(
    () => extractMarkdownImages(content),
    [content],
  );

  // Encode @ticket: and @scratchpad: references as #fleex-… links so the `a`
  // override can render them as chips. Inline-only (no line added or removed), so
  // the checkbox line indices computed from `contentWithoutImages` stay valid.
  const processed = useMemo(() => preprocessReferences(contentWithoutImages), [contentWithoutImages]);

  // Pre-compute checkbox line indices within this segment (0-indexed, local)
  const lines = useMemo(() => contentWithoutImages.split('\n'), [contentWithoutImages]);
  const checkboxLocalLines = useMemo(
    () =>
      lines
        .map((line, idx) => ({ line, idx }))
        .filter(({ line }) => /^(\s*)[-*]\s+\[([ xX])\]/.test(line))
        .map(({ idx }) => idx),
    [lines],
  );

  // Mutable counter — incremented during a single render pass in tree order.
  // `li` (task-list-item) reads the counter BEFORE `input` increments it,
  // because React calls parent component overrides before child ones.
  let checkboxCounter = 0;

  const components: Components = {
    // ── Links ───────────────────────────────────────────────────────────────
    a: ({ href, children }) => {
      // Image placeholder — clickable pill that opens lightbox
      if (href?.startsWith('#fleex-img:')) {
        const idx = parseInt(href.slice('#fleex-img:'.length), 10);
        const img = images[idx];
        if (img) {
          return <ImagePlaceholder src={img.src} alt={img.alt} index={idx} />;
        }
      }
      // Ticket mention — clickable chip that navigates to the referenced ticket
      if (href?.startsWith(TICKET_MENTION_HREF_PREFIX)) {
        return <TicketMentionChip idRef={href.slice(TICKET_MENTION_HREF_PREFIX.length)} />;
      }
      // Citation — `[3]` in a cited answer, pointing at its source list
      if (onCitation && href?.startsWith(CITATION_HREF_PREFIX)) {
        const index = decodeCitation(href);
        if (index !== null) {
          return (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCitation(index); }}
              title={`Source ${index}`}
              className="mx-px cursor-pointer rounded-sm border-none bg-[var(--theme-accent)]/12 px-1 align-baseline text-[0.85em] font-medium text-[var(--theme-accent)] transition-colors hover:bg-[var(--theme-accent)]/25"
            >
              {children}
            </button>
          );
        }
      }
      // Note reference — `@scratchpad:global` or `@scratchpad:owner/name`
      if (href?.startsWith(SCRATCHPAD_REF_HREF_PREFIX)) {
        const noteKey = decodeURIComponent(href.slice(SCRATCHPAD_REF_HREF_PREFIX.length));
        return <NoteRefChip noteKey={noteKey}>{children}</NoteRefChip>;
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--theme-accent)] underline underline-offset-2 hover:text-[var(--theme-accent-hover)] transition-colors break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </a>
      );
    },

    // ── Headings ─────────────────────────────────────────────────────────────
    h1: ({ children }) => (
      <h1 className="text-xl font-bold mt-4 mb-2 text-[var(--theme-text-primary)]">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-lg font-semibold mt-3 mb-1.5 text-[var(--theme-text-primary)]">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-base font-medium mt-2 mb-1 text-[var(--theme-text-primary)]">
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-sm font-medium mt-2 mb-1 text-[var(--theme-text-secondary)]">
        {children}
      </h4>
    ),
    h5: ({ children }) => (
      <h5 className="text-xs font-medium mt-1.5 mb-0.5 text-[var(--theme-text-secondary)]">
        {children}
      </h5>
    ),
    h6: ({ children }) => (
      <h6 className="text-xs font-medium mt-1.5 mb-0.5 text-[var(--theme-text-muted)]">
        {children}
      </h6>
    ),

    // ── Paragraph ────────────────────────────────────────────────────────────
    // Bottom-only margin, clearly larger than the line height: with the `user`
    // profile a lone `\n` is a <br>, so the gap between two paragraphs has to
    // stay visibly distinct from a simple line break.
    p: ({ children }) => (
      <p className="text-sm leading-5 mb-2 last:mb-0 text-[var(--theme-text-primary)]">
        {children}
      </p>
    ),

    // ── Blockquote ───────────────────────────────────────────────────────────
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-[var(--theme-accent)] pl-3 my-1 text-[var(--theme-text-secondary)] italic">
        {children}
      </blockquote>
    ),

    // ── Horizontal rule ──────────────────────────────────────────────────────
    hr: () => <hr className="my-3 border-t border-[var(--theme-border)]" />,

    // ── Lists ────────────────────────────────────────────────────────────────
    ul: ({ children, className }) => (
      <ul
        className={`my-1 ${
          className?.includes('contains-task-list') ? 'list-none pl-0' : 'list-disc pl-5'
        }`}
      >
        {children}
      </ul>
    ),
    ol: ({ children }) => <ol className="my-1 pl-5 list-decimal">{children}</ol>,

    li: ({ children, className }) => {
      if (className?.includes('task-list-item')) {
        // Capture the counter BEFORE input increments it.
        const cbIdx = checkboxCounter;
        const localLine = checkboxLocalLines[cbIdx] ?? 0;
        const rawLine = lines[localLine] ?? '';
        const isChecked = /^(\s*)[-*]\s+\[[xX]\]/.test(rawLine);
        const globalLine = startLine + localLine;

        // children = [checkboxSpan, ...textNodes]
        // The checkbox span comes from our `input` override below.
        const childArr = Children.toArray(children);

        return (
          <div
            className="flex items-start gap-2 py-0.5 cursor-pointer group"
            onClick={() => onToggleCheckbox(globalLine)}
          >
            {childArr[0]}
            <span
              className={`text-sm leading-5 ${
                isChecked
                  ? 'line-through text-[var(--theme-text-muted)]'
                  : 'text-[var(--theme-text-primary)]'
              }`}
            >
              {childArr.slice(1)}
            </span>
          </div>
        );
      }

      return (
        <li className="py-0.5 text-sm leading-5 text-[var(--theme-text-primary)] marker:text-[var(--theme-text-muted)]">
          {children}
        </li>
      );
    },

    // ── Checkbox (interactive) ───────────────────────────────────────────────
    // Incremented AFTER li reads the counter (parent renders before child).
    input: ({ type, checked }) => {
      if (type === 'checkbox') {
        checkboxCounter++;
        const isChecked = checked ?? false;
        return (
          <span
            className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
              isChecked
                ? 'bg-[var(--theme-accent)] border-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                : 'border-[var(--theme-text-muted)] group-hover:border-[var(--theme-accent)]'
            }`}
          >
            {isChecked && (
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2.5 6L5 8.5L9.5 3.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </span>
        );
      }
      return <input type={type} readOnly />;
    },

    // ── Inline formatting ────────────────────────────────────────────────────
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => (
      <del className="line-through text-[var(--theme-text-muted)]">{children}</del>
    ),

    // ── Code ─────────────────────────────────────────────────────────────────
    // rehype-highlight (detect:true) adds the `hljs` class to ALL pre>code
    // elements. Inline code has no className → reliable block vs inline check.
    code: ({ children, className }) => {
      if (isMermaidCode(className)) {
        return <MermaidDiagram code={codeNodeToString(children)} colorMode={colorMode} />;
      }
      if (className?.includes('hljs')) {
        // Block code — `pre` handles the container styling
        return <code className={className}>{children}</code>;
      }
      // Inline code
      return (
        <code className="px-1 py-0.5 rounded text-xs bg-[var(--theme-bg-overlay)] text-[var(--theme-accent)] font-mono">
          {children}
        </code>
      );
    },

    pre: ({ children, node }) => {
      // A mermaid block renders a <MermaidDiagram> (block-level) — don't wrap it
      // in the monospace <pre> container meant for code listings.
      const firstChild = node?.children?.[0];
      const codeClass =
        firstChild?.type === 'element' ? firstChild.properties?.className : undefined;
      if (isMermaidCode(Array.isArray(codeClass) ? codeClass.join(' ') : String(codeClass ?? ''))) {
        return <>{children}</>;
      }
      return (
        <pre className="my-2 p-3 rounded-md bg-[var(--theme-bg-overlay)] overflow-x-auto text-xs font-mono leading-relaxed">
          {children}
        </pre>
      );
    },

    // ── Tables ───────────────────────────────────────────────────────────────
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto rounded-md border border-[var(--theme-border)]">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-[var(--theme-bg-overlay)]">{children}</thead>
    ),
    tbody: ({ children }) => (
      <tbody className="divide-y divide-[var(--theme-border)]">{children}</tbody>
    ),
    tr: ({ children }) => <tr className="even:bg-[var(--theme-bg-hover)]">{children}</tr>,
    th: ({ children }) => (
      <th className="px-3 py-1.5 text-left text-xs font-semibold text-[var(--theme-text-primary)] border-r border-[var(--theme-border)] last:border-r-0 whitespace-nowrap">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-1.5 text-xs text-[var(--theme-text-secondary)] border-r border-[var(--theme-border)] last:border-r-0">
        {children}
      </td>
    ),

  };

  return (
    <>
      <ImageGalleryStrip images={images} />
      <Markdown
        remarkPlugins={remarkPluginsFor(profile)}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {processed}
      </Markdown>
    </>
  );
}

// ── Collapsible toggle block ──────────────────────────────────────────────────

function ToggleBlock({ summary, children }: { summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="my-1 rounded border border-[var(--theme-border-subtle)]">
      <button
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-sm text-left text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-hover)] transition-colors"
        onClick={() => setOpen(!open)}
      >
        <svg
          className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          viewBox="0 0 12 12"
          fill="currentColor"
        >
          <path d="M4 2l5 4-5 4V2z" />
        </svg>
        <span className="font-medium">{summary}</span>
      </button>
      {open && (
        <div className="px-3 pb-2 border-t border-[var(--theme-border-subtle)]">{children}</div>
      )}
    </div>
  );
}

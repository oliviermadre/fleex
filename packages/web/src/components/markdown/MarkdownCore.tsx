import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Components } from 'react-markdown';

/**
 * The ONLY module in the app allowed to import react-markdown, remark-*, or
 * rehype-*. Everything else goes through LazyMarkdown.
 *
 * The pipeline used to be duplicated across MarkdownRenderer, TicketComments and
 * NeedsReviewRespondPanel, so react-markdown + highlight.js (157 kB gzip) sat in
 * the entry chunk — TicketComments alone put it on the default route. One module
 * means one lazy boundary that actually holds.
 *
 * `components` maps stay with their callers: that's app code, it's cheap, and it
 * is where the domain knowledge lives (mentions, image placeholders, checkboxes).
 */

// detect: true → rehype-highlight adds the `hljs` class even to code blocks with
// no language specifier, which is what lets `code` overrides tell block from
// inline code. Callers rely on this.
const remarkPlugins = [remarkGfm];

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
const basicRehypePlugins: any[] = [[rehypeHighlight, { detect: true }]];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const safeHtmlRehypePlugins: any[] = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  [rehypeHighlight, { detect: true }],
];

/**
 * - `basic`     — GFM + syntax highlighting. Raw HTML in the source is ignored.
 * - `safe-html` — adds raw HTML parsing, gated behind rehype-sanitize.
 */
export type MarkdownPreset = 'basic' | 'safe-html';

export interface MarkdownCoreProps {
  content: string;
  components?: Components;
  preset: MarkdownPreset;
}

export default function MarkdownCore({ content, components, preset }: MarkdownCoreProps) {
  return (
    <Markdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={preset === 'safe-html' ? safeHtmlRehypePlugins : basicRehypePlugins}
      components={components}
    >
      {content}
    </Markdown>
  );
}

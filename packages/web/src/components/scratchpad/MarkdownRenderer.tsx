import { useState } from 'react';

interface MarkdownRendererProps {
  content: string;
  onToggleCheckbox: (lineIndex: number) => void;
}

/**
 * Lightweight markdown renderer supporting:
 * - Headings (h1, h2, h3)
 * - Checkboxes (- [ ] / - [x]) — interactive
 * - Unordered lists (- item)
 * - Ordered lists (1. item)
 * - Bold, italic, inline code
 * - Collapsible toggles (>>> summary / content / <<<)
 * - Horizontal rules (---)
 * - Blockquotes (> text)
 */
export function MarkdownRenderer({ content, onToggleCheckbox }: MarkdownRendererProps) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // Collapsible toggle block: >>> summary ... <<<
    if (line.startsWith('>>>')) {
      const summary = line.slice(3).trim() || 'Toggle';
      const blockLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('<<<')) {
        blockLines.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++; // skip <<<
      elements.push(
        <ToggleBlock key={`toggle-${i}`} summary={summary}>
          <MarkdownRenderer
            content={blockLines.join('\n')}
            onToggleCheckbox={(localLine) => {
              // Map local line to global line index
              // We need to find the start of this block
            }}
          />
        </ToggleBlock>
      );
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<div key={`blank-${i}`} className="h-2" />);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim())) {
      elements.push(
        <hr
          key={`hr-${i}`}
          className="my-3 border-t border-[var(--theme-border)]"
        />
      );
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const text = headingMatch[2]!;
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3';
      const sizes: Record<string, string> = {
        h1: 'text-xl font-bold mt-4 mb-2',
        h2: 'text-lg font-semibold mt-3 mb-1.5',
        h3: 'text-base font-medium mt-2 mb-1',
      };
      elements.push(
        <Tag
          key={`h-${i}`}
          className={`${sizes[Tag]} text-[var(--theme-text-primary)]`}
        >
          {renderInline(text)}
        </Tag>
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      elements.push(
        <blockquote
          key={`bq-${i}`}
          className="border-l-2 border-[var(--theme-accent)] pl-3 my-1 text-[var(--theme-text-secondary)] italic"
        >
          {quoteLines.map((ql, qi) => (
            <div key={qi}>{renderInline(ql)}</div>
          ))}
        </blockquote>
      );
      continue;
    }

    // Checkbox list item
    const checkboxMatch = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s*(.*)/);
    if (checkboxMatch) {
      const indent = checkboxMatch[1]!.length;
      const checked = checkboxMatch[2] !== ' ';
      const text = checkboxMatch[3]!;
      const lineIdx = i;
      elements.push(
        <div
          key={`cb-${i}`}
          className="flex items-start gap-2 py-0.5 cursor-pointer group"
          style={{ paddingLeft: `${indent * 8 + 4}px` }}
          onClick={() => onToggleCheckbox(lineIdx)}
        >
          <span
            className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
              checked
                ? 'bg-[var(--theme-accent)] border-[var(--theme-accent)] text-white'
                : 'border-[var(--theme-text-muted)] group-hover:border-[var(--theme-accent)]'
            }`}
          >
            {checked && (
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span
            className={`text-sm leading-5 ${
              checked
                ? 'line-through text-[var(--theme-text-muted)]'
                : 'text-[var(--theme-text-primary)]'
            }`}
          >
            {renderInline(text)}
          </span>
        </div>
      );
      i++;
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*]\s+(.*)/);
    if (ulMatch) {
      const indent = ulMatch[1]!.length;
      const text = ulMatch[2]!;
      elements.push(
        <div
          key={`ul-${i}`}
          className="flex items-start gap-2 py-0.5"
          style={{ paddingLeft: `${indent * 8 + 4}px` }}
        >
          <span className="mt-2 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--theme-text-muted)]" />
          <span className="text-sm leading-5 text-[var(--theme-text-primary)]">
            {renderInline(text)}
          </span>
        </div>
      );
      i++;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (olMatch) {
      const indent = olMatch[1]!.length;
      const num = olMatch[2]!;
      const text = olMatch[3]!;
      elements.push(
        <div
          key={`ol-${i}`}
          className="flex items-start gap-2 py-0.5"
          style={{ paddingLeft: `${indent * 8 + 4}px` }}
        >
          <span className="flex-shrink-0 text-sm text-[var(--theme-text-muted)] min-w-[1.2em] text-right">
            {num}.
          </span>
          <span className="text-sm leading-5 text-[var(--theme-text-primary)]">
            {renderInline(text)}
          </span>
        </div>
      );
      i++;
      continue;
    }

    // Plain paragraph
    elements.push(
      <p key={`p-${i}`} className="text-sm leading-5 py-0.5 text-[var(--theme-text-primary)]">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return <div className="scratchpad-md">{elements}</div>;
}

/** Render inline markdown: bold, italic, code, strikethrough */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Pattern order: code first (to avoid matching * inside code), then bold, italic, strikethrough
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\~\~[^~]+\~\~)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const [full] = match;
    if (full.startsWith('`')) {
      nodes.push(
        <code
          key={`code-${match.index}`}
          className="px-1 py-0.5 rounded text-xs bg-[var(--theme-bg-overlay)] text-[var(--theme-accent)] font-mono"
        >
          {full.slice(1, -1)}
        </code>
      );
    } else if (full.startsWith('**')) {
      nodes.push(
        <strong key={`b-${match.index}`} className="font-semibold">
          {full.slice(2, -2)}
        </strong>
      );
    } else if (full.startsWith('*')) {
      nodes.push(
        <em key={`i-${match.index}`} className="italic">
          {full.slice(1, -1)}
        </em>
      );
    } else if (full.startsWith('~~')) {
      nodes.push(
        <span key={`s-${match.index}`} className="line-through text-[var(--theme-text-muted)]">
          {full.slice(2, -2)}
        </span>
      );
    }

    lastIndex = match.index + full.length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

/** Collapsible toggle block */
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
        <div className="px-3 pb-2 border-t border-[var(--theme-border-subtle)]">
          {children}
        </div>
      )}
    </div>
  );
}

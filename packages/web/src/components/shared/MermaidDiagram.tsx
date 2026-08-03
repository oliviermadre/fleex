import { memo, useEffect, useId, useState } from 'react';

import type { ReactNode } from 'react';

type ColorMode = 'light' | 'dark';

/** True when a react-markdown `code` className marks a ```mermaid block. */
export function isMermaidCode(className: string | undefined): boolean {
  return !!className && /\blanguage-mermaid\b/.test(className);
}

/**
 * Extract the raw source text from react-markdown `code` children. In practice
 * it is a plain string, but it can be a nested node array — flatten defensively.
 */
export function codeNodeToString(children: ReactNode): string {
  if (children == null || typeof children === 'boolean') return '';
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(codeNodeToString).join('');
  if (typeof children === 'object' && 'props' in children) {
    return codeNodeToString((children as { props?: { children?: ReactNode } }).props?.children);
  }
  return '';
}

interface MermaidDiagramProps {
  /** Raw mermaid source (the body of a ```mermaid fenced block). */
  code: string;
  /** App color mode — drives the mermaid theme (light → default, dark → dark). */
  colorMode: ColorMode;
}

type RenderState =
  { status: 'loading' } | { status: 'success'; svg: string } | { status: 'error'; message: string };

/**
 * Mermaid is ~550KB. It is loaded with a dynamic import() so it stays out of
 * the main bundle and is only fetched the first time a diagram is rendered.
 */
async function loadMermaid() {
  const mod = await import('mermaid');
  return mod.default;
}

/**
 * Mermaid renders by injecting a temporary element into the DOM keyed by the
 * id we pass. `useId()` returns colon-delimited strings (":r0:") that are
 * invalid CSS selectors / DOM ids, so we strip everything non-alphanumeric.
 */
function useDiagramId(): string {
  const raw = useId();
  return `mermaid-${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
}

/** Remove any orphan node mermaid may have left behind on error. */
function cleanupOrphans(id: string): void {
  if (typeof document === 'undefined') return;
  for (const selector of [`#${id}`, `#d${id}`]) {
    document.getElementById(selector.slice(1))?.remove();
  }
}

export const MermaidDiagram = memo(function MermaidDiagram({
  code,
  colorMode,
}: MermaidDiagramProps) {
  const id = useDiagramId();
  const [state, setState] = useState<RenderState>({ status: 'loading' });
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    (async () => {
      try {
        const mermaid = await loadMermaid();
        // Re-initialize before every render: mermaid is stateful on the theme,
        // so a theme switch must reset it. securityLevel 'strict' sanitizes the
        // generated HTML and neutralizes any click/JS embedded in the diagram —
        // mandatory since the markdown comes from agent/external content.
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: colorMode === 'dark' ? 'dark' : 'default',
        });
        // parse() throws on a syntax error before we touch the DOM.
        await mermaid.parse(code);
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) setState({ status: 'success', svg });
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setState({ status: 'error', message });
        }
      } finally {
        cleanupOrphans(id);
      }
    })();

    return () => {
      cancelled = true;
      cleanupOrphans(id);
    };
  }, [code, colorMode, id]);

  if (state.status === 'loading') {
    return (
      <div
        className="my-2 flex min-h-[3rem] items-center justify-center rounded-md border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-overlay)] px-3 py-4 text-xs text-[var(--theme-text-muted)]"
        role="status"
      >
        Rendu du diagramme…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="my-2 rounded-md border border-[var(--theme-danger,#ef4444)] bg-[var(--theme-bg-overlay)] px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-[var(--theme-danger,#ef4444)]">
          <span aria-hidden>⚠️</span>
          <span>Diagramme Mermaid invalide</span>
        </div>
        <div className="mt-1 break-words font-mono text-[var(--theme-text-secondary)]">
          {state.message}
        </div>
        <button
          type="button"
          className="mt-1.5 text-[var(--theme-accent)] underline underline-offset-2 hover:text-[var(--theme-accent-hover)]"
          onClick={() => setShowSource((v) => !v)}
        >
          {showSource ? 'Masquer le code source' : 'Voir le code source'}
        </button>
        {showSource && (
          <pre className="mt-1.5 overflow-x-auto rounded bg-[var(--theme-bg-base)] p-2 font-mono text-[var(--theme-text-primary)]">
            {code}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div
      className="my-2 overflow-x-auto rounded-md border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-overlay)] px-3 py-2 text-center [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      // svg is produced by mermaid with securityLevel:'strict' (sanitized HTML).
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
});

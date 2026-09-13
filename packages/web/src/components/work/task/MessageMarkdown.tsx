/**
 * Renders a conversation message body with the SAME engine as the ticket detail
 * tabs — the shared scratchpad MarkdownRenderer — so mention chips, checkboxes,
 * code highlighting, images and mermaid all render consistently. Checkbox toggles
 * are a no-op here (conversation bodies are immutable).
 */
import { MarkdownRenderer } from '../../scratchpad/MarkdownRenderer';

const NOOP_TOGGLE = () => {};

export function MessageMarkdown({ body }: { body: string }) {
  return <MarkdownRenderer content={body} onToggleCheckbox={NOOP_TOGGLE} />;
}

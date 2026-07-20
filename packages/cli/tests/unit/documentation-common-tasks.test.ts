/**
 * L1 intent-router tests (ticket "fleex documentation for PR link").
 *
 * The bug: an agent told to "create the PR then attach it to the ticket" reads
 * `fleex documentation` (~90KB) and never finds `fleex ticket link --pr` — the
 * signal is buried below a huge index. The fix is a curated "Common tasks"
 * section rendered at the TOP of the reference (before the index) so a model
 * maps goal → command on the first screen.
 *
 * These tests encode that intent: the PR-attach recipe MUST be discoverable at
 * the top of both the markdown and text renderings.
 */
import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { renderMarkdown, renderText } from '../../src/commands/documentation/index.ts';

const root = new Command('fleex').description('Fleex CLI');

describe('fleex documentation — Common tasks router (markdown)', () => {
  const out = renderMarkdown(root, []);

  it('renders a "## Common tasks" section BEFORE the "## Index"', () => {
    const tasksIdx = out.indexOf('## Common tasks');
    const indexIdx = out.indexOf('## Index');
    expect(tasksIdx).toBeGreaterThanOrEqual(0);
    expect(indexIdx).toBeGreaterThanOrEqual(0);
    expect(tasksIdx).toBeLessThan(indexIdx);
  });

  it('maps "attach a PR to a ticket" to `fleex ticket link ... --pr`', () => {
    const tasksSection = out.slice(out.indexOf('## Common tasks'), out.indexOf('## Index'));
    expect(tasksSection).toMatch(/PR GitHub/i);
    expect(tasksSection).toContain('fleex ticket link <ticket-id> --pr');
  });

  it('also surfaces the issue-link recipe', () => {
    expect(out).toContain('fleex ticket link <ticket-id> --issue');
  });
});

describe('fleex documentation — Common tasks router (text)', () => {
  const out = renderText(root, []);

  it('renders the Common tasks recipes before the per-command reference', () => {
    const tasksIdx = out.indexOf('Common tasks');
    expect(tasksIdx).toBeGreaterThanOrEqual(0);
    expect(out).toContain('fleex ticket link <ticket-id> --pr');
    // must sit near the top, ahead of the (empty here) command list tail
    expect(tasksIdx).toBeLessThan(out.length / 2);
  });
});

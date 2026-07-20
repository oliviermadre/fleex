/**
 * Discoverability + usability guards for attaching a PR to a ticket
 * (ticket "fleex documentation for PR link").
 *
 * The original failure had two halves:
 *   [find]  an agent exploring `fleex repo …` never saw `fleex ticket link`,
 *           because `repo`'s description advertised "& PRs" (a false magnet)
 *           and `repo pr` gave no pointer to the real command.
 *   [use]   even once found, `ticket link --pr` help said only `org/name#n`,
 *           so an agent pasting the PR URL from `gh` was stuck.
 *
 * These tests lock the wording that fixes both halves so it can't silently
 * regress. They build each CommandDef exactly like program.ts attaches it.
 */
import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import type { CommandDef } from '../../src/core/types.ts';
import { recordExtraHelp } from '../../src/core/help.ts';
import { describeCommand, type CommandDoc } from '../../src/commands/documentation/index.ts';
import linkDef from '../../src/commands/ticket/link/index.ts';
import unlinkDef from '../../src/commands/ticket/unlink/index.ts';
import repoDef from '../../src/commands/repo/index.ts';
import repoPrDef from '../../src/commands/repo/pr/index.ts';

function doc(def: CommandDef, breadcrumb: string[]): CommandDoc {
  const cmd = new Command(def.name).description(def.description ?? '');
  def.setup?.(cmd);
  if (def.extraHelp) {
    const text = typeof def.extraHelp === 'function' ? def.extraHelp() : def.extraHelp;
    recordExtraHelp(cmd, text);
  }
  return describeCommand(cmd, breadcrumb);
}

describe('[use] ticket link accepts a PR/issue URL — help says so', () => {
  const d = doc(linkDef, ['fleex', 'ticket', 'link']);

  it('--pr help mentions a URL is accepted (not just org/name#N)', () => {
    const pr = d.options.find((o) => o.flags.includes('--pr'));
    expect(pr).toBeDefined();
    expect(pr!.description.toLowerCase()).toContain('url');
  });

  it('--issue help mentions a URL is accepted', () => {
    const issue = d.options.find((o) => o.flags.includes('--issue'));
    expect(issue).toBeDefined();
    expect(issue!.description.toLowerCase()).toContain('url');
  });
});

describe('[use] ticket unlink mirrors the URL wording', () => {
  const d = doc(unlinkDef, ['fleex', 'ticket', 'unlink']);
  it('--pr help mentions a URL is accepted', () => {
    const pr = d.options.find((o) => o.flags.includes('--pr'));
    expect(pr!.description.toLowerCase()).toContain('url');
  });
});

describe('[find] repo no longer captures the "PR → ticket" intent', () => {
  const d = doc(repoDef, ['fleex', 'repo']);

  it('repo description drops the "& PRs" false magnet', () => {
    expect(d.description).not.toMatch(/PRs/);
  });

  it('repo help points to the real command for attaching a PR', () => {
    expect(d.notes ?? '').toContain('fleex ticket link');
  });
});

describe('[find] repo pr points back to ticket link', () => {
  const d = doc(repoPrDef, ['fleex', 'repo', 'pr']);

  it('repo pr notes redirect to `fleex ticket link ... --pr`', () => {
    expect(d.notes, 'repo pr should declare an extraHelp note').toBeDefined();
    expect(d.notes!).toContain('fleex ticket link');
    expect(d.notes!).toContain('--pr');
  });
});

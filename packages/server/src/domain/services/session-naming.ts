import {
  ASM_PREFIX,
  ASM_SHELL_PREFIX,
  ASM_CLAUDE_PREFIX,
  DEFAULT_CLAUDE_DISPLAY_NAME,
  DEFAULT_SHELL_DISPLAY_NAME,
  slugify,
} from '@asm/shared';
import type { SessionType } from '@asm/shared';

export interface NamingContext {
  org?: string | null;
  repo?: string | null;
  worktree?: string | null;
  displayName: string;
}

export class SessionNamingService {
  buildTmuxName(type: SessionType, context: NamingContext): string {
    const prefix = type === 'claude' ? 'claude' : 'shell';
    const slugDisplay = slugify(context.displayName);

    if (context.org && context.repo && context.worktree) {
      const slugOrg = slugify(context.org);
      const slugRepo = slugify(context.repo);
      const slugWorktree = slugify(context.worktree);
      return `${ASM_PREFIX}${prefix}_${slugOrg}_${slugRepo}_${slugWorktree}_${slugDisplay}`;
    }

    return `${ASM_PREFIX}${prefix}_${slugDisplay}`;
  }

  resolveUniqueName(
    desiredDisplayName: string,
    type: SessionType,
    context: Omit<NamingContext, 'displayName'>,
    existingTmuxNames: string[],
  ): { displayName: string; tmuxName: string } {
    const base = desiredDisplayName;
    const baseTmux = this.buildTmuxName(type, { ...context, displayName: base });

    if (!existingTmuxNames.includes(baseTmux)) {
      return { displayName: base, tmuxName: baseTmux };
    }

    for (let i = 1; ; i++) {
      const candidate = `${base}-${i}`;
      const candidateTmux = this.buildTmuxName(type, { ...context, displayName: candidate });
      if (!existingTmuxNames.includes(candidateTmux)) {
        return { displayName: candidate, tmuxName: candidateTmux };
      }
    }
  }

  defaultDisplayName(type: SessionType): string {
    return type === 'claude' ? DEFAULT_CLAUDE_DISPLAY_NAME : DEFAULT_SHELL_DISPLAY_NAME;
  }

  isManaged(name: string): boolean {
    return name.startsWith(ASM_PREFIX);
  }

  parseType(name: string): SessionType | null {
    if (name.startsWith(ASM_SHELL_PREFIX)) return 'shell';
    if (name.startsWith(ASM_CLAUDE_PREFIX)) return 'claude';
    return null;
  }

  /**
   * Extract the display name from a new-format tmux name.
   * Returns empty string for old hash-format names.
   */
  extractDisplayName(tmuxName: string): string {
    const type = this.parseType(tmuxName);
    if (!type) return '';

    const prefix = type === 'claude' ? ASM_CLAUDE_PREFIX : ASM_SHELL_PREFIX;
    const rest = tmuxName.slice(prefix.length);

    // Old hash format: exactly 8 hex chars
    if (/^[a-f0-9]{8}$/.test(rest)) return '';

    // New format: last _-segment is the display name
    const lastUnderscore = rest.lastIndexOf('_');
    if (lastUnderscore === -1) {
      // No git context: the rest IS the display name slug
      return rest;
    }

    return rest.slice(lastUnderscore + 1);
  }
}

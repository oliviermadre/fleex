import {
  FLEEX_PREFIX,
  FLEEX_SHELL_PREFIX,
  FLEEX_CLAUDE_PREFIX,
  FLEEX_SIDEBAR_PREFIX,
  DEFAULT_CLAUDE_DISPLAY_NAME,
  DEFAULT_SHELL_DISPLAY_NAME,
  slugify,
} from '@fleex/shared';
import type { SessionType } from '@fleex/shared';

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

    if (context.org && context.repo) {
      const slugOrg = slugify(context.org);
      const slugRepo = slugify(context.repo);
      if (context.worktree) {
        const slugWorktree = slugify(context.worktree);
        return `${FLEEX_PREFIX}${prefix}_${slugOrg}_${slugRepo}_${slugWorktree}_${slugDisplay}`;
      }
      return `${FLEEX_PREFIX}${prefix}_${slugOrg}_${slugRepo}_${slugDisplay}`;
    }

    return `${FLEEX_PREFIX}${prefix}_${slugDisplay}`;
  }

  resolveUniqueName(
    desiredDisplayName: string,
    type: SessionType,
    context: Omit<NamingContext, 'displayName'>,
    existingTmuxNames: string[],
    existingDisplayNames: string[] = [],
  ): { displayName: string; tmuxName: string } {
    const base = desiredDisplayName;
    const baseTmux = this.buildTmuxName(type, { ...context, displayName: base });

    if (!existingTmuxNames.includes(baseTmux) && !existingDisplayNames.includes(base)) {
      return { displayName: base, tmuxName: baseTmux };
    }

    for (let i = 1; ; i++) {
      const candidate = `${base}-${i}`;
      const candidateTmux = this.buildTmuxName(type, { ...context, displayName: candidate });
      if (!existingTmuxNames.includes(candidateTmux) && !existingDisplayNames.includes(candidate)) {
        return { displayName: candidate, tmuxName: candidateTmux };
      }
    }
  }

  defaultDisplayName(type: SessionType): string {
    return type === 'claude' ? DEFAULT_CLAUDE_DISPLAY_NAME : DEFAULT_SHELL_DISPLAY_NAME;
  }

  isManaged(name: string): boolean {
    return name.startsWith(FLEEX_PREFIX);
  }

  isSidebar(name: string): boolean {
    return name.startsWith(FLEEX_SIDEBAR_PREFIX);
  }

  /**
   * Build a tmux name for a sidebar terminal attached to a parent tmux session tab.
   * Format: fleex_sidebar_{ticketDisplayId}_{parentSessionId}_{shortSuffix}
   * The shortSuffix disambiguates multiple sidebar terminals pointing to the same parent.
   */
  buildSidebarTmuxName(params: {
    ticketDisplayId: number | string;
    parentSessionId: string;
    shortSuffix: string;
  }): string {
    const display = slugify(String(params.ticketDisplayId));
    const parent = slugify(params.parentSessionId);
    const suffix = slugify(params.shortSuffix);
    return `${FLEEX_SIDEBAR_PREFIX}${display}_${parent}_${suffix}`;
  }

  /**
   * Extract the parent session id (a UUID) embedded in a sidebar tmux name.
   * Format: fleex_sidebar_{ticketDisplayId}_{parentSessionId}_{shortSuffix}.
   * Returns null when the name is not a sidebar name or no UUID is present.
   */
  parseSidebarParentId(name: string): string | null {
    if (!name.startsWith(FLEEX_SIDEBAR_PREFIX)) return null;
    const match = name.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    return match ? match[0] : null;
  }

  parseType(name: string): SessionType | null {
    if (name.startsWith(FLEEX_SHELL_PREFIX)) return 'shell';
    if (name.startsWith(FLEEX_CLAUDE_PREFIX)) return 'claude';
    if (name.startsWith(FLEEX_SIDEBAR_PREFIX)) return 'shell';
    return null;
  }

  /**
   * Extract the display name from a new-format tmux name.
   * Returns empty string for old hash-format names.
   */
  extractDisplayName(tmuxName: string): string {
    const type = this.parseType(tmuxName);
    if (!type) return '';

    const prefix = type === 'claude' ? FLEEX_CLAUDE_PREFIX : FLEEX_SHELL_PREFIX;
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

import { describe, it, expect } from 'vitest';
import { SessionNamingService } from '../../src/domain/services/session-naming.js';
import { slugify } from '@fleex/shared';

describe('slugify', () => {
  it('should lowercase and replace non-alphanum with hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('should handle periods and colons', () => {
    expect(slugify('feat/new.feature:v2')).toBe('feat-new-feature-v2');
  });

  it('should collapse multiple hyphens', () => {
    expect(slugify('a--b---c')).toBe('a-b-c');
  });

  it('should strip leading and trailing hyphens', () => {
    expect(slugify('-hello-')).toBe('hello');
    expect(slugify('---')).toBe('');
  });

  it('should handle unicode', () => {
    expect(slugify('café résumé')).toBe('caf-r-sum');
  });

  it('should handle empty string', () => {
    expect(slugify('')).toBe('');
  });
});

describe('SessionNamingService', () => {
  const service = new SessionNamingService();

  describe('buildTmuxName', () => {
    it('should build name with git context', () => {
      const name = service.buildTmuxName('claude', {
        org: 'myorg',
        repo: 'myrepo',
        worktree: 'feat/new-feature',
        displayName: 'Claude',
      });
      expect(name).toBe('fleex_claude_myorg_myrepo_feat-new-feature_claude');
    });

    it('should build name without git context', () => {
      const name = service.buildTmuxName('shell', {
        displayName: 'Shell',
      });
      expect(name).toBe('fleex_shell_shell');
    });

    it('should build name for shell type with git context', () => {
      const name = service.buildTmuxName('shell', {
        org: 'odys-travel',
        repo: 'odys-proxy',
        worktree: 'main',
        displayName: 'Shell',
      });
      expect(name).toBe('fleex_shell_odys-travel_odys-proxy_main_shell');
    });

    it('should slugify all segments', () => {
      const name = service.buildTmuxName('claude', {
        org: 'My Org',
        repo: 'My.Repo',
        worktree: 'feat/UPPER',
        displayName: 'My Session',
      });
      expect(name).toBe('fleex_claude_my-org_my-repo_feat-upper_my-session');
    });

    it('should omit git segments when any is null', () => {
      const name = service.buildTmuxName('claude', {
        org: 'myorg',
        repo: null,
        worktree: 'main',
        displayName: 'Claude',
      });
      expect(name).toBe('fleex_claude_claude');
    });
  });

  describe('resolveUniqueName', () => {
    it('should return base name when no conflict', () => {
      const result = service.resolveUniqueName(
        'Claude',
        'claude',
        { org: 'org', repo: 'repo', worktree: 'main' },
        [],
      );
      expect(result.displayName).toBe('Claude');
      expect(result.tmuxName).toBe('fleex_claude_org_repo_main_claude');
    });

    it('should append -1 when base name conflicts', () => {
      const result = service.resolveUniqueName(
        'Claude',
        'claude',
        { org: 'org', repo: 'repo', worktree: 'main' },
        ['fleex_claude_org_repo_main_claude'],
      );
      expect(result.displayName).toBe('Claude-1');
      expect(result.tmuxName).toBe('fleex_claude_org_repo_main_claude-1');
    });

    it('should increment suffix until unique', () => {
      const result = service.resolveUniqueName(
        'Claude',
        'claude',
        { org: 'org', repo: 'repo', worktree: 'main' },
        [
          'fleex_claude_org_repo_main_claude',
          'fleex_claude_org_repo_main_claude-1',
          'fleex_claude_org_repo_main_claude-2',
        ],
      );
      expect(result.displayName).toBe('Claude-3');
      expect(result.tmuxName).toBe('fleex_claude_org_repo_main_claude-3');
    });

    it('should work without git context', () => {
      const result = service.resolveUniqueName(
        'Shell',
        'shell',
        {},
        ['fleex_shell_shell'],
      );
      expect(result.displayName).toBe('Shell-1');
      expect(result.tmuxName).toBe('fleex_shell_shell-1');
    });
  });

  describe('defaultDisplayName', () => {
    it('should return Claude for claude type', () => {
      expect(service.defaultDisplayName('claude')).toBe('Claude');
    });

    it('should return Shell for shell type', () => {
      expect(service.defaultDisplayName('shell')).toBe('Shell');
    });
  });

  describe('isManaged', () => {
    it('should return true for fleex_ prefixed names', () => {
      expect(service.isManaged('fleex_shell_abc12345')).toBe(true);
      expect(service.isManaged('fleex_claude_abc12345')).toBe(true);
      expect(service.isManaged('fleex_claude_org_repo_main_claude')).toBe(true);
    });

    it('should return false for non-fleex names', () => {
      expect(service.isManaged('my-session')).toBe(false);
      expect(service.isManaged('0')).toBe(false);
    });
  });

  describe('parseType', () => {
    it('should parse shell type', () => {
      expect(service.parseType('fleex_shell_abc12345')).toBe('shell');
      expect(service.parseType('fleex_shell_org_repo_main_shell')).toBe('shell');
    });

    it('should parse claude type', () => {
      expect(service.parseType('fleex_claude_abc12345')).toBe('claude');
      expect(service.parseType('fleex_claude_org_repo_main_claude')).toBe('claude');
    });

    it('should return null for unknown', () => {
      expect(service.parseType('fleex_unknown_abc')).toBeNull();
      expect(service.parseType('other')).toBeNull();
    });
  });

  describe('extractDisplayName', () => {
    it('should return empty for old hash format', () => {
      expect(service.extractDisplayName('fleex_claude_a1b2c3d4')).toBe('');
      expect(service.extractDisplayName('fleex_shell_deadbeef')).toBe('');
    });

    it('should extract display name from new format with git context', () => {
      expect(service.extractDisplayName('fleex_claude_org_repo_main_claude')).toBe('claude');
      expect(service.extractDisplayName('fleex_shell_org_repo_feat-x_my-shell')).toBe('my-shell');
    });

    it('should extract display name from new format without git context', () => {
      expect(service.extractDisplayName('fleex_claude_claude')).toBe('claude');
      expect(service.extractDisplayName('fleex_shell_shell-1')).toBe('shell-1');
    });

    it('should return empty for non-managed names', () => {
      expect(service.extractDisplayName('random-session')).toBe('');
    });
  });
});

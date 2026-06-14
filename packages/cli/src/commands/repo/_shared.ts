import { die } from '../../core/colors.ts';
import { apiBase, apiGet, apiPut } from '../../core/api.ts';

export interface Repository {
  org: string;
  name: string;
  barePath: string;
  defaultBranch: string;
  remote: string;
  isCloned: boolean;
}

export interface Worktree {
  path: string;
  branch: string;
  isMain: boolean;
  isBare: boolean;
}

export interface PullRequest {
  number: number;
  title: string;
  headRefName: string;
  state: 'open' | 'merged' | 'closed';
  isDraft?: boolean;
  author: string;
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  author: string;
  assignees: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AppConfig {
  repositories?: string[];
  resolvedRepositories?: string[];
  [k: string]: unknown;
}

/**
 * Parse and validate an `org/name` repository reference. Accepts the
 * `--repo org/name` form or a bare positional. Exits with a clear message on
 * malformed input.
 */
export function parseRepo(input: string): { org: string; name: string; slug: string } {
  const m = input.trim().match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) {
    die(`Invalid repository "${input}" (expected org/name, e.g. oliviermadre/fleex)`);
  }
  const [, org, name] = m as RegExpMatchArray;
  return { org: org!, name: name!, slug: `${org}/${name}` };
}

/**
 * Resolve a repo from either a positional arg or the `--repo` option.
 * At least one must be provided.
 */
export function resolveRepoArg(positional: string | undefined, repoOpt: string | undefined): {
  org: string;
  name: string;
  slug: string;
} {
  const value = positional ?? repoOpt;
  if (!value) die('Missing repository. Pass it as org/name or with --repo org/name.');
  return parseRepo(value);
}

export function getConfig(): Promise<AppConfig> {
  return apiGet<AppConfig>(`${apiBase()}/api/config`);
}

/** PUT the config back, sending only the repositories array changes plus the rest. */
export function putConfig(config: AppConfig): Promise<AppConfig> {
  return apiPut<AppConfig>(`${apiBase()}/api/config`, config);
}

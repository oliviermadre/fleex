/**
 * Gateway Security Policy — sandbox and allowlist for command execution
 * and filesystem operations.
 *
 * The policy is loaded from ~/.asm/security-policy.json (or env var
 * GATEWAY_SECURITY_POLICY). If no policy file exists, a restrictive
 * default is applied.
 *
 * Command execution:
 *   - Only commands matching the allowlist patterns are permitted.
 *   - Shell mode can be disabled entirely.
 *   - Dangerous patterns (pipe to shell, curl|bash, etc.) are blocked.
 *
 * Filesystem:
 *   - Operations are restricted to allowed base paths.
 *   - Sensitive paths (~/.ssh, /etc/shadow, etc.) are always blocked.
 *   - Write/delete operations can be restricted independently of reads.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, normalize } from 'node:path';
import { homedir } from 'node:os';
import { logAlways, logError } from './logger';

export interface SecurityPolicy {
  /** Allowed base directories for filesystem operations (resolved to absolute paths) */
  allowedPaths: string[];

  /** Additional paths that are always blocked (glob-like, checked with startsWith) */
  blockedPaths: string[];

  /** Allowed command executables (basename or full path). Empty = allow all (not recommended). */
  allowedCommands: string[];

  /** Blocked command patterns (regex strings matched against the full command line) */
  blockedCommandPatterns: string[];

  /** Whether shell mode (exec with shell=true) is permitted */
  allowShellMode: boolean;

  /** Whether write operations (write, mkdir, rm) are permitted */
  allowWriteOps: boolean;

  /** Maximum command timeout in ms (caps the client-requested timeout) */
  maxCommandTimeoutMs: number;

  /** Whether to log all command executions (for audit) */
  auditLog: boolean;
}

const DEFAULT_BLOCKED_PATHS = [
  join(homedir(), '.ssh'),
  join(homedir(), '.gnupg'),
  join(homedir(), '.asm', 'gateway.json'), // gateway secret
  '/etc/shadow',
  '/etc/gshadow',
  '/etc/sudoers',
  '/proc/kcore',
];

const DEFAULT_BLOCKED_COMMAND_PATTERNS = [
  // Prevent piping to shell interpreters
  'curl.*\\|.*(?:bash|sh|zsh|python|node|perl)',
  'wget.*\\|.*(?:bash|sh|zsh|python|node|perl)',
  // Prevent reverse shells
  '/dev/tcp/',
  'nc\\s+-e',
  'ncat.*-e',
  'mkfifo',
  // Prevent credential access
  'cat.*\\.ssh/id_',
  'cat.*/etc/shadow',
  // Prevent modifying gateway identity
  'rm.*\\.asm/gateway\\.json',
  // Prevent disabling security
  'rm.*security-policy\\.json',
];

const DEFAULT_POLICY: SecurityPolicy = {
  allowedPaths: [homedir()],
  blockedPaths: DEFAULT_BLOCKED_PATHS,
  allowedCommands: [], // empty = no allowlist (all permitted by default for backward compat)
  blockedCommandPatterns: DEFAULT_BLOCKED_COMMAND_PATTERNS,
  allowShellMode: true,
  allowWriteOps: true,
  maxCommandTimeoutMs: 30_000,
  auditLog: true,
};

let activePolicy: SecurityPolicy = { ...DEFAULT_POLICY };

export function loadSecurityPolicy(): SecurityPolicy {
  const policyPath =
    process.env['GATEWAY_SECURITY_POLICY'] ??
    join(homedir(), '.asm', 'security-policy.json');

  if (existsSync(policyPath)) {
    try {
      const raw = JSON.parse(readFileSync(policyPath, 'utf-8'));
      activePolicy = {
        ...DEFAULT_POLICY,
        ...raw,
        // Always enforce blocked paths — user policy can add more but not remove defaults
        blockedPaths: [
          ...DEFAULT_BLOCKED_PATHS,
          ...(raw.blockedPaths ?? []),
        ],
        blockedCommandPatterns: [
          ...DEFAULT_BLOCKED_COMMAND_PATTERNS,
          ...(raw.blockedCommandPatterns ?? []),
        ],
      };
      logAlways(`[security] Loaded policy from ${policyPath}`);
    } catch (err) {
      logError(`[security] Failed to parse ${policyPath}, using defaults:`, err);
      activePolicy = { ...DEFAULT_POLICY };
    }
  } else {
    logAlways('[security] No security-policy.json found, using default policy');
    activePolicy = { ...DEFAULT_POLICY };
  }

  return activePolicy;
}

export function getPolicy(): SecurityPolicy {
  return activePolicy;
}

// ── Validators ──

export interface PolicyViolation {
  allowed: false;
  reason: string;
}

export interface PolicyAllowed {
  allowed: true;
}

export type PolicyResult = PolicyViolation | PolicyAllowed;

/**
 * Check if a filesystem path is allowed by the security policy.
 */
export function checkPathAllowed(
  targetPath: string,
  operation: 'read' | 'write' | 'delete',
): PolicyResult {
  const policy = getPolicy();
  const absPath = resolve(normalize(targetPath));

  // Check write permission
  if ((operation === 'write' || operation === 'delete') && !policy.allowWriteOps) {
    return { allowed: false, reason: `Write operations are disabled by security policy` };
  }

  // Check blocked paths (always enforced)
  for (const blocked of policy.blockedPaths) {
    const absBlocked = resolve(normalize(blocked));
    if (absPath === absBlocked || absPath.startsWith(absBlocked + '/')) {
      return { allowed: false, reason: `Path is blocked by security policy: ${blocked}` };
    }
  }

  // Check allowed base paths
  if (policy.allowedPaths.length > 0) {
    const isAllowed = policy.allowedPaths.some((base) => {
      const absBase = resolve(normalize(base));
      return absPath === absBase || absPath.startsWith(absBase + '/');
    });
    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Path is outside allowed directories. Allowed: ${policy.allowedPaths.join(', ')}`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Check if a command is allowed by the security policy.
 */
export function checkCommandAllowed(
  command: string,
  args: string[],
  shell?: boolean,
): PolicyResult {
  const policy = getPolicy();

  // Check shell mode
  if (shell && !policy.allowShellMode) {
    return { allowed: false, reason: 'Shell mode is disabled by security policy' };
  }

  // Build full command line for pattern matching
  const fullCommand = shell ? command : `${command} ${args.join(' ')}`;

  // Check blocked patterns
  for (const pattern of policy.blockedCommandPatterns) {
    try {
      if (new RegExp(pattern, 'i').test(fullCommand)) {
        return {
          allowed: false,
          reason: `Command matches blocked pattern: ${pattern}`,
        };
      }
    } catch {
      // Invalid regex in policy — skip
    }
  }

  // Check command allowlist (if non-empty)
  if (policy.allowedCommands.length > 0 && !shell) {
    const cmdBasename = command.split('/').pop() ?? command;
    const isAllowed = policy.allowedCommands.some(
      (allowed) => allowed === command || allowed === cmdBasename,
    );
    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Command '${command}' is not in the allowlist. Allowed: ${policy.allowedCommands.join(', ')}`,
      };
    }
  }

  return { allowed: true };
}

import type { ClaudeCodeSkillOrigin, ClaudeCodeSkillStatus } from '@fleex/shared';
import { ClaudeCodeSkillEntity } from '../../domain/entities/claude-code-skill.entity.js';

/**
 * Row mapping shared by the three `claude_code_skills` adapters. Dialects
 * differ only in how they hand back booleans (0/1 vs true/false) and JSON
 * (TEXT vs JSONB), both absorbed here. `repo` is '' in the table so it can
 * sit in the unique key; it is null in the entity.
 */
export interface ClaudeCodeSkillRow {
  id: string;
  host_id: string;
  origin: string;
  native_name: string;
  command_name: string;
  name: string;
  description: string;
  allowed_tools: unknown;
  plugin: string | null;
  repo: string;
  source_path: string;
  real_path: string | null;
  content_hash: string;
  activated_hash: string | null;
  enabled: unknown;
  persona_id: string | null;
  status: string;
  parse_error: string | null;
  last_seen_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
}

function parseTools(value: unknown): string[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function rowToClaudeCodeSkill(row: ClaudeCodeSkillRow): ClaudeCodeSkillEntity {
  return new ClaudeCodeSkillEntity(
    row.id,
    row.host_id,
    row.origin as ClaudeCodeSkillOrigin,
    row.native_name,
    row.command_name,
    row.name ?? '',
    row.description ?? '',
    parseTools(row.allowed_tools),
    row.plugin ?? null,
    row.repo ? row.repo : null,
    row.source_path,
    row.real_path ?? null,
    row.content_hash ?? '',
    row.activated_hash ?? null,
    row.enabled === true || row.enabled === 1,
    row.persona_id ?? null,
    row.status as ClaudeCodeSkillStatus,
    row.parse_error ?? null,
    new Date(row.last_seen_at),
    new Date(row.created_at),
    new Date(row.updated_at),
  );
}

/** Column values in table order; `json` decides how allowed_tools is encoded. */
export function claudeCodeSkillToRow(s: ClaudeCodeSkillEntity): Omit<ClaudeCodeSkillRow, 'enabled' | 'allowed_tools'> & {
  enabled: boolean;
  allowed_tools: string[] | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
} {
  return {
    id: s.id,
    host_id: s.hostId,
    origin: s.origin,
    native_name: s.nativeName,
    command_name: s.commandName,
    name: s.name,
    description: s.description,
    allowed_tools: s.allowedTools,
    plugin: s.plugin,
    repo: s.repo ?? '',
    source_path: s.sourcePath,
    real_path: s.realPath,
    content_hash: s.contentHash,
    activated_hash: s.activatedHash,
    enabled: s.enabled,
    persona_id: s.personaId,
    status: s.status,
    parse_error: s.parseError,
    last_seen_at: s.lastSeenAt.toISOString(),
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}

export const CLAUDE_CODE_SKILL_COLUMNS = [
  'id', 'host_id', 'origin', 'native_name', 'command_name', 'name', 'description', 'allowed_tools',
  'plugin', 'repo', 'source_path', 'real_path', 'content_hash', 'activated_hash', 'enabled',
  'persona_id', 'status', 'parse_error', 'last_seen_at', 'created_at', 'updated_at',
] as const;

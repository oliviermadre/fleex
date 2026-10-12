import type { ClaudeCodeSkillOrigin, ClaudeCodeSkillScanReport } from '@fleex/shared';
import { ClaudeCodeSkillEntity } from '../entities/claude-code-skill.entity.js';

/**
 * Pure rules for Claude Code skills mirrored into Fleex: naming, frontmatter,
 * scan reconciliation and mention resolution. No I/O here — the scanner
 * gathers files, these functions decide.
 */

/** Reserved prefix: every Claude Code skill is mentioned as `@skill:cc-…`. */
export const CLAUDE_CODE_COMMAND_PREFIX = 'cc-';

/** Name of the system persona that runs Claude Code skills unless overridden. */
export const CLAUDE_CODE_SYSTEM_PERSONA_NAME = 'claude-code';

/**
 * Mentions only parse `[a-zA-Z0-9_-]+`, so `superpowers:brainstorming` cannot
 * be mentioned as-is. `:` and `/` become `--`; anything else outside the
 * charset becomes `-`.
 */
export function toClaudeCodeCommandName(nativeName: string): string {
  return CLAUDE_CODE_COMMAND_PREFIX + nativeName
    .toLowerCase()
    .replace(/[:/]/g, '--')
    .replace(/[^a-z0-9_-]/g, '-');
}

export function isReservedCommandName(commandName: string): boolean {
  return commandName.toLowerCase().startsWith(CLAUDE_CODE_COMMAND_PREFIX);
}

// ── Frontmatter ─────────────────────────────────────────────────────────────

export interface SkillFrontmatter {
  name: string | null;
  description: string;
  allowedTools: string[] | null;
}

export type FrontmatterResult =
  | { ok: true; value: SkillFrontmatter }
  | { ok: false; error: string };

/**
 * Parses the YAML subset SKILL.md files use: `key: value` scalars (quoted or
 * not), folded/literal blocks (`>` / `|`), block lists (`- item`) and flow
 * lists (`[a, b]`). Never throws: a broken file becomes an error message that
 * is shown next to the skill instead of aborting the whole scan.
 */
export function parseSkillFrontmatter(content: string): FrontmatterResult {
  const lines = content.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { ok: false, error: 'frontmatter: missing opening "---"' };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return { ok: false, error: 'frontmatter: missing closing "---"' };

  const fields = new Map<string, string | string[]>();
  let i = 1;
  while (i < end) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith('#') || /^\s/.test(line)) { i++; continue; }
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) return { ok: false, error: `frontmatter: cannot parse line ${i + 1}: "${line.trim()}"` };
    const key = m[1]!.toLowerCase();
    const raw = m[2]!.trim();
    i++;
    // Collect the indented continuation lines of this key.
    const block: string[] = [];
    while (i < end && (lines[i]!.trim() === '' || /^\s/.test(lines[i]!))) block.push(lines[i++]!);

    if (raw === '' && block.some((l) => l.trim().startsWith('- '))) {
      fields.set(key, block.filter((l) => l.trim().startsWith('- ')).map((l) => unquote(l.trim().slice(2).trim())));
    } else if (raw === '>' || raw === '|' || raw === '>-' || raw === '|-') {
      const parts = block.map((l) => l.trim());
      fields.set(key, (raw.startsWith('>') ? parts.filter(Boolean).join(' ') : parts.join('\n')).trim());
    } else if (raw.startsWith('[') && raw.endsWith(']')) {
      fields.set(key, raw.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean));
    } else {
      // Plain multi-line scalars fold into one line.
      fields.set(key, [unquote(raw), ...block.map((l) => l.trim())].filter(Boolean).join(' '));
    }
  }

  const str = (k: string): string | null => {
    const v = fields.get(k);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const description = str('description');
  if (!description) return { ok: false, error: 'frontmatter: missing required field "description"' };

  const tools = fields.get('allowed-tools');
  const allowedTools = tools === undefined
    ? null
    : (Array.isArray(tools) ? tools : tools.split(',').map((s) => s.trim())).filter(Boolean);

  return { ok: true, value: { name: str('name'), description, allowedTools: allowedTools?.length ? allowedTools : null } };
}

function unquote(s: string): string {
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

// ── Scan reconciliation ─────────────────────────────────────────────────────

/** One SKILL.md as found on disk by the scanner. */
export interface DiscoveredSkill {
  origin: ClaudeCodeSkillOrigin;
  nativeName: string;
  name: string;
  description: string;
  allowedTools: string[] | null;
  plugin: string | null;
  repo: string | null;
  sourcePath: string;
  realPath: string | null;
  contentHash: string;
  parseError: string | null;
}

const identityKey = (s: { origin: string; nativeName: string; repo: string | null }) =>
  `${s.origin}\u0000${s.nativeName}\u0000${s.repo ?? ''}`;

/**
 * Applies a scan of one host to its existing rows.
 * - new skills arrive disabled (a human must opt in);
 * - rows not seen anymore become `missing` but keep their settings;
 * - a row that comes back keeps its activation and persona override;
 * - command names are stable: a native name keeps the name it already had.
 */
export function reconcileScan(params: {
  hostId: string;
  existing: ClaudeCodeSkillEntity[];
  discovered: DiscoveredSkill[];
  /** Native Fleex skills that already use a `cc-*` name (legacy): they win. */
  nativeCommandNames: ReadonlySet<string>;
  now: Date;
  newId: () => string;
}): { rows: ClaudeCodeSkillEntity[]; report: ClaudeCodeSkillScanReport } {
  const { hostId, now } = params;
  const report = { hostId, added: 0, changed: 0, missing: 0, back: 0, invalid: 0, total: 0 };
  const byKey = new Map(params.existing.map((r) => [identityKey(r), r]));
  const seen = new Set<string>();
  const rows: ClaudeCodeSkillEntity[] = [];

  for (const d of params.discovered) {
    const key = identityKey(d);
    if (seen.has(key)) continue;
    seen.add(key);
    const prev = byKey.get(key);
    const status = d.parseError ? 'invalid' : 'present';
    if (prev) {
      if (prev.status === 'missing') report.back++;
      else if (prev.contentHash !== d.contentHash) report.changed++;
      prev.name = d.name;
      prev.description = d.description;
      prev.allowedTools = d.allowedTools;
      prev.plugin = d.plugin;
      prev.sourcePath = d.sourcePath;
      prev.realPath = d.realPath;
      prev.contentHash = d.contentHash;
      prev.status = status;
      prev.parseError = d.parseError;
      prev.lastSeenAt = now;
      prev.updatedAt = now;
      rows.push(prev);
    } else {
      report.added++;
      rows.push(new ClaudeCodeSkillEntity(
        params.newId(), hostId, d.origin, d.nativeName, '', d.name, d.description, d.allowedTools,
        d.plugin, d.repo, d.sourcePath, d.realPath, d.contentHash, null, false, null, status,
        d.parseError, now, now, now,
      ));
    }
  }

  for (const prev of params.existing) {
    if (seen.has(identityKey(prev))) continue;
    if (prev.status !== 'missing') {
      report.missing++;
      prev.status = 'missing';
      prev.updatedAt = now;
    }
    rows.push(prev);
  }

  assignCommandNames(rows);
  for (const r of rows) {
    if (r.status === 'present' && params.nativeCommandNames.has(r.commandName)) r.status = 'conflict';
    if (r.status === 'invalid') report.invalid++;
  }
  report.total = rows.length;
  return { rows, report };
}

/**
 * The same native name shares one command name across origins (`user` and
 * `project` both `deploy` → `cc-deploy`, resolved per ticket). Two different
 * native names that normalize alike get `-2`, `-3`… The first owner keeps the
 * bare name; a name once given is never taken back while its row exists.
 */
function assignCommandNames(rows: ClaudeCodeSkillEntity[]): void {
  const byNative = new Map<string, string>();
  const taken = new Map<string, string>(); // commandName → nativeName
  for (const r of rows) {
    if (!r.commandName || byNative.has(r.nativeName)) continue;
    if (taken.has(r.commandName) && taken.get(r.commandName) !== r.nativeName) continue;
    byNative.set(r.nativeName, r.commandName);
    taken.set(r.commandName, r.nativeName);
  }
  const pending = [...new Set(rows.filter((r) => !byNative.has(r.nativeName)).map((r) => r.nativeName))].sort();
  for (const nativeName of pending) {
    const base = toClaudeCodeCommandName(nativeName);
    let candidate = base;
    for (let n = 2; taken.has(candidate); n++) candidate = `${base}-${n}`;
    byNative.set(nativeName, candidate);
    taken.set(candidate, nativeName);
  }
  for (const r of rows) r.commandName = byNative.get(r.nativeName)!;
}

// ── Resolution ──────────────────────────────────────────────────────────────

const ORIGIN_PRIORITY: Record<ClaudeCodeSkillOrigin, number> = { project: 0, user: 1, plugin: 2, synced: 3 };

/** Whether a skill may be offered on a ticket linked to `ticketRepos` (`org/name`). */
export function isInTicketScope(skill: ClaudeCodeSkillEntity, ticketRepos: readonly string[]): boolean {
  if (skill.origin !== 'project') return true;
  const repos = ticketRepos.map((r) => r.toLowerCase());
  return skill.repo !== null && repos.includes(skill.repo.toLowerCase());
}

/**
 * Which skill `@skill:<commandName>` runs on a ticket. Same rule as Claude
 * Code: a project skill wins over a user one inside its repo. Disabled,
 * missing, invalid, conflicting or out-of-scope skills never resolve.
 */
export function resolveClaudeCodeSkill(
  rows: readonly ClaudeCodeSkillEntity[],
  commandName: string,
  ticketRepos: readonly string[],
): ClaudeCodeSkillEntity | null {
  const candidates = rows
    .filter((r) => r.commandName === commandName && r.runnable && isInTicketScope(r, ticketRepos))
    .sort((a, b) => ORIGIN_PRIORITY[a.origin] - ORIGIN_PRIORITY[b.origin]);
  return candidates[0] ?? null;
}

/** The prompt that hands control to Claude Code's native `Skill` tool. */
export function buildClaudeCodeSkillInstructions(skill: ClaudeCodeSkillEntity): string {
  return [
    `Invoque le skill \`${skill.nativeName}\` via le tool Skill, puis suis ses instructions.`,
    'Les arguments éventuels sont dans la section « Skill Arguments » ci-dessus.',
    `Si le tool Skill ne trouve pas \`${skill.nativeName}\`, ne l'improvise pas : réponds par un commentaire `
      + 'expliquant que le skill est introuvable dans cette session.',
  ].join('\n\n');
}

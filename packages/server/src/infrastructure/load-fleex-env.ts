/**
 * Loads credentials from ~/.fleex/.env into process.env at server startup.
 *
 * Why: when Fleex runs from a DMG, the user has no terminal to `export
 * ANTHROPIC_API_KEY=...`. They configure credentials via the Settings panel,
 * which writes them to ~/.fleex/.env. At the next launch, the server must
 * pick them up before anything that depends on them (Supabase, Anthropic SDK,
 * storage driver) is initialised.
 *
 * Existing process.env values take precedence — that way the dev workflow
 * (root .env, `FLEEX_STORAGE_DRIVER=...` in front of the command) is
 * unchanged.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Subset of the parser from packages/desktop/src/lib/env-file.js — kept in
 *  sync intentionally (small enough that duplication beats a new shared dep). */
function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const stripped = line.startsWith('export ') ? line.slice('export '.length).trimStart() : line;
    const eq = stripped.indexOf('=');
    if (eq === -1) continue;
    const key = stripped.slice(0, eq).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = stripped.slice(eq + 1).replace(/^[\t ]+/, '');
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      let end = -1;
      for (let i = 1; i < value.length; i++) {
        if (value[i] === '\\') {
          i += 1;
          continue;
        }
        if (value[i] === quote) {
          end = i;
          break;
        }
      }
      if (end === -1) continue;
      out[key] = unescape(value.slice(1, end));
      continue;
    }
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '#' && (i === 0 || /\s/.test(value[i - 1]!))) {
        value = value.slice(0, i);
        break;
      }
    }
    out[key] = value.trimEnd();
  }
  return out;
}

function unescape(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const next = s[i + 1]!;
      if (next === '\\' || next === '"' || next === "'") {
        out += next;
        i += 1;
        continue;
      }
    }
    out += s[i];
  }
  return out;
}

export interface LoadFleexEnvResult {
  /** Path that was checked (whether or not it existed). */
  path: string;
  /** Number of variables loaded into process.env (only those not already set). */
  loaded: number;
  /** Whether the file existed. */
  exists: boolean;
}

/**
 * Read ~/.fleex/.env (override via FLEEX_HOME) and inject any keys that are
 * not already set in process.env. Does NOT overwrite existing variables.
 */
export function loadFleexEnv(): LoadFleexEnvResult {
  const fleexHome = process.env['FLEEX_HOME'] || join(homedir(), '.fleex');
  const envPath = join(fleexHome, '.env');
  if (!existsSync(envPath)) {
    return { path: envPath, loaded: 0, exists: false };
  }
  let parsed: Record<string, string>;
  try {
    parsed = parseEnvFile(readFileSync(envPath, 'utf8'));
  } catch {
    return { path: envPath, loaded: 0, exists: true };
  }
  let loaded = 0;
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
      loaded += 1;
    }
  }
  return { path: envPath, loaded, exists: true };
}

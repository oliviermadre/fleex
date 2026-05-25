/**
 * Routes for managing API credentials persisted in ~/.fleex/.env.
 *
 * Lives outside the regular config store because credentials should never
 * leave the user's machine (no Supabase sync, no JSON config file). They sit
 * in a 600-permission dotfile that the server reads at boot via loadFleexEnv.
 *
 * Surfaced through Settings → Credentials in the web UI when running in the
 * DMG bundle.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { FastifyInstance } from 'fastify';

const MANAGED_KEYS = [
  'ANTHROPIC_API_KEY',
  'FLEEX_STORAGE_DRIVER',
  'FLEEX_SUPABASE_URL',
  'FLEEX_SUPABASE_KEY',
  'FLEEX_SUPABASE_DB_URL',
] as const;

type ManagedKey = (typeof MANAGED_KEYS)[number];

/** Whether the server is running inside the packaged DMG. Detect once at
 *  module load; cheap heuristic via `app.isPackaged` equivalent. */
const IS_PACKAGED = process.env['ELECTRON_RUN_AS_NODE'] === '1';

function envPath(): string {
  const fleexHome = process.env['FLEEX_HOME'] || join(homedir(), '.fleex');
  return join(fleexHome, '.env');
}

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const stripped = line.startsWith('export ')
      ? line.slice('export '.length).trimStart()
      : line;
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
      out[key] = value
        .slice(1, end)
        .replace(/\\(["'\\])/g, '$1');
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

function serializeEnvFile(obj: Record<string, string>): string {
  const lines: string[] = [];
  for (const key of Object.keys(obj)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = obj[key] ?? '';
    if (value === '') continue;
    if (/[\s#"'=]/.test(value)) {
      lines.push(
        `${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
      );
    } else {
      lines.push(`${key}=${value}`);
    }
  }
  return lines.join('\n') + '\n';
}

function readEnvSafe(p: string): Record<string, string> {
  if (!existsSync(p)) return {};
  try {
    return parseEnvFile(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function writeEnvSafe(p: string, data: Record<string, string>): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, serializeEnvFile(data), { mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
    // best effort
  }
}

/** Mask a credential for response so we never echo the secret back to the UI. */
function maskValue(key: ManagedKey, value: string): string {
  if (!value) return '';
  // Non-secrets surface as-is so the UI can show them.
  if (key === 'FLEEX_STORAGE_DRIVER' || key === 'FLEEX_SUPABASE_URL') return value;
  // Secrets — keep last 4 chars, mask the rest.
  if (value.length <= 8) return '••••';
  return `••••${value.slice(-4)}`;
}

export function credentialsRoutes() {
  return async function (app: FastifyInstance) {
    app.get('/api/credentials', async () => {
      const data = readEnvSafe(envPath());
      const masked: Record<string, { value: string; isSet: boolean }> = {};
      for (const key of MANAGED_KEYS) {
        const value = data[key] ?? '';
        masked[key] = {
          value: maskValue(key, value),
          isSet: value !== '',
        };
      }
      return {
        path: envPath(),
        isPackaged: IS_PACKAGED,
        credentials: masked,
        managedKeys: MANAGED_KEYS,
      };
    });

    app.put<{ Body: Partial<Record<ManagedKey, string>> }>(
      '/api/credentials',
      async (request, reply) => {
        const body = request.body ?? {};
        const existing = readEnvSafe(envPath());
        const merged: Record<string, string> = { ...existing };

        for (const key of MANAGED_KEYS) {
          if (key in body) {
            const value = body[key];
            if (typeof value !== 'string') {
              return reply.code(400).send({ error: `${key} must be a string` });
            }
            // Empty string = delete the key.
            if (value === '') {
              delete merged[key];
            } else {
              merged[key] = value;
              // Make the update immediately visible to in-process callers
              // (Anthropic SDK reads ANTHROPIC_API_KEY lazily, for example).
              process.env[key] = value;
            }
          }
        }

        // Validate enum-like keys.
        if (
          merged['FLEEX_STORAGE_DRIVER'] &&
          !['json', 'sqlite', 'pgsql', 'supabase'].includes(merged['FLEEX_STORAGE_DRIVER'])
        ) {
          return reply.code(400).send({ error: 'FLEEX_STORAGE_DRIVER must be json|sqlite|pgsql|supabase' });
        }

        writeEnvSafe(envPath(), merged);

        const restartRequired =
          merged['FLEEX_STORAGE_DRIVER'] !== (existing['FLEEX_STORAGE_DRIVER'] ?? '');

        return {
          ok: true,
          restartRequired,
        };
      },
    );
  };
}
